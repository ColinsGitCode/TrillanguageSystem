'use strict';

process.env.KG_ENABLED = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { api, resetState, dbService, closeServer } = require('./_harness');

test.beforeEach(() => resetState());
test.after(async () => closeServer());

test('KG API separates read-only search from idempotent explicit lookup facts', async () => {
  const empty = await api('GET', '/api/kg/search?q=handoff&language=en');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.results, []);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count, 0);

  const command = {
    eventKey: 'api:lookup:handoff:0001',
    inputText: 'handoff',
    language: 'en',
    kindHint: 'lexeme',
    timeZone: 'Asia/Shanghai',
  };
  const created = await api('POST', '/api/kg/lookups', { body: command });
  assert.equal(created.status, 200);
  assert.equal(created.body.lookup.resolution, 'resolved');
  assert.equal(created.body.lookup.point.canonicalForm, 'handoff');

  const repeated = await api('POST', '/api/kg/lookups', { body: command });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.lookup.id, created.body.lookup.id);
  assert.equal(repeated.body.lookup.reused, true);

  const conflict = await api('POST', '/api/kg/lookups', {
    body: { ...command, inputText: 'transfer' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'KG_EVENT_KEY_CONFLICT');

  const search = await api('GET', '/api/kg/search?q=hand&language=en&kind=lexeme');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.length, 1);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM kg_lookup_events').get().count, 1);

  const pointId = created.body.lookup.point.id;
  const detail = await api('GET', `/api/kg/points/${pointId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.point.forms.length, 1);
  assert.equal(detail.body.point.stats.explicitLookupCount7d, 1);
  const forms = await api('GET', `/api/kg/points/${pointId}/forms`);
  assert.equal(forms.status, 200);
  assert.equal(forms.body.forms[0].linkKind, 'canonical');
});

test('unresolved Japanese lookup stays reversible until a revision-checked user decision', async () => {
  const lookup = await api('POST', '/api/kg/lookups', {
    body: {
      eventKey: 'api:lookup:hashi:0001',
      inputText: 'はし',
      language: 'ja',
      kindHint: 'lexeme',
    },
  });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.lookup.resolution, 'unresolved');
  assert.equal(lookup.body.lookup.resolutionCase.caseKind, 'ambiguous-surface');
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM kg_points').get().count, 0);

  const caseId = lookup.body.lookup.resolutionCase.id;
  const decided = await api('POST', `/api/kg/resolution-cases/${caseId}/decisions`, {
    body: {
      eventKey: 'api:decision:hashi:0001',
      action: 'resolve',
      revision: 1,
      point: {
        kind: 'lexeme',
        language: 'ja',
        canonicalForm: '橋',
        canonicalReading: 'はし',
      },
      publicReason: 'User selected bridge from the current context.',
    },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.resolutionCase.status, 'resolved');
  assert.equal(decided.body.point.canonicalForm, '橋');

  const stale = await api('POST', `/api/kg/resolution-cases/${caseId}/decisions`, {
    body: {
      eventKey: 'api:decision:hashi:0002',
      action: 'dismiss',
      revision: 1,
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'KG_RESOLUTION_STALE');
});
