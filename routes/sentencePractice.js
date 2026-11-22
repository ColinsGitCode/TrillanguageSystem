'use strict';

const express = require('express');
const dbService = require('../services/storage/databaseService');
const { E2E_TEST_MODE } = require('../lib/serverConfig');
const { createSentencePracticeService } = require('../services/practice/sentencePracticeService');

const router = express.Router();
const service = createSentencePracticeService({
  db: dbService.db,
  runWrite: operation => dbService.withBusyRetry(operation),
  ask: E2E_TEST_MODE ? async (_instructions, input) => (input.answer
    ? { feedback: '句意清楚，可以独立表达。', suggestion: '' }
    : { scene: '同一表达的新场景', cue: '请在另一个场景重新表达。', reference: input.anchor.reference })
    : undefined,
});

router.use('/api/sentence-practice', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.app.locals.workspacePolicy?.mode !== 'owner') {
    return res.status(403).json({ code: 'PRACTICE_OWNER_ONLY', error: '句子练习仅在个人工作区可用。' });
  }
  return next();
});

function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req))
    .then(payload => res.json({ success: true, ...payload })).catch(next);
}

router.post('/api/sentence-practice/prompts', route(async req => ({ prompt: await service.issue(req.body || {}) })));
router.post('/api/sentence-practice/:id/answer', route(async req => ({ attempt: await service.submit(req.params.id, req.body?.answer) })));
router.patch('/api/sentence-practice/:id', route(async req => ({ attempt: await service.assess(req.params.id, req.body || {}) })));
router.get('/api/sentence-practice/history', route(() => ({ attempts: service.history() })));

module.exports = router;
