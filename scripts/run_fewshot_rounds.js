const fs = require('fs');
const path = require('path');

const DEFAULT_ROUNDS = [
  {
    roundNumber: 0,
    roundName: 'baseline',
    variant: 'baseline',
    provider: 'local',
    isTeacherReference: false,
    fewshotOptions: { enabled: false }
  },
  {
    roundNumber: 1,
    roundName: 'fewshot_r1',
    variant: 'fewshot_r1',
    provider: 'local',
    isTeacherReference: false,
    fewshotOptions: { enabled: true, count: 1, minScore: 80, tokenBudgetRatio: 0.2 }
  },
  {
    roundNumber: 2,
    roundName: 'fewshot_r2',
    variant: 'fewshot_r2',
    provider: 'local',
    isTeacherReference: false,
    fewshotOptions: { enabled: true, count: 2, minScore: 82, tokenBudgetRatio: 0.22 }
  },
  {
    roundNumber: 3,
    roundName: 'fewshot_r3',
    variant: 'fewshot_r3',
    provider: 'local',
    isTeacherReference: false,
    fewshotOptions: { enabled: true, count: 3, minScore: 85, tokenBudgetRatio: 0.25 }
  }
];

function nowId() {
  return `exp_round_${Date.now()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadPhrases(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  return lines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

function loadRounds(configPath) {
  if (!configPath) return DEFAULT_ROUNDS;
  const text = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(text);
  const rounds = Array.isArray(parsed) ? parsed : parsed.rounds;
  if (!Array.isArray(rounds) || !rounds.length) {
    throw new Error('Invalid rounds config. Expect array or { rounds: [] }');
  }
  return rounds;
}

function summarize(items) {
  const valid = items.filter((item) => item.success);
  const stats = {
    count: items.length,
    successCount: valid.length,
    failCount: items.length - valid.length,
    avgQuality: 0,
    avgTokens: 0,
    avgLatency: 0
  };
  if (!valid.length) return stats;
  const totals = valid.reduce((acc, item) => {
    acc.quality += Number(item.qualityScore || 0);
    acc.tokens += Number(item.tokensTotal || 0);
    acc.latency += Number(item.latencyMs || 0);
    return acc;
  }, { quality: 0, tokens: 0, latency: 0 });
  stats.avgQuality = totals.quality / valid.length;
  stats.avgTokens = totals.tokens / valid.length;
  stats.avgLatency = totals.latency / valid.length;
  return stats;
}

function resolveRoundModel(provider, round) {
  if (round && round.model) return String(round.model);
  if (provider === 'gemini') {
    return String(process.env.GEMINI_TEACHER_MODEL || process.env.GEMINI_CLI_MODEL || '').trim();
  }
  if (provider === 'local') {
    return String(process.env.LLM_MODEL || '').trim();
  }
  return '';
}

async function run() {
  const phrasesFile = process.argv[2];
  const experimentId = process.argv[3] || nowId();
  const roundsConfigPath = process.argv[4] || '';
  const apiBase = process.argv[5] || process.env.API_BASE_URL || 'http://localhost:3010';
  const requestIntervalMs = Number(process.env.ROUND_REQUEST_INTERVAL_MS || 4200);

  if (!phrasesFile) {
    console.error('Usage: node scripts/run_fewshot_rounds.js <phrases.txt> [experimentId] [rounds.json] [apiBase]');
    process.exit(1);
  }

  const phrases = loadPhrases(phrasesFile);
  if (!phrases.length) {
    console.error('[rounds] no phrases found.');
    process.exit(1);
  }

  const rounds = loadRounds(roundsConfigPath);
  const outDir = path.join('Docs', 'TestDocs', 'data', 'rounds', experimentId);
  fs.mkdirSync(outDir, { recursive: true });

  const allRoundSummaries = [];
  console.log(`[rounds] experiment_id=${experimentId}, phrases=${phrases.length}, rounds=${rounds.length}`);

  for (const round of rounds) {
    const roundNumber = Number(round.roundNumber || 0);
    const roundName = round.roundName || `round_${roundNumber}`;
    const variant = round.variant || roundName;
    const provider = round.provider || 'local';
    const model = resolveRoundModel(provider, round);
    const isTeacherReference = Boolean(round.isTeacherReference);
    const fewshotOptions = round.fewshotOptions || {};

    console.log(`[rounds] start ${roundName} provider=${provider} model=${model || 'default'}`);
    const roundResults = [];
    const roundFile = path.join(outDir, `${roundName}.jsonl`);

    for (const phrase of phrases) {
      const body = {
        phrase,
        llm_provider: provider,
        enable_compare: false,
        experiment_id: experimentId,
        experiment_round: roundNumber,
        round_name: roundName,
        variant,
        is_teacher_reference: isTeacherReference,
        fewshot_options: fewshotOptions,
        llm_model: model || undefined
      };

      const startedAt = Date.now();
      try {
        const resp = await fetch(`${apiBase}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await resp.json();
        const success = resp.ok && json.success;
        const row = {
          phrase,
          roundNumber,
          roundName,
          provider,
          model,
          success,
          status: resp.status,
          generationId: json.generationId || null,
          qualityScore: json.observability?.quality?.score || 0,
          tokensTotal: json.observability?.tokens?.total || 0,
          latencyMs: json.observability?.performance?.totalTime || 0,
          elapsedMs: Date.now() - startedAt,
          error: success ? null : (json.error || `HTTP ${resp.status}`)
        };
        roundResults.push(row);
        fs.appendFileSync(roundFile, `${JSON.stringify({ request: body, response: json })}\n`);
        console.log(`[rounds] ${roundName} "${phrase}" => ${success ? 'ok' : 'fail'} q=${row.qualityScore}`);
      } catch (err) {
        const row = {
          phrase,
          roundNumber,
          roundName,
          provider,
          model,
          success: false,
          status: 0,
          generationId: null,
          qualityScore: 0,
          tokensTotal: 0,
          latencyMs: 0,
          elapsedMs: Date.now() - startedAt,
          error: err.message
        };
        roundResults.push(row);
        fs.appendFileSync(roundFile, `${JSON.stringify({ request: body, error: err.message })}\n`);
        console.log(`[rounds] ${roundName} "${phrase}" => fail ${err.message}`);
      }

      await sleep(requestIntervalMs);
    }

    const stats = summarize(roundResults);
    allRoundSummaries.push({
      roundNumber,
      roundName,
      provider,
      model,
      variant,
      isTeacherReference,
      fewshotOptions,
      ...stats
    });
  }

  const summary = {
    experimentId,
    apiBase,
    phrases,
    rounds: allRoundSummaries,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[rounds] done. output=${outDir}`);
}

run().catch((err) => {
  console.error('[rounds] fatal:', err.message);
  process.exit(1);
});
