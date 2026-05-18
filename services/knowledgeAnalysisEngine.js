'use strict';

// Dispatcher only — each task lives in services/knowledge/tasks/<name>.js
// and the shared text utilities are in services/knowledge/textUtils.js.
// `runTask` is the public entry point used by knowledgeJobService.

const summaryTask = require('./knowledge/tasks/summary');
const cardIndexTask = require('./knowledge/tasks/cardIndex');
const synonymBoundaryTask = require('./knowledge/tasks/synonymBoundary');
const grammarLinkTask = require('./knowledge/tasks/grammarLink');
const clusterTask = require('./knowledge/tasks/cluster');
const issuesAuditTask = require('./knowledge/tasks/issuesAudit');

function wrapResult(task, result, inputCount) {
  const hasPayload = result && Object.keys(result).length > 0;
  return {
    task,
    status: hasPayload ? 'ok' : 'partial',
    warnings: [],
    errors: [],
    quality: {
      confidence: hasPayload ? 0.75 : 0.4,
      coverageRatio: inputCount > 0 ? 1 : 0
    },
    result: result || {}
  };
}

async function runTask(taskType, cards = [], taskOptions = {}) {
  const normalizedTask = String(taskType || '').trim().toLowerCase();
  switch (normalizedTask) {
    case 'summary':
      return wrapResult('summary', summaryTask.run(cards), cards.length);
    case 'index':
      return wrapResult('index', cardIndexTask.run(cards), cards.length);
    case 'synonym_boundary':
      return wrapResult('synonym_boundary', await synonymBoundaryTask.run(cards, taskOptions), cards.length);
    case 'grammar_link':
      return wrapResult('grammar_link', grammarLinkTask.run(cards), cards.length);
    case 'cluster':
      return wrapResult('cluster', clusterTask.run(cards), cards.length);
    case 'issues_audit':
      return wrapResult('issues_audit', issuesAuditTask.run(cards), cards.length);
    default:
      return {
        task: normalizedTask || 'unknown',
        status: 'failed',
        warnings: [],
        errors: [`Unsupported task type: ${normalizedTask}`],
        quality: { confidence: 0, coverageRatio: 0 },
        result: {}
      };
  }
}

module.exports = {
  runTask,
};
