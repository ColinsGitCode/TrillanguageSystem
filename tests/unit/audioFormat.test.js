'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPreferredAudioExtension,
  normalizeAudioExtension,
  stripKnownAudioExtension,
  rewriteLegacyAudioTagExtensions,
} = require('../../services/generation/audioFormat');

test.describe('audioFormat.getPreferredAudioExtension', () => {
  test.it('prefers mp3 for English, wav for everything else', () => {
    assert.equal(getPreferredAudioExtension('en'), 'mp3');
    assert.equal(getPreferredAudioExtension('EN'), 'mp3');
    assert.equal(getPreferredAudioExtension('ja'), 'wav');
    assert.equal(getPreferredAudioExtension(''), 'wav');
    assert.equal(getPreferredAudioExtension(undefined), 'wav');
  });
});

test.describe('audioFormat.normalizeAudioExtension', () => {
  test.it('returns the explicit extension when provided, lower-cased and dot-stripped', () => {
    assert.equal(normalizeAudioExtension('mp3', 'en'), 'mp3');
    assert.equal(normalizeAudioExtension('.WAV', 'ja'), 'wav');
    assert.equal(normalizeAudioExtension('  M4A  ', 'en'), 'm4a');
  });

  test.it('falls back to the lang-preferred extension when empty', () => {
    assert.equal(normalizeAudioExtension('', 'en'), 'mp3');
    assert.equal(normalizeAudioExtension(null, 'ja'), 'wav');
    assert.equal(normalizeAudioExtension(undefined, 'en'), 'mp3');
  });
});

test.describe('audioFormat.stripKnownAudioExtension', () => {
  test.it('strips a known audio extension', () => {
    assert.equal(stripKnownAudioExtension('foo.wav'), 'foo');
    assert.equal(stripKnownAudioExtension('foo.MP3'), 'foo');
    assert.equal(stripKnownAudioExtension('foo.m4a'), 'foo');
  });

  test.it('leaves unknown extensions alone', () => {
    assert.equal(stripKnownAudioExtension('foo.txt'), 'foo.txt');
    assert.equal(stripKnownAudioExtension('foo'), 'foo');
    assert.equal(stripKnownAudioExtension(''), '');
  });
});

test.describe('audioFormat.rewriteLegacyAudioTagExtensions', () => {
  test.it('rewrites English audio tags from .wav to .mp3', () => {
    const md = '<audio src="card_en_1.wav"></audio>';
    assert.equal(
      rewriteLegacyAudioTagExtensions(md),
      '<audio src="card_en_1.mp3"></audio>'
    );
  });

  test.it('does not touch Japanese audio tags', () => {
    const md = '<audio src="card_ja_1.wav"></audio>';
    assert.equal(rewriteLegacyAudioTagExtensions(md), md);
  });

  test.it('handles multiple tags and preserves attributes around src', () => {
    const md = [
      '<audio src="a_en_1.wav" preload="none"></audio>',
      '<audio src="a_en_2.wav"></audio>',
      '<audio src="a_ja_1.wav"></audio>',
    ].join('\n');
    const out = rewriteLegacyAudioTagExtensions(md);
    assert.ok(out.includes('a_en_1.mp3'));
    assert.ok(out.includes('a_en_2.mp3'));
    assert.ok(out.includes('a_ja_1.wav'));
    assert.ok(out.includes('preload="none"'));
  });

  test.it('returns empty string for falsy input', () => {
    assert.equal(rewriteLegacyAudioTagExtensions(null), '');
    assert.equal(rewriteLegacyAudioTagExtensions(undefined), '');
    assert.equal(rewriteLegacyAudioTagExtensions(''), '');
  });
});
