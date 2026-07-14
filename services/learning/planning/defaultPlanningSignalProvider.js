'use strict';

const { CompositePlanningSignalProvider } = require('./planningSignalProvider');
const { GraphPlanningSignalProvider } = require('./graphPlanningSignalProvider');
const { HeuristicPlanningSignalProvider } = require('./heuristicPlanningSignalProvider');

function createDefaultPlanningSignalProvider() {
  return new CompositePlanningSignalProvider({
    providers: [
      new HeuristicPlanningSignalProvider(),
      new GraphPlanningSignalProvider(),
    ],
  });
}

module.exports = { createDefaultPlanningSignalProvider };
