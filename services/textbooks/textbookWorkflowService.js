'use strict';

const { textbookError } = require('./textbookErrors');

function stageFor({ track, review, operation }) {
  if (!track) return 'intake';
  if (operation && ['queued', 'running', 'partially_failed', 'failed'].includes(operation.status)) {
    return 'processing';
  }
  if (operation?.status === 'succeeded' || track.status === 'published') return 'complete';
  if (review.total > 0 && review.confirmed === review.total) return 'release';
  return 'review';
}

function reviewTask(expression, state) {
  let confidence = {};
  try {
    confidence = JSON.parse(expression.confidence_json || '{}');
  } catch {
    confidence = {};
  }
  const reasons = [];
  if (state?.reason_code) reasons.push(state.reason_code);
  if (!String(expression.ja_ruby_html || '').includes('<ruby>') && /[\u3400-\u9fff]/u.test(expression.official_ja_text)) {
    reasons.push('missing-ruby');
  }
  return {
    id: String(expression.id),
    expressionId: Number(expression.expression_id),
    expressionRevisionId: Number(expression.id),
    ordinal: Number(expression.display_ordinal),
    title: expression.official_en_text,
    summary: expression.official_ja_text,
    state: state?.status || 'pending',
    reasons: [...new Set(reasons)],
    confidence,
    source: {
      spans: JSON.parse(expression.source_spans_json || '[]'),
      provenance: JSON.parse(expression.provenance_json || '{}'),
      enUnitHash: expression.en_unit_hash,
      jaUnitHash: expression.ja_unit_hash,
    },
    content: {
      officialEnText: expression.official_en_text,
      officialJaText: expression.official_ja_text,
      zhCueText: expression.zh_cue_text,
      jaRubyHtml: expression.ja_ruby_html,
      phraseAnalysisJson: expression.phrase_analysis_json,
      grammarPointsJson: expression.grammar_points_json,
      editorNote: expression.editor_note,
    },
  };
}

class TextbookWorkflowService {
  constructor({ dbService }) {
    this.dbService = dbService;
  }

  getWorkflow(trackId, operationId = null) {
    const track = this.dbService.getTextbookTrack(trackId);
    if (!track) throw textbookError('TEXTBOOK_TRACK_NOT_FOUND', 404);
    const review = this.dbService.getTextbookReviewSummary(track.revision_id);
    const stateByExpression = new Map(review.rows.map((row) => [Number(row.expression_id), row]));
    const operation = operationId
      ? this.dbService.getTextbookOperation(operationId)
      : null;
    if (operation && Number(operation.track_id) !== Number(track.id)) {
      throw textbookError('TEXTBOOK_OPERATION_TRACK_MISMATCH', 409);
    }
    const tasks = track.expressions.map((expression) => reviewTask(
      expression,
      stateByExpression.get(Number(expression.expression_id))
    ));
    const preview = ['verified', 'published'].includes(track.status)
      ? this.dbService.previewTextbookPublish(track.id)
      : {
        trackId: track.id,
        status: track.status,
        revision: track.revision_number,
        expressionCount: track.expressions.length,
        unitCount: track.expressions.length * 2,
        planRevision: 0,
        dailyNewLimit: null,
        shortestIntroductionDays: null,
      };
    const currentStage = stageFor({ track, review, operation });
    return {
      track: {
        id: Number(track.id),
        title: track.title,
        status: track.status,
        revisionId: Number(track.revision_id),
        revisionNumber: Number(track.revision_number),
        courseKey: track.course_key,
        trackNumber: Number(track.track_number),
      },
      stage: currentStage,
      review: {
        total: review.total,
        confirmed: review.confirmed,
        needsAttention: review.needsAttention,
        pending: review.pending,
        tasks,
      },
      release: {
        available: review.total > 0 && review.confirmed === review.total,
        previewRevision: `${track.revision_id}:${preview.planRevision}`,
        expressionCount: preview.expressionCount,
        unitCount: preview.unitCount,
        planRevision: preview.planRevision,
        dailyNewLimit: preview.dailyNewLimit,
        shortestIntroductionDays: preview.shortestIntroductionDays,
        warnings: review.confirmed === review.total ? [] : ['仍有未确认表达'],
      },
      operation,
      commands: {
        saveDraft: track.revision_status === 'draft',
        updateReview: track.revision_status === 'draft',
        verify: review.total > 0 && review.confirmed === review.total && track.revision_status === 'draft',
        release: review.total > 0 && review.confirmed === review.total && track.status === 'verified',
        retry: Boolean(operation && ['failed', 'partially_failed'].includes(operation.status)),
      },
    };
  }
}

module.exports = {
  TextbookWorkflowService,
  stageFor,
};
