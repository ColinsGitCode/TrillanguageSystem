'use strict';

// Test-only route. POST /api/_test/reset wipes every project DB table and
// clears RECORDS_PATH contents so each Playwright spec file can start from
// a clean slate without restarting the server. The route is only mounted
// when E2E_TEST_MODE=1 — see server.js where the conditional `app.use(...)`
// lives. Treat this as a hard contract: never call from production code
// and never expose without the env gate.

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  dbService,
  generationJobService,
  RECORDS_PATH,
} = require('./_shared');
const log = require('../lib/logger').child({ module: 'route/test-reset' });

const router = express.Router();

function wipeRecordsDir() {
  if (!RECORDS_PATH) return;
  let entries;
  try {
    entries = fs.readdirSync(RECORDS_PATH, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const target = path.join(RECORDS_PATH, entry.name);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

router.post('/api/_test/reset', (req, res) => {
  try {
    dbService.truncateAllForTests();
    generationJobService.resetForTests();
    wipeRecordsDir();
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'test reset failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Test-only: seed a deterministic mini knowledge corpus so the Knowledge Hub
// browse specs have categories / terms / clusters to exercise without running
// the (E2E-stubbed) knowledge jobs. 4 generations → terms_index; 3 are mapped
// to active clusters across both axes, the 4th is left uncategorized.
router.post('/api/_test/seed-knowledge', (req, res) => {
  try {
    const buildGen = (overrides) => ({
      generation: {
        phrase: 'x', phraseLanguage: 'ja', cardType: 'grammar_ja', sourceMode: 'input',
        llmProvider: 'deepseek', llmModel: 'deepseek-v4-pro', folderName: '20260101',
        baseFilename: 'x', mdFilePath: '', htmlFilePath: '', metaFilePath: '',
        markdownContent: '# x', enTranslation: '', jaTranslation: '', zhTranslation: '',
        generationDate: '2026-01-01', requestId: `seed_${Math.random().toString(36).slice(2)}`,
        ...overrides
      },
      observability: {
        tokensInput: 0, tokensOutput: 0, tokensTotal: 0, tokensCached: 0,
        costInput: 0, costOutput: 0, costTotal: 0, costCurrency: 'USD',
        quotaUsed: 0, quotaLimit: 0, quotaRemaining: 0, quotaResetAt: null, quotaPercentage: 0,
        performanceTotalMs: 0, performancePhases: null,
        qualityScore: 80, qualityChecks: null, qualityDimensions: null, qualityWarnings: null,
        promptFull: '', promptParsed: null, llmOutput: '', llmFinishReason: 'stop', metadata: null
      },
      audioFiles: []
    });

    // Write a minimal .md per card so the Knowledge Hub's embedded card modal
    // (/?card=<id>&embed=1) can render it without a real generation pipeline.
    const writeCardFile = (base, phrase) => {
      if (!RECORDS_PATH) return;
      const dir = path.join(RECORDS_PATH, '20260101');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${base}.md`), `# ${phrase}\n\n## 1. 概述\n- seed card\n`);
    };
    writeCardFile('kara', '〜から');
    writeCardFile('tai', '〜たい');
    writeCardFile('api', 'api');
    writeCardFile('uncat', '未分类示例');

    const g1 = dbService.insertGeneration(buildGen({ phrase: '〜から', baseFilename: 'kara', cardType: 'grammar_ja' }));
    const g2 = dbService.insertGeneration(buildGen({ phrase: '〜たい', baseFilename: 'tai', cardType: 'grammar_ja' }));
    const g3 = dbService.insertGeneration(buildGen({ phrase: 'api', baseFilename: 'api', cardType: 'trilingual', phraseLanguage: 'en' }));
    const g4 = dbService.insertGeneration(buildGen({ phrase: '未分类示例', baseFilename: 'uncat', cardType: 'grammar_ja' }));

    dbService.upsertKnowledgeTermsIndex([
      { generationId: g1, phrase: '〜から', cardType: 'grammar_ja', folderName: '20260101', langProfile: 'ja', score: 0.9 },
      { generationId: g2, phrase: '〜たい', cardType: 'grammar_ja', folderName: '20260101', langProfile: 'ja', score: 0.8 },
      { generationId: g3, phrase: 'api', cardType: 'trilingual', folderName: '20260101', langProfile: 'en', score: 0.7 },
      { generationId: g4, phrase: '未分类示例', cardType: 'grammar_ja', folderName: '20260101', langProfile: 'ja', score: 0.5 }
    ], null);

    const clusterJobId = dbService.createKnowledgeJob({ jobType: 'cluster' }).id;
    dbService.replaceKnowledgeClusterData([
      { clusterKey: 'fn_causation', label: '因果关系', description: '原因/理由/结果', keywords: ['から'], taxonomy: 'function', confidence: 0.8, cards: [{ generationId: g1, score: 0.9 }] },
      { clusterKey: 'fn_intention', label: '意愿·目的·计划', description: '意愿/目的', keywords: ['たい'], taxonomy: 'function', confidence: 0.7, cards: [{ generationId: g2, score: 0.8 }] },
      { clusterKey: 'tp_engineering', label: '工程技术', description: '架构/接口', keywords: ['api'], taxonomy: 'topic', confidence: 0.8, cards: [{ generationId: g3, score: 0.9 }] }
    ], clusterJobId);

    res.json({ ok: true, ids: { g1, g2, g3, g4 } });
  } catch (err) {
    log.error({ err }, 'test seed-knowledge failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
