'use strict';

// Single source of truth for the Gemini request-chain timeout hierarchy.
//
// Chain: client (geminiProxyService) -> gateway (geminiGatewayServer)
//        -> executor (gemini-host-proxy) -> gemini CLI
//
// Each transport hop waits one HOP_BUFFER longer than the layer it wraps, so
// the innermost layer (the CLI) always times out first and reports a clean,
// specific error instead of an outer layer aborting with a generic timeout.
// This is dependency-free on purpose: the gateway and executor run as
// standalone processes and require it directly.

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Execution budget for a normal interactive call (the gemini CLI run).
const EXECUTION_BUDGET_MS = positiveNumber(process.env.GEMINI_EXECUTION_BUDGET_MS, 90000);

// Hard ceiling on any single CLI run, sized for the longest job (training).
// The executor caps every request by this regardless of what the caller asks.
const MAX_EXECUTION_BUDGET_MS = positiveNumber(process.env.GEMINI_MAX_EXECUTION_BUDGET_MS, 240000);

// Slack added per transport hop so outer layers outlive inner ones.
const HOP_BUFFER_MS = positiveNumber(process.env.GEMINI_HOP_BUFFER_MS, 15000);

// Clamp a requested execution budget to the executor's hard ceiling.
function clampExecutionBudget(budgetMs) {
  return Math.min(positiveNumber(budgetMs, EXECUTION_BUDGET_MS), MAX_EXECUTION_BUDGET_MS);
}

// Gateway abort deadline for a given execution budget (one hop out).
function gatewayTimeoutFor(budgetMs) {
  return clampExecutionBudget(budgetMs) + HOP_BUFFER_MS;
}

// Client abort deadline for a given execution budget (two hops out).
function clientTimeoutFor(budgetMs) {
  return clampExecutionBudget(budgetMs) + 2 * HOP_BUFFER_MS;
}

module.exports = {
  EXECUTION_BUDGET_MS,
  MAX_EXECUTION_BUDGET_MS,
  HOP_BUFFER_MS,
  clampExecutionBudget,
  gatewayTimeoutFor,
  clientTimeoutFor,
};
