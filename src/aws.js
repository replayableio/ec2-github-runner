const {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
  DescribeHostsCommand,
  AllocateHostsCommand,
} = require('@aws-sdk/client-ec2');
const core = require('@actions/core');
const config = require('./config');

const runnerVersion = '2.309.0';

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  core.info(`Building data script for ${config.input.ec2Os}`);

  if (config.input.ec2Os === 'windows') {
    // Name the instance the same as the label to avoid machine name conflicts in GitHub.
    if (config.input.runnerHomeDir) {
      // If runner home directory is specified, we expect the actions-runner software (and dependencies)
      // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
      return [
        '<powershell>',
        `cd "${config.input.runnerHomeDir}"`,
        `echo "${config.input.preRunnerScript}" > pre-runner-script.ps1`,
        '.\\pre-runner-script.ps1',
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ];
    } else {
      return [
        '<powershell>',
        'mkdir C:\\actions-runner; cd C:\\actions-runner',
        `echo "${config.input.preRunnerScript}" > pre-runner-script.ps1`,
        '.\\pre-runner-script.ps1',
        `Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-win-x64-${runnerVersion}.zip -OutFile actions-runner-win-x64-${runnerVersion}.zip`,
        `Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner-win-x64-${runnerVersion}.zip", "$PWD")`,
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ];
    }
  } else if (config.input.ec2Os === 'mac') {
    if (config.input.runnerHomeDir) {
      // If runner home directory is specified, we expect the actions-runner software (and dependencies)
      // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
      return [
        "#!/bin/bash",
        "sudo -u ec2-user -i <<'EOF'",
        `cd "${config.input.runnerHomeDir}"`,
        `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
        "source pre-runner-script.sh",
        // "export RUNNER_ALLOW_RUNASROOT=1",
        `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended`,
        "./run.sh",
        "EOF",
      ];
    } else {
      return [
        '#!/bin/bash',
        "sudo -u ec2-user -i <<'EOF'",
        'mkdir actions-runner && cd actions-runner',
        `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
        'source pre-runner-script.sh',
        'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="v${runnerVersion}/actions-runner-linux-${RUNNER_ARCH}-${runnerVersion}.tar.gz',
        `tar xzf ./actions-runner-linux-\${RUNNER_ARCH}-${runnerVersion}.tar.gz`,
        `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
        './run.sh',
        'EOF',
      ];
    }
  } else {
    core.error('Not supported ec2-os.');
    return [];
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const client = new EC2Client();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SecurityGroupIds: [config.input.securityGroupId],
    KeyName: 'gh-runner',
    TagSpecifications: config.tagSpecifications,
  };

  if (config.input.ec2Os === 'mac') {
    params.Placement = {
      Tenancy: 'host',
    };
  }

  const runCommand = new RunInstancesCommand(params);

  try {
    if (config.input.ec2Os === 'mac') {
      const describeCommand = new DescribeHostsCommand({
        Filter: [
          {
            Name: 'auto-placement',
            Values: ['on'],
          },
          {
            Name: 'instance-type',
            Values: [config.input.ec2InstanceType],
          },
          {
            Name: 'state',
            Values: ['available'],
          },
        ],
      });
      const dedicatedHosts = await client.send(describeCommand);

      const availableHosts = dedicatedHosts.Hosts.filter((host) => host.AvailableCapacity.AvailableVCpus > 0).length;

      core.info(`Available hosts: ${availableHosts}`);

      if (!availableHosts) {
        core.info('There are no dedicated hosts available, creating a new one');

        await client.send(
          new AllocateHostsCommand({
            AutoPlacement: 'on',
            AvailabilityZone: config.input.availabilityZone,
            InstanceType: config.input.ec2InstanceType,
            Quantity: 1,
          })
        );
      }
    }

    const result = await client.send(runCommand);
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const client = new EC2Client();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  const command = new TerminateInstancesCommand(params);

  try {
    await client.send(command);
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const client = new EC2Client();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await waitUntilInstanceRunning({ client, maxWaitTime: 90, minDelay: 3 }, params);
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
