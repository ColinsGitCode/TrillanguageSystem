'use strict';

class SchedulerPort {
  schedule() {
    throw new Error('SchedulerPort.schedule must be implemented');
  }

  describe() {
    throw new Error('SchedulerPort.describe must be implemented');
  }
}

module.exports = { SchedulerPort };
