'use strict';

const { CompositePlanningSignalProvider } = require('./planningSignalProvider');
const { GraphPlanningSignalProvider } = require('./graphPlanningSignalProvider');
const { HeuristicPlanningSignalProvider } = require('./heuristicPlanningSignalProvider');

function createDefaultPlanningSignalProvider({ graphSignalReader = null } = {}) {
  return new CompositePlanningSignalProvider({
    providers: [
      new HeuristicPlanningSignalProvider(),
      new GraphPlanningSignalProvider({ signalReader: graphSignalReader }),
    ],
  });
}

module.exports = { createDefaultPlanningSignalProvider };
