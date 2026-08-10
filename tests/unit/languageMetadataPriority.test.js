'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const domain = require('../../services/storage/db/languageMetadata');
const { createPronunciationService } = require('../../services/pronunciation/pronunciationService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const NOW = '2026-08-10T00:00:00.000Z';

// データ is in the curated dictionary; スケジュール is too. カレンダー is not,
// which lets the tests separate "curated wins" from "only a proposal exists".
const CURATED_SURFACE = 'データ';
const UNCURATED_SURFACE = 'カレンダー';

function setup() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const markdown = `# t\n## 2. 日本語:\n- **例句1**: ${CURATED_SURFACE}と${UNCURATED_SURFACE}。`;
  const generation = { id: 1, content_hash: HASH, markdown_content: markdown };

  const tokens = [
    { surface: CURATED_SURFACE, startCodePoint: 0, endCodePoint: 3, evidence: {} },
    { surface: UNCURATED_SURFACE, startCodePoint: 4, endCodePoint: 9, evidence: {} },
  ];

  const dbService = {
    db,
    getGenerationById: () => generation,
    getPronunciationDocument: () => ({ id: 10, revision: 1 }),
    listPronunciationTokens: () => tokens.map((token) => ({ ...token })),
    listLanguageMetadataProposals: (options) => domain.listProposals(db, options),
  };
  const service = createPronunciationService({ dbService });
  return { db, service };
}

function addProposal(db, { surface, start, end, term, origin, status }) {
  return domain.insertProposal(db, {
    proposalKey: `${origin}:${status}:${start}:${term}`,
    targetKind: 'generation',
    targetId: 1,
    sourceContentHash: HASH,
    metadataKind: 'foreign-origin',
    surface,
    startCodePoint: start,
    endCodePoint: end,
    valueJson: JSON.stringify({ originTerm: term, originLanguage: 'en' }),
    confidence: 'high',
    origin,
    status,
    nowUtc: NOW,
  });
}

async function originsFor(service) {
  const { tokens } = await service.readGeneration(1);
  return Object.fromEntries(tokens.map((token) => [token.surface, token.evidence?.foreignOrigin || null]));
}

test.describe('JLM-A1 foreign origin priority', () => {
  test.it('shows nothing for an uncurated surface with no proposal', async () => {
    const { service } = setup();
    const origins = await originsFor(service);
    assert.equal(origins[UNCURATED_SURFACE], null, 'no source means 待确认, never a guess');
  });

  test.it('uses the curated dictionary when it has the surface', async () => {
    const { service } = setup();
    const origins = await originsFor(service);
    assert.equal(origins[CURATED_SURFACE].source, 'curated');
  });

  test.it('shows a pending candidate only where curated has nothing', async () => {
    const { db, service } = setup();
    addProposal(db, { surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'calendar', origin: 'llm', status: 'pending' });
    const origins = await originsFor(service);
    assert.equal(origins[UNCURATED_SURFACE].term, 'calendar');
    assert.equal(origins[UNCURATED_SURFACE].source, 'pending', 'pending must stay labelled as a candidate');
  });

  test.it('keeps curated above an accepted LLM candidate', async () => {
    const { db, service } = setup();
    addProposal(db, { surface: CURATED_SURFACE, start: 0, end: 3, term: 'dater', origin: 'llm', status: 'accepted' });
    const origins = await originsFor(service);
    assert.equal(origins[CURATED_SURFACE].source, 'curated');
    assert.notEqual(origins[CURATED_SURFACE].term, 'dater');
  });

  test.it('puts a human correction above the curated dictionary', async () => {
    const { db, service } = setup();
    // This is the case that makes the top of the ladder reachable: without it a
    // wrong curated entry could never be overridden.
    addProposal(db, { surface: CURATED_SURFACE, start: 0, end: 3, term: 'corrected', origin: 'human', status: 'accepted' });
    const origins = await originsFor(service);
    assert.equal(origins[CURATED_SURFACE].source, 'human');
    assert.equal(origins[CURATED_SURFACE].term, 'corrected');
  });

  test.it('prefers accepted over pending at the same position', async () => {
    const { db, service } = setup();
    addProposal(db, { surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'guess', origin: 'llm', status: 'pending' });
    addProposal(db, { surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'calendar', origin: 'llm', status: 'accepted' });
    const origins = await originsFor(service);
    assert.equal(origins[UNCURATED_SURFACE].term, 'calendar');
    assert.equal(origins[UNCURATED_SURFACE].source, 'accepted');
  });

  test.it('ignores a rejected candidate', async () => {
    const { db, service } = setup();
    addProposal(db, { surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'wrong', origin: 'llm', status: 'rejected' });
    const origins = await originsFor(service);
    assert.equal(origins[UNCURATED_SURFACE], null, 'a rejected candidate must not reappear');
  });

  test.it('ignores a candidate bound to a different body version', async () => {
    const { db, service } = setup();
    domain.insertProposal(db, {
      proposalKey: 'other-hash',
      targetKind: 'generation',
      targetId: 1,
      sourceContentHash: OTHER_HASH,
      metadataKind: 'foreign-origin',
      surface: UNCURATED_SURFACE,
      startCodePoint: 4,
      endCodePoint: 9,
      valueJson: JSON.stringify({ originTerm: 'from-old-body', originLanguage: 'en' }),
      confidence: 'high',
      origin: 'llm',
      status: 'pending',
      nowUtc: NOW,
    });
    const origins = await originsFor(service);
    assert.equal(origins[UNCURATED_SURFACE], null, 'stale ranges may point at other characters');
  });

  test.it('reading the projection writes nothing', async () => {
    const { db, service } = setup();
    addProposal(db, { surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'calendar', origin: 'llm', status: 'pending' });
    const fingerprint = () => JSON.stringify([
      db.prepare('SELECT COUNT(*) AS c FROM language_metadata_proposals').get(),
      db.prepare('SELECT COUNT(*) AS c FROM language_metadata_jobs').get(),
      db.prepare('SELECT status, updated_at_utc FROM language_metadata_proposals ORDER BY id').all(),
    ]);
    const before = fingerprint();
    await originsFor(service);
    await originsFor(service);
    assert.equal(fingerprint(), before, 'the read path must stay write-free');
  });
});

test.describe('JLM-A1 adjudication', () => {
  test.it('is optimistic: a second decision on the same candidate fails', () => {
    const { db } = setup();
    const { proposal } = addProposal(db, {
      surface: UNCURATED_SURFACE, start: 4, end: 9, term: 'calendar', origin: 'llm', status: 'pending',
    });
    const first = domain.decideProposal(db, {
      id: proposal.id, expectedStatus: 'pending', status: 'accepted', decidedBy: 'user', nowUtc: NOW,
    });
    assert.equal(first.status, 'accepted');

    const second = domain.decideProposal(db, {
      id: proposal.id, expectedStatus: 'pending', status: 'rejected', decidedBy: 'user', nowUtc: NOW,
    });
    assert.equal(second, null, 'an already-decided candidate must not be silently re-decided');
    assert.equal(domain.getProposal(db, proposal.id).status, 'accepted');
  });
});
