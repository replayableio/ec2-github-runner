const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

async function start() {
  const groupName = config.input.ec2AutoScalingGroupName;
  let ec2InstanceId = await aws.startStoppedInstanceInAutoScalingGroup(groupName);

  // If did not start, start one from cold, get ID
  if (!ec2InstanceId) {
    core.info("Could not launch from AutoScaling Group, attempting cold start");
    let template = await aws.getLaunchTemplateFromASG(config.input.ec2AutoScalingGroupName);
    ec2InstanceId = aws.startEc2Instance(template.id, template.version);
  }

  if (!ec2InstanceId) {
    throw Error("Could not start instance");
  }

  core.setOutput('ec2-instance-id', ec2InstanceId);

  await aws.waitForInstanceRunning(ec2InstanceId);
  await gh.waitForRunnerRegistered(ec2InstanceId);
}

async function stop() {
  const ec2InstanceId = config.input.ec2InstanceId;
  core.info(`Stopping ${ec2InstanceId}`);
  await aws.terminateEc2Instance(ec2InstanceId);
  await gh.removeRunner(ec2InstanceId);
}

(async function() {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
