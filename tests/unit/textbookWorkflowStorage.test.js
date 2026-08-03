'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;

function manifest() {
  const hash = (value) => value.repeat(64).slice(0, 64);
  const expression = (key, ordinal, confidence = 1) => ({
    key,
    ordinal,
    official: {
      en: { text: `English ${ordinal}`, sourceSpan: { assetKey: 'source:01' } },
      ja: { text: `日本語${ordinal}`, sourceSpan: { assetKey: 'source:01' } },
    },
    derived: {
      zhCue: `中文${ordinal}`,
      rubySegments: [{ text: `日本語${ordinal}` }],
      analysis: { phrases: [], grammar: [] },
    },
    confidence: { pairing: confidence, en: 1, ja: 1, zhCue: 1, ruby: 1 },
    unitHashes: { en: hash(String(ordinal)), ja: hash(String(ordinal + 2)) },
  });
  return {
    schemaVersion: 'textbook-track-manifest/v1',
    course: { key: 'workflow-unit', title: 'Workflow Unit', sourceNotice: 'Synthetic' },
    track: { number: 1, displayOrder: 1, title: 'Workflow Track' },
    revision: { number: 1 },
    assets: [{
      assetKey: 'source:01',
      kind: 'source_image',
      ordinal: 1,
      relativePath: 'synthetic/source.png',
      sha256: hash('a'),
      byteSize: 1,
      mimeType: 'image/png',
    }],
    expressions: [expression('expr:01', 1), expression('expr:02', 2, 0.6)],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      inputSummary: {},
    },
    integrity: { sourceFingerprint: hash('b'), contentHash: hash('c') },
  };
}

test.after(() => databaseModule.close());

test('copy-on-write preserves immutable rows and only invalidates the edited expression', () => {
  const service = new DatabaseService(':memory:');
  try {
    const original = service.importTextbookDraft({
      manifest: manifest(),
      manifestRelativePath: 'synthetic/manifest.json',
      manifestHash: 'd'.repeat(64),
    });
    const first = original.expressions[0];
    const second = original.expressions[1];
    const initialReview = service.getTextbookReviewSummary(original.revision_id);
    assert.equal(initialReview.pending, 1);
    assert.equal(initialReview.needsAttention, 1);
    service.updateTextbookReviewState(original.revision_id, first.expression_id, {
      expressionRevisionId: first.id,
      status: 'confirmed',
      reviewer: 'unit',
    });
    service.updateTextbookReviewState(original.revision_id, second.expression_id, {
      expressionRevisionId: second.id,
      status: 'confirmed',
      reviewer: 'unit',
    });

    const copied = service.copyTextbookRevision(original.revision_id, {
      expectedRevisionId: original.revision_id,
      expressionId: first.expression_id,
      changes: { jaRubyHtml: '<ruby>日本語<rt>にほんご</rt></ruby>1' },
    });
    const next = service.getTextbookTrack(original.id);
    const edited = next.expressions.find((row) => row.expression_id === first.expression_id);
    const untouched = next.expressions.find((row) => row.expression_id === second.expression_id);
    assert.notEqual(copied.revisionId, original.revision_id);
    assert.equal(edited.en_unit_hash, first.en_unit_hash);
    assert.notEqual(edited.ja_unit_hash, first.ja_unit_hash);
    assert.equal(untouched.en_unit_hash, second.en_unit_hash);
    assert.equal(untouched.ja_unit_hash, second.ja_unit_hash);
    assert.equal(service.getTextbookRevision(original.revision_id).expressions[0].ja_ruby_html, first.ja_ruby_html);
    const reviews = service.getTextbookReviewSummary(copied.revisionId);
    assert.equal(reviews.rows.find((row) => row.expression_id === first.expression_id).status, 'needs_attention');
    assert.equal(reviews.rows.find((row) => row.expression_id === second.expression_id).status, 'confirmed');

    const cueCopied = service.copyTextbookRevision(copied.revisionId, {
      expectedRevisionId: copied.revisionId,
      expressionId: first.expression_id,
      changes: { zhCueText: '更新后的中文提示' },
    });
    const cueRevision = service.getTextbookRevision(cueCopied.revisionId);
    const cueEdited = cueRevision.expressions.find((row) => row.expression_id === first.expression_id);
    assert.notEqual(cueEdited.en_unit_hash, edited.en_unit_hash);
    assert.notEqual(cueEdited.ja_unit_hash, edited.ja_unit_hash);
    assert.equal(service.searchTextbookExpressions('English').length, 2);

    assert.throws(
      () => service.copyTextbookRevision(original.revision_id, {
        expectedRevisionId: original.revision_id,
        expressionId: first.expression_id,
        changes: { editorNote: 'stale' },
      }),
      (error) => error.code === 'TEXTBOOK_REVISION_CONFLICT'
    );
    assert.doesNotThrow(() => service.truncateAllForTests());
    assert.equal(service.db.prepare('SELECT COUNT(*) AS count FROM textbook_track_revisions').get().count, 0);
  } finally {
    service.close();
  }
});

test('pending textbook reviews remain recoverable until a release operation owns the work', () => {
  const service = new DatabaseService(':memory:');
  try {
    const track = service.importTextbookDraft({
      manifest: manifest(),
      manifestRelativePath: 'synthetic/manifest.json',
      manifestHash: 'd'.repeat(64),
    });
    const pending = service.listPendingTextbookReviews();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].track_id, track.id);
    assert.equal(pending[0].pending, 1);
    assert.equal(pending[0].needs_attention, 1);

    for (const expression of track.expressions) {
      service.updateTextbookReviewState(track.revision_id, expression.expression_id, {
        expressionRevisionId: expression.id,
        status: 'confirmed',
        reviewer: 'unit',
      });
    }
    service.verifyTextbookRevision(track.revision_id, { expectedTrackStatus: 'draft' });
    const ready = service.listPendingTextbookReviews();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].track_status, 'verified');

    service.createTextbookOperation(track.id, {
      kind: 'release',
      idempotencyKey: 'release-owns-pending-work',
      payload: {},
    });
    assert.equal(service.listPendingTextbookReviews().length, 0);
  } finally {
    service.close();
  }
});

test('operation storage is idempotent, append-only, retryable, and restart-recoverable', () => {
  const service = new DatabaseService(':memory:');
  try {
    const track = service.importTextbookDraft({
      manifest: manifest(),
      manifestRelativePath: 'synthetic/manifest.json',
      manifestHash: 'd'.repeat(64),
    });
    const command = {
      kind: 'tts',
      idempotencyKey: 'unit-operation-1',
      payload: { force: false },
    };
    const created = service.createTextbookOperation(track.id, command);
    const reused = service.createTextbookOperation(track.id, command);
    assert.equal(reused.id, created.id);
    assert.equal(service.getTextbookOperationByIdempotencyKey(command.idempotencyKey).id, created.id);
    const recent = service.listRecentTextbookOperations(5);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, created.id);
    assert.equal(recent[0].track_title, 'Workflow Track');
    assert.equal(recent[0].course_title, 'Workflow Unit');
    assert.throws(
      () => service.createTextbookOperation(track.id, {
        ...command,
        payload: { force: true },
      }),
      (error) => error.code === 'TEXTBOOK_IDEMPOTENCY_CONFLICT'
    );
    assert.throws(
      () => service.createTextbookOperation(track.id, {
        ...command,
        kind: 'sync',
      }),
      (error) => error.code === 'TEXTBOOK_IDEMPOTENCY_CONFLICT'
    );
    assert.throws(
      () => service.createTextbookOperation(track.id, {
        ...command,
        previewRevision: 'different-preview',
      }),
      (error) => error.code === 'TEXTBOOK_IDEMPOTENCY_CONFLICT'
    );
    service.claimTextbookOperation(created.id);
    service.updateTextbookOperationStep(created.id, 'tts', 'failed', {
      errorCode: 'SYNTHETIC_FAILURE',
      retryable: true,
    });
    service.finishTextbookOperation(created.id, 'failed', { errorCode: 'SYNTHETIC_FAILURE' });
    const retried = service.retryTextbookOperation(created.id);
    assert.equal(retried.status, 'queued');
    service.claimTextbookOperation(created.id);
    assert.equal(service.recoverTextbookOperations(), 1);
    assert.equal(service.getTextbookOperation(created.id).status, 'queued');
    const events = service.listTextbookOperationEvents(created.id);
    assert.ok(events.length >= 7);
    assert.throws(
      () => service.db.prepare('UPDATE textbook_operation_events SET event_type = ? WHERE id = ?').run('changed', events[0].id),
      /immutable/u
    );
  } finally {
    service.close();
  }
});

test('operation cancellation preserves completed steps and can resume unfinished work', () => {
  const service = new DatabaseService(':memory:');
  try {
    const track = service.importTextbookDraft({
      manifest: manifest(),
      manifestRelativePath: 'synthetic/manifest.json',
      manifestHash: 'd'.repeat(64),
    });
    const operation = service.createTextbookOperation(track.id, {
      kind: 'tts',
      idempotencyKey: 'unit-operation-cancel',
      payload: { force: false },
    });

    const cancelledBeforeStart = service.requestTextbookOperationCancellation(operation.id);
    assert.equal(cancelledBeforeStart.status, 'cancelled');
    assert.equal(cancelledBeforeStart.result.cancelRequested, true);
    assert.match(cancelledBeforeStart.public_summary, /尚未开始/u);

    const resumed = service.retryTextbookOperation(operation.id);
    assert.equal(resumed.status, 'queued');
    assert.equal(resumed.result.cancelRequested, undefined);

    service.claimTextbookOperation(operation.id);
    service.updateTextbookOperationStep(operation.id, 'tts', 'running', {
      publicSummary: 'tts 正在执行',
    });
    const cancellationRequested = service.requestTextbookOperationCancellation(operation.id);
    assert.equal(cancellationRequested.status, 'running');
    assert.equal(cancellationRequested.result.cancelRequested, true);
    assert.equal(service.isTextbookOperationCancellationRequested(operation.id), true);

    assert.equal(service.recoverTextbookOperations(), 1);
    const recovered = service.getTextbookOperation(operation.id);
    assert.equal(recovered.status, 'cancelled');
    assert.match(recovered.public_summary, /停止请求/u);

    const continued = service.retryTextbookOperation(operation.id);
    assert.equal(continued.status, 'queued');
    assert.equal(continued.result.steps.tts.status, 'queued');
    assert.equal(continued.result.cancelRequested, undefined);

    const eventTypes = service.listTextbookOperationEvents(operation.id)
      .map((event) => event.event_type);
    assert.ok(eventTypes.includes('cancel_requested'));
    assert.ok(eventTypes.includes('cancelled'));
    assert.ok(eventTypes.includes('retry'));
  } finally {
    service.close();
  }
});
