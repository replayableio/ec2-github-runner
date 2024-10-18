const {
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  CreateTagsCommand,
  waitUntilInstanceRunning,
} = require('@aws-sdk/client-ec2');

const {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand
} = require('@aws-sdk/client-auto-scaling');

const {
  SSMClient,
  SendCommandCommand
} = require('@aws-sdk/client-ssm');

const core = require('@actions/core');
const { getRegistrationToken } = require('./gh');

// Sleep Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * Gets the launch template used in the autoscaling group
 */
async function getLaunchTemplateFromASG(autoScalingGroupName) {
  const client = new AutoScalingClient();

  const params = {
    AutoScalingGroupNames: [autoScalingGroupName], // Replace with your ASG name
  };

  const command = new DescribeAutoScalingGroupsCommand(params);
  const data = await client.send(command);

  if (data.AutoScalingGroups.length == 0) {
    throw Error('Auto Scaling Group not found')
  }

  const asg = data.AutoScalingGroups[0];
  const launchTemplate = asg.LaunchTemplate;

  core.info(`Using Launch Template: ${launchTemplate.LaunchTemplateId}`);
  core.info(`Name: ${launchTemplate.LaunchTemplateName}`);
  core.info(`Version: ${launchTemplate.Version}`);

  return {
    id: launchTemplate.LaunchTemplateId,
    version: launchTemplate.Version,
  };
}

async function startRunnerCommand(instanceId) {
  const client = new SSMClient();

  core.info("Getting getRegistrationToken");
  const token = await getRegistrationToken();

  const commands = [
    "cd C:\\actions-runner",
    `./config.cmd --token ${token} --url https://github.com/replayableio/testdriver --labels ${instanceId} --name ${instanceId} --unattended --ephemeral --runasservice --windowslogonaccount Administrator --windowslogonpassword wwv9uJ0sqlulbN3`
  ];

  const command = new SendCommandCommand({
    InstanceIds: [instanceId],
    DocumentName: 'AWS-RunPowerShellScript',
    Parameters: {
      commands
    }
  });

  core.info("Sending Command To Instance, may take several tries");
  const maxTries = 30;
  for (let i = 0; i < maxTries; i++) {
    try {
      await client.send(command);
      core.info("Successfully sent command");
      return;
    }
    catch (e) {
      core.info(`Sending command... Attempt ${i} / ${maxTries}`);
      await sleep(5000);
    }
  }
  throw Error("Timed out trying to send command to instance");
}

/**
 * Start an instance from a launch template
 * launchTemplateId: string
 * launchTemplateVersion: string
 */
async function startEc2Instance(launchTemplateId, launchTemplateVersion, runId) {
  const client = new EC2Client();

  const runCommand = new RunInstancesCommand(
    {
      LaunchTemplate: {
        LaunchTemplateId: launchTemplateId,
        Version: launchTemplateVersion,
      },
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [{
          Key: "runId",
          Value: runId
        }]
      }],
      MinCount: 1,
      MaxCount: 1,
    });
  const runResponse = await client.send(runCommand);

  if (runResponse.Instances.length == 0) {
    throw Error("Instance Did Not start");
  }

  core.info(`Instance started: ${runResponse.Instances[0].InstanceId}`);
  return runResponse.Instances[0].InstanceId;
}

async function terminateEc2Instance(ec2InstanceId) {
  const client = new EC2Client();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  const command = new TerminateInstancesCommand(params);

  try {
    await client.send(command);
    core.info(`AWS EC2 instance ${ec2InstanceId} is terminated`);
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} termination error`);
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

async function startStoppedInstanceInAutoScalingGroup(groupName, runId) {
  const client = new EC2Client();

  const command = new DescribeInstancesCommand({
    Filters: [
      {
        Name: 'instance-state-name',
        Values: ['stopped']
      },
      {
        Name: 'tag:aws:autoscaling:groupName',
        Values: [groupName]
      },

      // Only where runId is empty
      {
        Name: 'tag:runId',
        Values: ['']
      }
    ]
  });

  core.info("Searching for warm runners");

  // Describe all instances
  const instancesData = await client.send(command);

  // Find the first stopped instance in the Auto Scaling group
  core.info(`Found ${instancesData.Reservations.length} Instances`);

  if (instancesData.Reservations.length == 0 ||
    instancesData.Reservations[0].Instances.length == 0) {
    core.warning("No Stopped Instance Found");
    return null;
  }

  // Get a random index as a quick fix to avoid simultaneous jobs
  const idx = Math.floor(Math.random() * instancesData.Reservations.length);
  const idx2 = Math.floor(Math.random() * instancesData.Reservations[idx].Instances.length);

  const instanceToStart = instancesData.Reservations[idx].Instances[idx2].InstanceId;
  core.info(`Found Stopped Instance: ${instanceToStart}`);

  // Add the runId Tag
  core.info(`Adding RunId as tag ${runId}`);
  await client.send(
    new CreateTagsCommand({
      Resources: [instanceToStart],
      Tags: [
        {
          Key: "runId",
          Value: runId,
        },
      ],
    })
  );

  // Create Start Command
  const startCommand = new StartInstancesCommand({
    InstanceIds: [instanceToStart]
  });

  core.info(`Starting Instance`);
  await client.send(startCommand);


  return instanceToStart;
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
  startStoppedInstanceInAutoScalingGroup,
  getLaunchTemplateFromASG,
  startRunnerCommand
};
