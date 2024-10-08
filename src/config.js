const core = require('@actions/core');
const github = require('@actions/github');

class Config {
  constructor() {
    this.input = {
      // i.e. start or stop
      mode: core.getInput('mode'),
      githubToken: core.getInput('github-token'),
      // Group ID that contains the warm start group and the template
      ec2AutoScalingGroupName: core.getInput('ec2-auto-scaling-group-name'),
      // Ec2 Instance to stop
      ec2InstanceId: core.getInput('ec2-instance-id'),
      ec2Os: core.getInput('ec2-os'),
    };

    // the values of github.context.repo.owner and github.context.repo.repo are taken from
    // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
    // provided by the GitHub Action on the runtime
    this.githubContext = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    };

    //
    // validate input
    //
    if (!this.input.mode) {
      throw new Error(`The 'mode' input is not specified`);
    }

    if (!this.input.githubToken) {
      throw new Error(`The 'github-token' input is not specified`);
    }

    if (this.input.mode === 'start') {
      if (
        !this.input.ec2Os ||
        !this.input.ec2AutoScalingGroupName
      ) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode`);
      }
      if (this.input.ec2Os !== 'windows' && this.input.ec2Os !== 'linux' && this.input.ec2Os !== 'mac') {
        throw new Error(`Wrong ec2-os. Allowed values: mac, windows or linux.`);
      }
    } else if (this.input.mode === 'stop') {
      if (!this.input.ec2InstanceId) {
        throw new Error(`Not all the required inputs are provided for the 'stop' mode`);
      }
    } else {
      throw new Error('Wrong mode. Allowed values: start, stop.');
    }
  }
}

try {
  module.exports = new Config();
} catch (error) {
  core.error(error);
  core.setFailed(error.message);
}
