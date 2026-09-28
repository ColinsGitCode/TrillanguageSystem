// Pure logic behind the quick-create panel, kept in plain JavaScript so the
// unit tests can load it without a TypeScript toolchain.

/** Card types whose input is one short item per line, so a paste of several
 * lines means several cards. A scenario is prose and may span lines. */
export const BATCH_CARD_TYPES = new Set(['trilingual', 'grammar_ja']);

/** Median seconds from start to finish per card type, measured over the
 * successful jobs on record (2026-09): 247 trilingual, 182 grammar, 5 scenario. */
export const MEDIAN_SECONDS = { trilingual: 22, grammar_ja: 23, scenario_phrase: 67 };

const KANA_RE = /[぀-ヿㇰ-ㇿ]/u;
const HAN_RE = /[㐀-鿿]/u;
const LATIN_RE = /[A-Za-z]/u;

/**
 * Splits composer input into the phrases that would each become a card.
 * Batch types split on lines, trim, drop blanks and drop repeats so a phrase
 * pasted twice is not queued twice; a scenario stays one block.
 */
export function composerLines(text, cardType) {
  const source = String(text || '');
  if (!BATCH_CARD_TYPES.has(cardType)) {
    const whole = source.trim();
    return whole ? [whole] : [];
  }
  const seen = new Set();
  const lines = [];
  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

/**
 * Names the language a line is written in, or null when it cannot be told.
 * Kana means Japanese and Latin letters without Han mean English. Kanji-only
 * text can be Chinese or Japanese; the selection toolbar refuses to guess in
 * that case and so does the composer.
 */
export function detectLineLanguage(text) {
  const value = String(text || '');
  if (KANA_RE.test(value)) return 'ja';
  if (LATIN_RE.test(value) && !HAN_RE.test(value)) return 'en';
  return null;
}

/**
 * Parses a generation-job timestamp. SQLite `datetime('now')` values carry no
 * zone designator but are UTC, while finish times arrive as ISO strings with Z.
 * Parsed as-is, the first kind is read as local time, nine hours off in Tokyo.
 */
export function parseServerTime(value) {
  if (!value) return null;
  const text = String(value);
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/u.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

/** A plain-language estimate for how long a batch will take to finish. */
export function estimateDuration(count, cardType) {
  if (!count) return '';
  const seconds = count * (MEDIAN_SECONDS[cardType] || MEDIAN_SECONDS.trilingual);
  if (seconds < 60) return `约 ${Math.max(10, Math.round(seconds / 5) * 5)} 秒`;
  return `约 ${Math.round(seconds / 60)} 分钟`;
}

/**
 * Describes one submitted job for the "本次已提交" tray.
 * `jobs` is the full polled list, used to say how many are ahead in the queue.
 */
export function describeJob(job, jobs, now) {
  if (job.status === 'queued') {
    const running = jobs.filter((item) => item.status === 'running').length;
    const earlier = jobs.filter((item) => item.status === 'queued' && item.id < job.id).length;
    const ahead = running + earlier;
    return { tone: 'queued', text: ahead ? `排队中，前面还有 ${ahead} 张` : '排队中，下一个就是它' };
  }
  if (job.status === 'running') {
    const started = parseServerTime(job.startedAt);
    const seconds = started === null ? null : Math.max(0, Math.round((now - started) / 1000));
    return { tone: 'running', text: seconds === null ? '生成中' : `生成中 ${seconds} 秒` };
  }
  if (job.status === 'success') {
    const started = parseServerTime(job.startedAt);
    const finished = parseServerTime(job.finishedAt);
    const seconds = started !== null && finished !== null
      ? Math.max(1, Math.round((finished - started) / 1000))
      : null;
    return { tone: 'done', text: seconds === null ? '已完成' : `${seconds} 秒完成` };
  }
  if (job.status === 'failed') {
    return { tone: 'failed', text: job.errorMessage ? `生成失败：${String(job.errorMessage).slice(0, 60)}` : '生成失败' };
  }
  return { tone: 'cancelled', text: '已取消' };
}
