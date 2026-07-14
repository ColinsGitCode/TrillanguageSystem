'use strict';

const { PlanningSignalProvider } = require('./planningSignalProvider');

class GraphPlanningSignalProvider extends PlanningSignalProvider {
  constructor({ signalReader = null, ...options } = {}) {
    super({ id: 'graph-contract', version: '1.0.0', kind: 'graph', maxDurationMs: 10, ...options });
    this.signalReader = signalReader;
  }

  evaluate(studyItem, context) {
    if (!this.signalReader) return null;
    return this.signalReader.readPlanningSignal(studyItem, context);
  }
}

module.exports = { GraphPlanningSignalProvider };
