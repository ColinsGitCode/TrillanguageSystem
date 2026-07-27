const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const transformsUrl = pathToFileURL(path.resolve(__dirname, '../../app/features/card-modal/card-render-transforms.mjs')).href;

test('card render transforms keep loanword conversion and audio adaptation reusable', async () => {
  const { adaptAudioToButtons, normalizeLoanwordAnnotations } = await import(transformsUrl);
  const normalized = normalizeLoanwordAnnotations('- 外来语标注：coffee=咖啡；toast=吐司');
  const adapted = adaptAudioToButtons('<audio src="audio/en/example.mp3"></audio>', '20260713');

  assert.match(normalized, /loanword-block/);
  assert.match(normalized, /coffee → 咖啡/);
  assert.match(adapted, /class="audio-btn"/);
  assert.match(adapted, /data-folder="20260713"/);
});
