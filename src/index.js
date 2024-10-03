const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId) {
  core.setOutput('label', "zbcby");
  core.setOutput('ec2-instance-id', ec2InstanceId);
}

async function start() {
  // const label = config.generateUniqueLabel();

  const label = "zbcby";
  const githubRegistrationToken = await gh.getRegistrationToken();
  core.info("TOKEN");
  core.info(githubRegistrationToken);
  const ec2InstanceId = await aws.restartEc2Instance(label, githubRegistrationToken);
  setOutput(label, ec2InstanceId);
  await aws.waitForInstanceRunning(ec2InstanceId);
  // await gh.waitForRunnerRegistered(label);
}

async function stop() {
  // await aws.terminateEc2Instance();
  // await gh.removeRunner();
}

async function manage_instances() {
  core.setOutput('label', 'instanceid')
  // const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceId = await aws.startEc2Instance("label", "");
  // await aws.terminateEc2Instance();
  // await gh.removeRunner();
}

(async function() {
  try {
    if (config.input.mode === 'start') {
      await start()
    }

    else if (config.input.mode === 'stop') {
      await stop()
    }

    else if (config.input.mode === 'manage') {
      await manage_instances();
    }

  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
