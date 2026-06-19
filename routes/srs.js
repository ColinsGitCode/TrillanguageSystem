'use strict';

// Spaced-repetition endpoints. The daily review queue + grading. State lives in
// card_srs / card_reviews (see services/storage/db/cardSrs.js); the scheduling
// math is in services/srs/srsScheduler.js.

const express = require('express');
const { dbService } = require('./_shared');
const { isValidGrade, GRADES } = require('../services/srs/srsScheduler');

const router = express.Router();

// Cards due now (tracked + overdue) plus new (untracked) cards, with stats.
router.get('/api/srs/queue', (req, res) => {
  try {
    const queue = dbService.getSrsQueue({
      limit: Number(req.query.limit || 20),
      cardType: String(req.query.cardType || '')
    });
    res.json({ success: true, queue, grades: GRADES, stats: dbService.getSrsStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/srs/stats', (req, res) => {
  try {
    res.json({ success: true, stats: dbService.getSrsStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/srs/engagement', (_req, res) => {
  try {
    res.json({ success: true, engagement: dbService.getSrsEngagement() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/srs/goal', (_req, res) => {
  try {
    res.json({ success: true, goal: dbService.getDailyGoal() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/srs/goal', (req, res) => {
  try {
    const goal = dbService.setDailyGoal(req.body?.goal);
    res.json({ success: true, goal });
  } catch (err) {
    const status = /goal must be an integer/.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Staged learning path: one stage per active semantic cluster (axis-scoped),
// ordered easy → hard, with SRS progress + difficulty mix.
router.get('/api/srs/plan', (req, res) => {
  try {
    const plan = dbService.getLearningPlan({ axis: String(req.query.axis || 'all') });
    res.json({ success: true, ...plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grade a card (again / hard / good / easy) → advance its schedule.
router.post('/api/srs/review', (req, res) => {
  try {
    const generationId = Number(req.body?.generationId || 0);
    const grade = String(req.body?.grade || '');
    if (!generationId) return res.status(400).json({ error: 'generationId is required' });
    if (!isValidGrade(grade)) return res.status(400).json({ error: `invalid grade (expected one of: ${GRADES.join(', ')})` });

    const state = dbService.reviewCardSrs(generationId, grade);
    if (!state) return res.status(404).json({ error: 'card not found' });
    res.json({ success: true, state, stats: dbService.getSrsStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
