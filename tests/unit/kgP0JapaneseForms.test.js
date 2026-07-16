'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  analyzeJapaneseForm,
  analyzerDescriptor,
} = require('../../services/kg/domain/japaneseFormAnalysis');
const { toRuby } = require('../../services/generation/japaneseFurigana');

const fixturePath = path.join(__dirname, '../fixtures/kg-p0-japanese-token-fixtures.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test.describe('KG-P0 Japanese form analysis', () => {
  test.it('pins analyzer and rule versions', () => {
    assert.deepEqual(analyzerDescriptor(), fixture.analyzer);
  });

  for (const entry of fixture.cases) {
    test.it(`matches token fixture and decision for ${entry.id}`, async () => {
      const result = await analyzeJapaneseForm(entry.input);
      assert.deepEqual(result.tokens, entry.rawTokens);
      assert.equal(result.status, entry.expected.status);
      if (result.status === 'unresolved') {
        assert.equal(result.reason, entry.expected.reason);
        assert.equal(result.pointIdentity, undefined);
        return;
      }
      assert.equal(result.canonicalForm, entry.expected.canonicalForm);
      assert.equal(result.lemmaReading, entry.expected.lemmaReading);
      assert.equal(result.relation.linkKind, entry.expected.linkKind);
      assert.equal(result.relation.formKind, entry.expected.formKind);
      assert.equal(result.pointIdentity.pointKey, entry.expected.pointKey);
    });
  }

  test.it('maps supported 食べる forms to one Knowledge Point', async () => {
    const results = await Promise.all(['食べる', '食べた', '食べて', '食べます'].map(analyzeJapaneseForm));
    assert.equal(new Set(results.map((result) => result.pointIdentity.pointKey)).size, 1);
  });

  test.it('does not regress kanji-only ruby rendering', async () => {
    const ruby = await toRuby('食べます');
    assert.match(ruby, /<ruby>食<rt>た<\/rt><\/ruby>べます/u);
    assert.doesNotMatch(ruby, /<ruby>べ/u);
  });
});
