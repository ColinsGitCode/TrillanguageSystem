'use strict';

const { PlanningSignalProvider } = require('./planningSignalProvider');

class EngagementPlanningSignalProvider extends PlanningSignalProvider {
  constructor({ signalReader = null, ...options } = {}) {
    super({ id: 'card-engagement-v1', version: '1.0.0', kind: 'behavioral', maxDurationMs: 10, ...options });
    this.signalReader = signalReader;
  }

  evaluate(studyItem, context) {
    if (!this.signalReader) return null;
    return this.signalReader.readPlanningSignal(studyItem, context);
  }
}

module.exports = { EngagementPlanningSignalProvider };
