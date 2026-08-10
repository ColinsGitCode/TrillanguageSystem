'use strict';

const { CompositePlanningSignalProvider } = require('./planningSignalProvider');
const { GraphPlanningSignalProvider } = require('./graphPlanningSignalProvider');
const { HeuristicPlanningSignalProvider } = require('./heuristicPlanningSignalProvider');
const { EngagementPlanningSignalProvider } = require('./engagementPlanningSignalProvider');

function createDefaultPlanningSignalProvider({
  graphSignalReader = null,
  engagementSignalReader = null,
  clock,
} = {}) {
  return new CompositePlanningSignalProvider({
    providers: [
      new HeuristicPlanningSignalProvider(),
      new EngagementPlanningSignalProvider({ signalReader: engagementSignalReader }),
      new GraphPlanningSignalProvider({ signalReader: graphSignalReader }),
    ],
    clock,
  });
}

module.exports = { createDefaultPlanningSignalProvider };
