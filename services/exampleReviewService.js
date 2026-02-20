const crypto = require('crypto');
const dbService = require('./databaseService');
const { parseTrilingualMarkdown } = require('./markdownParser');

const DEFAULT_REVIEWER = process.env.REVIEW_DEFAULT_REVIEWER || 'owner';

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\u3000/g, ' ')
    .trim();
}

function normalizeForHash(text) {
  return normalizeText(text).toLowerCase();
}

function buildDedupeHash(lang, sentence, translation) {
  return crypto
    .createHash('sha256')
    .update(`${lang}|${normalizeForHash(sentence)}|${normalizeForHash(translation)}`)
    .digest('hex');
}

function bigramSimilarity(a, b) {
  const strA = normalizeForHash(a);
  const strB = normalizeForHash(b);
  if (!strA || !strB) return 0;
  if (strA === strB) return 1;
  const setA = new Set();
  const setB = new Set();
  for (let i = 0; i < strA.length - 1; i += 1) setA.add(strA.slice(i, i + 2));
  for (let i = 0; i < strB.length - 1; i += 1) setB.add(strB.slice(i, i + 2));
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  setA.forEach((bg) => {
    if (setB.has(bg)) overlap += 1;
  });
  return (2 * overlap) / (setA.size + setB.size);
}

function extractExamplesFromMarkdown(phrase, markdown) {
  const parsed = parseTrilingualMarkdown(markdown || '');
  const rows = [];
  const enExamples = parsed?.sections?.en?.examples || [];
  const jaExamples = parsed?.sections?.ja?.examples || [];

  enExamples.forEach((example, idx) => {
    const sentence = normalizeText(example?.text);
    const translation = normalizeText(example?.translation);
    if (!sentence || !translation) return;
    rows.push({
      lang: 'en',
      sentenceText: sentence,
      translationText: translation,
      sourcePhrase: normalizeText(phrase),
      sourceSlot: `en_${idx + 1}`
    });
  });

  jaExamples.forEach((example, idx) => {
    const sentence = normalizeText(example?.text);
    const translation = normalizeText(example?.translation);
    if (!sentence || !translation) return;
    rows.push({
      lang: 'ja',
      sentenceText: sentence,
      translationText: translation,
      sourcePhrase: normalizeText(phrase),
      sourceSlot: `ja_${idx + 1}`
    });
  });

  return rows;
}

function computeEligibility(agg, policy = {}) {
  const minVotes = Number(policy.minVotes || 1);
  const minOverall = Number(policy.minOverall || 4.2);
  const minSentence = Number(policy.minSentence || 4.0);
  const minTranslation = Number(policy.minTranslation || 4.0);
  const maxRejectRate = Number(policy.maxRejectRate || 0.3);

  const votes = Number(agg.votes || 0);
  if (votes < minVotes) return 'pending';

  const sentence = Number(agg.avgSentence || 0);
  const translation = Number(agg.avgTranslation || 0);
  const tts = Number(agg.avgTts || 0);
  const overall = 0.45 * sentence + 0.45 * translation + 0.1 * tts;
  const rejectRate = votes > 0 ? Number(agg.rejectVotes || 0) / votes : 0;

  if (rejectRate >= maxRejectRate) return 'rejected';
  if (overall >= minOverall && sentence >= minSentence && translation >= minTranslation) return 'approved';
  return 'rejected';
}

class ExampleReviewService {
  constructor() {
    this.db = dbService.db;
  }

  ingestGeneration(payload = {}) {
    const generationId = Number(payload.generationId || 0);
    if (!generationId) return { inserted: 0, linked: 0, total: 0 };

    const phrase = normalizeText(payload.phrase || '');
    const folderName = normalizeText(payload.folderName || '');
    const baseFilename = normalizeText(payload.baseFilename || '');
    const markdown = String(payload.markdownContent || '');
    const examples = extractExamplesFromMarkdown(phrase, markdown);
    if (!examples.length) return { inserted: 0, linked: 0, total: 0 };

    const upsertUnit = this.db.prepare(`
      INSERT INTO example_units (
        dedupe_hash, lang, sentence_text, translation_text, source_phrase,
        first_generation_id, last_generation_id, source_count, eligibility
      ) VALUES (
        @dedupeHash, @lang, @sentenceText, @translationText, @sourcePhrase,
        @generationId, @generationId, 0, 'pending'
      )
      ON CONFLICT(dedupe_hash) DO UPDATE SET
        source_phrase = excluded.source_phrase,
        last_generation_id = excluded.last_generation_id,
        updated_at = CURRENT_TIMESTAMP
    `);

    const getUnitByHash = this.db.prepare(`
      SELECT id FROM example_units WHERE dedupe_hash = @dedupeHash LIMIT 1
    `);

    const insertSource = this.db.prepare(`
      INSERT OR IGNORE INTO example_unit_sources (
        example_id, generation_id, phrase, folder_name, base_filename, source_slot
      ) VALUES (
        @exampleId, @generationId, @phrase, @folderName, @baseFilename, @sourceSlot
      )
    `);

    const refreshCounters = this.db.prepare(`
      UPDATE example_units
      SET
        source_count = (
          SELECT COUNT(*) FROM example_unit_sources eus WHERE eus.example_id = @exampleId
        ),
        last_generation_id = @generationId,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @exampleId
    `);

    const tx = this.db.transaction((rows) => {
      let inserted = 0;
      let linked = 0;
      rows.forEach((row) => {
        const dedupeHash = buildDedupeHash(row.lang, row.sentenceText, row.translationText);
        const result = upsertUnit.run({
          dedupeHash,
          generationId,
          lang: row.lang,
          sentenceText: row.sentenceText,
          translationText: row.translationText,
          sourcePhrase: row.sourcePhrase || phrase
        });
        if (result.changes > 0 && result.lastInsertRowid) inserted += 1;

        const unit = getUnitByHash.get({ dedupeHash });
        if (!unit?.id) return;

        const sourceRes = insertSource.run({
          exampleId: unit.id,
          generationId,
          phrase: row.sourcePhrase || phrase,
          folderName,
          baseFilename,
          sourceSlot: row.sourceSlot
        });
        if (sourceRes.changes > 0) linked += 1;
        refreshCounters.run({ exampleId: unit.id, generationId });
      });
      return { inserted, linked, total: rows.length };
    });

    return tx(examples);
  }

  backfillMissingGenerations(limit = 0) {
    const sql = `
      SELECT g.id, g.phrase, g.markdown_content, g.folder_name, g.base_filename
      FROM generations g
      LEFT JOIN example_unit_sources eus ON eus.generation_id = g.id
      WHERE eus.id IS NULL
      ORDER BY g.id ASC
      ${limit > 0 ? 'LIMIT ?' : ''}
    `;
    const rows = limit > 0 ? this.db.prepare(sql).all(Number(limit)) : this.db.prepare(sql).all();
    let inserted = 0;
    let linked = 0;
    rows.forEach((row) => {
      const result = this.ingestGeneration({
        generationId: row.id,
        phrase: row.phrase,
        markdownContent: row.markdown_content,
        folderName: row.folder_name,
        baseFilename: row.base_filename
      });
      inserted += result.inserted;
      linked += result.linked;
    });
    return { generations: rows.length, inserted, linked };
  }

  getCampaigns() {
    return this.db.prepare(`
      SELECT * FROM review_campaigns ORDER BY created_at DESC
    `).all();
  }

  getActiveCampaign() {
    return this.db.prepare(`
      SELECT * FROM review_campaigns
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() || null;
  }

  getCampaignById(campaignId) {
    return this.db.prepare(`
      SELECT * FROM review_campaigns WHERE id = ?
    `).get(Number(campaignId)) || null;
  }

  syncCampaignStats(campaignId) {
    const summary = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN rci.status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
        SUM(CASE WHEN eu.eligibility = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN eu.eligibility = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM review_campaign_items rci
      JOIN example_units eu ON eu.id = rci.example_id
      WHERE rci.campaign_id = ?
    `).get(Number(campaignId));

    this.db.prepare(`
      UPDATE review_campaigns
      SET
        total_examples = @total,
        reviewed_examples = @reviewed,
        approved_examples = @approved,
        rejected_examples = @rejected,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @campaignId
    `).run({
      campaignId: Number(campaignId),
      total: Number(summary?.total || 0),
      reviewed: Number(summary?.reviewed || 0),
      approved: Number(summary?.approved || 0),
      rejected: Number(summary?.rejected || 0)
    });

    return this.getCampaignById(campaignId);
  }

  createCampaign(payload = {}) {
    const active = this.getActiveCampaign();
    if (active) return this.syncCampaignStats(active.id);

    this.backfillMissingGenerations();

    const name = normalizeText(payload.name) || `review_${new Date().toISOString().slice(0, 10)}`;
    const createdBy = normalizeText(payload.createdBy || DEFAULT_REVIEWER);
    const notes = normalizeText(payload.notes || '');
    const snapshotAt = new Date().toISOString();

    const insertCampaign = this.db.prepare(`
      INSERT INTO review_campaigns (name, status, scope, snapshot_at, created_by, notes)
      VALUES (@name, 'active', 'existing_snapshot', @snapshotAt, @createdBy, @notes)
    `);
    const insertItems = this.db.prepare(`
      INSERT OR IGNORE INTO review_campaign_items (campaign_id, example_id)
      SELECT @campaignId, eu.id
      FROM example_units eu
      WHERE eu.created_at <= @snapshotAt
    `);

    const tx = this.db.transaction(() => {
      const campaignRes = insertCampaign.run({ name, snapshotAt, createdBy, notes });
      const campaignId = Number(campaignRes.lastInsertRowid);
      insertItems.run({ campaignId, snapshotAt });
      return campaignId;
    });

    const campaignId = tx();
    return this.syncCampaignStats(campaignId);
  }

  getCampaignProgress(campaignId) {
    const campaign = this.syncCampaignStats(campaignId);
    if (!campaign) return null;
    const total = Number(campaign.total_examples || 0);
    const reviewed = Number(campaign.reviewed_examples || 0);
    return {
      ...campaign,
      pending_examples: Math.max(0, total - reviewed),
      completion_rate: total > 0 ? Number(((reviewed / total) * 100).toFixed(2)) : 0
    };
  }

  getGenerationExamples(generationId, options = {}) {
    const campaignId = options.campaignId ? Number(options.campaignId) : null;
    const reviewer = normalizeText(options.reviewer || DEFAULT_REVIEWER);

    const rows = this.db.prepare(`
      SELECT
        eu.id,
        eu.lang,
        eu.sentence_text AS sentenceText,
        eu.translation_text AS translationText,
        eu.source_phrase AS sourcePhrase,
        eu.eligibility,
        eu.review_score_overall AS reviewScoreOverall,
        eu.review_votes AS reviewVotes,
        eus.source_slot AS sourceSlot,
        rci.status AS campaignStatus,
        er.score_sentence AS scoreSentence,
        er.score_translation AS scoreTranslation,
        er.score_tts AS scoreTts,
        er.decision,
        er.comment,
        er.updated_at AS reviewedAt
      FROM example_unit_sources eus
      JOIN example_units eu ON eu.id = eus.example_id
      LEFT JOIN review_campaign_items rci
        ON rci.example_id = eu.id
       AND rci.campaign_id = @campaignId
      LEFT JOIN example_reviews er
        ON er.example_id = eu.id
       AND er.campaign_id = @campaignId
       AND er.reviewer = @reviewer
      WHERE eus.generation_id = @generationId
      ORDER BY
        CASE WHEN eus.source_slot LIKE 'en_%' THEN 0 ELSE 1 END,
        eus.source_slot ASC
    `).all({
      generationId: Number(generationId),
      campaignId,
      reviewer
    });

    return rows;
  }

  upsertReview(payload = {}) {
    const exampleId = Number(payload.exampleId || 0);
    const campaignId = payload.campaignId ? Number(payload.campaignId) : null;
    const reviewer = normalizeText(payload.reviewer || DEFAULT_REVIEWER);
    const scoreSentence = Number(payload.scoreSentence || 0);
    const scoreTranslation = Number(payload.scoreTranslation || 0);
    const scoreTts = Number(payload.scoreTts || 0);
    const comment = String(payload.comment || '').trim();
    const decision = normalizeText(payload.decision || 'neutral') || 'neutral';

    const scoreValues = [scoreSentence, scoreTranslation, scoreTts];
    if (!exampleId) throw new Error('exampleId is required');
    if (!scoreValues.every((score) => Number.isFinite(score) && score >= 1 && score <= 5)) {
      throw new Error('scores must be integers between 1 and 5');
    }
    if (!['approve', 'reject', 'neutral'].includes(decision)) {
      throw new Error('decision must be approve/reject/neutral');
    }

    const upsertReview = this.db.prepare(`
      INSERT INTO example_reviews (
        example_id, campaign_id, reviewer,
        score_sentence, score_translation, score_tts,
        decision, comment
      ) VALUES (
        @exampleId, @campaignId, @reviewer,
        @scoreSentence, @scoreTranslation, @scoreTts,
        @decision, @comment
      )
      ON CONFLICT(example_id, campaign_id, reviewer) DO UPDATE SET
        score_sentence = excluded.score_sentence,
        score_translation = excluded.score_translation,
        score_tts = excluded.score_tts,
        decision = excluded.decision,
        comment = excluded.comment,
        updated_at = CURRENT_TIMESTAMP
    `);

    const markReviewed = this.db.prepare(`
      UPDATE review_campaign_items
      SET status = 'reviewed', reviewed_at = CURRENT_TIMESTAMP
      WHERE campaign_id = @campaignId AND example_id = @exampleId
    `);

    const aggregate = this.db.prepare(`
      SELECT
        AVG(score_sentence) AS avgSentence,
        AVG(score_translation) AS avgTranslation,
        AVG(score_tts) AS avgTts,
        COUNT(*) AS votes
      FROM example_reviews
      WHERE example_id = @exampleId
    `);

    const updateUnit = this.db.prepare(`
      UPDATE example_units
      SET
        review_score_sentence = @avgSentence,
        review_score_translation = @avgTranslation,
        review_score_tts = @avgTts,
        review_score_overall = @overall,
        review_votes = @votes,
        review_comment_latest = @comment,
        last_reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @exampleId
    `);

    const tx = this.db.transaction(() => {
      upsertReview.run({
        exampleId,
        campaignId,
        reviewer,
        scoreSentence,
        scoreTranslation,
        scoreTts,
        decision,
        comment
      });
      if (campaignId) markReviewed.run({ campaignId, exampleId });
      const agg = aggregate.get({ exampleId }) || {};
      const avgSentence = Number(agg.avgSentence || 0);
      const avgTranslation = Number(agg.avgTranslation || 0);
      const avgTts = Number(agg.avgTts || 0);
      const overall = Number((0.45 * avgSentence + 0.45 * avgTranslation + 0.1 * avgTts).toFixed(3));
      updateUnit.run({
        exampleId,
        avgSentence,
        avgTranslation,
        avgTts,
        overall,
        votes: Number(agg.votes || 0),
        comment: comment || null
      });
    });

    tx();
    if (campaignId) this.syncCampaignStats(campaignId);

    return this.db.prepare(`
      SELECT
        eu.id,
        eu.review_score_sentence AS reviewScoreSentence,
        eu.review_score_translation AS reviewScoreTranslation,
        eu.review_score_tts AS reviewScoreTts,
        eu.review_score_overall AS reviewScoreOverall,
        eu.review_votes AS reviewVotes,
        eu.eligibility
      FROM example_units eu
      WHERE eu.id = ?
    `).get(exampleId);
  }

  finalizeCampaign(campaignId, policy = {}) {
    const progress = this.getCampaignProgress(campaignId);
    if (!progress) throw new Error('campaign not found');
    if (progress.status !== 'active') throw new Error('campaign is not active');

    const allowPartial = Boolean(policy.allowPartial || policy.force);
    if (!allowPartial && Number(progress.pending_examples || 0) > 0) {
      throw new Error('campaign has pending examples, please finish reviews before finalize');
    }

    const rows = this.db.prepare(`
      SELECT
        rci.example_id AS exampleId,
        AVG(er.score_sentence) AS avgSentence,
        AVG(er.score_translation) AS avgTranslation,
        AVG(er.score_tts) AS avgTts,
        COUNT(er.id) AS votes,
        SUM(CASE WHEN er.decision = 'approve' THEN 1 ELSE 0 END) AS approveVotes,
        SUM(CASE WHEN er.decision = 'reject' THEN 1 ELSE 0 END) AS rejectVotes,
        MAX(er.comment) AS latestComment
      FROM review_campaign_items rci
      LEFT JOIN example_reviews er
        ON er.example_id = rci.example_id
       AND er.campaign_id = rci.campaign_id
      WHERE rci.campaign_id = ?
      GROUP BY rci.example_id
    `).all(Number(campaignId));

    const updateUnit = this.db.prepare(`
      UPDATE example_units
      SET
        review_score_sentence = @avgSentence,
        review_score_translation = @avgTranslation,
        review_score_tts = @avgTts,
        review_score_overall = @overall,
        review_votes = @votes,
        review_comment_latest = @comment,
        eligibility = @eligibility,
        last_reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @exampleId
    `);

    const markReviewed = this.db.prepare(`
      UPDATE review_campaign_items
      SET status = CASE WHEN @votes > 0 THEN 'reviewed' ELSE status END,
          reviewed_at = CASE WHEN @votes > 0 THEN COALESCE(reviewed_at, CURRENT_TIMESTAMP) ELSE reviewed_at END
      WHERE campaign_id = @campaignId
        AND example_id = @exampleId
    `);

    const finalizeCampaign = this.db.prepare(`
      UPDATE review_campaigns
      SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const tx = this.db.transaction(() => {
      rows.forEach((row) => {
        const votes = Number(row.votes || 0);
        const avgSentence = Number(row.avgSentence || 0);
        const avgTranslation = Number(row.avgTranslation || 0);
        const avgTts = Number(row.avgTts || 0);
        const overall = Number((0.45 * avgSentence + 0.45 * avgTranslation + 0.1 * avgTts).toFixed(3));
        const eligibility = computeEligibility({
          ...row,
          votes,
          avgSentence,
          avgTranslation,
          avgTts
        }, policy);

        updateUnit.run({
          exampleId: row.exampleId,
          avgSentence: votes ? avgSentence : null,
          avgTranslation: votes ? avgTranslation : null,
          avgTts: votes ? avgTts : null,
          overall: votes ? overall : null,
          votes,
          comment: row.latestComment || null,
          eligibility
        });
        markReviewed.run({ campaignId: Number(campaignId), exampleId: row.exampleId, votes });
      });
      finalizeCampaign.run(Number(campaignId));
    });

    tx();
    return this.getCampaignProgress(campaignId);
  }

  getApprovedExamplesForFewShot(currentPhrase, count = 3, options = {}) {
    const minOverall = Number(options.minOverall || process.env.REVIEW_GATE_MIN_OVERALL || 4.2);
    const candidateLimit = Math.max(count * 8, 24);
    const outputMode = (options.outputMode || 'markdown').toLowerCase();
    const excludePhrase = normalizeText(options.excludePhrase || '');

    const rows = this.db.prepare(`
      SELECT
        eu.id,
        eu.lang,
        eu.sentence_text AS sentenceText,
        eu.translation_text AS translationText,
        eu.source_phrase AS sourcePhrase,
        eu.review_score_overall AS score,
        eu.review_votes AS votes
      FROM example_units eu
      WHERE eu.eligibility = 'approved'
        AND eu.review_score_overall >= @minOverall
      ORDER BY eu.review_score_overall DESC, eu.review_votes DESC, eu.updated_at DESC
      LIMIT @candidateLimit
    `).all({
      minOverall,
      candidateLimit
    });

    const scored = rows
      .filter((row) => !excludePhrase || normalizeForHash(row.sourcePhrase) !== normalizeForHash(excludePhrase))
      .map((row) => {
        const similarity = Math.max(
          bigramSimilarity(currentPhrase, row.sourcePhrase),
          bigramSimilarity(currentPhrase, row.sentenceText)
        );
        return { ...row, _similarity: similarity };
      });

    scored.sort((a, b) => {
      const s = b._similarity - a._similarity;
      if (Math.abs(s) > 0.01) return s;
      const q = Number(b.score || 0) - Number(a.score || 0);
      if (Math.abs(q) > 0.001) return q;
      return Number(b.votes || 0) - Number(a.votes || 0);
    });

    return scored.slice(0, count).map((row, idx) => {
      const output = outputMode === 'json'
        ? JSON.stringify({
          lang: row.lang,
          sentence: row.sentenceText,
          translation: row.translationText
        }, null, 2)
        : [
          `# ${row.sourcePhrase || '示例'}`,
          `## 审核通过例句（${row.lang.toUpperCase()}）`,
          `- **例句${idx + 1}**: ${row.sentenceText}`,
          `  - ${row.translationText}`
        ].join('\n');

      return {
        input: row.sourcePhrase || currentPhrase,
        output,
        qualityScore: Number(((row.score || 0) * 20).toFixed(2)),
        metadata: {
          exampleUnitId: row.id,
          provider: 'human_review',
          reviewScoreOverall: row.score,
          reviewVotes: row.votes,
          similarity: row._similarity
        }
      };
    });
  }
}

module.exports = new ExampleReviewService();
