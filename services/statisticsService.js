/**
 * 统计检验服务
 * 提供配对样本的统计检验工具，用于实验结果显著性分析
 * 不依赖外部库，手写实现（适用于 n < 200 的小样本场景）
 */

/**
 * 配对 t 检验 (two-tailed)
 * @param {number[]} before - baseline 分数数组
 * @param {number[]} after - fewshot 分数数组
 * @returns {{ tStat, df, pValue, mean, se }}
 */
function pairedTTest(before, after) {
  if (before.length !== after.length || before.length < 2) {
    return { tStat: null, df: null, pValue: null, mean: null, se: null };
  }
  const n = before.length;
  const diffs = before.map((v, i) => after[i] - v);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((acc, d) => acc + (d - meanDiff) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  if (se === 0) {
    return { tStat: 0, df: n - 1, pValue: 1, mean: meanDiff, se: 0 };
  }
  const tStat = meanDiff / se;
  const df = n - 1;
  const pValue = tDistPValue(Math.abs(tStat), df) * 2; // two-tailed
  return { tStat, df, pValue: Math.min(pValue, 1), mean: meanDiff, se };
}

/**
 * 95% 置信区间 (基于 t 分布)
 * @param {number[]} before
 * @param {number[]} after
 * @returns {{ lower, upper, mean }}
 */
function confidenceInterval95(before, after) {
  if (before.length !== after.length || before.length < 2) {
    return { lower: null, upper: null, mean: null };
  }
  const n = before.length;
  const diffs = before.map((v, i) => after[i] - v);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((acc, d) => acc + (d - meanDiff) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const tCrit = tCriticalValue(n - 1, 0.025); // two-tailed 95%
  return {
    lower: Number((meanDiff - tCrit * se).toFixed(2)),
    upper: Number((meanDiff + tCrit * se).toFixed(2)),
    mean: Number(meanDiff.toFixed(2))
  };
}

/**
 * Cohen's d 效应量 (paired)
 * @param {number[]} before
 * @param {number[]} after
 * @returns {{ d, interpretation }}
 */
function cohensD(before, after) {
  if (before.length !== after.length || before.length < 2) {
    return { d: null, interpretation: 'insufficient_data' };
  }
  const n = before.length;
  const diffs = before.map((v, i) => after[i] - v);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const sdDiff = Math.sqrt(diffs.reduce((acc, d) => acc + (d - meanDiff) ** 2, 0) / (n - 1));
  if (sdDiff === 0) return { d: 0, interpretation: 'zero_variance' };
  const d = meanDiff / sdDiff;
  let interpretation = 'negligible';
  const absD = Math.abs(d);
  if (absD >= 0.8) interpretation = 'large';
  else if (absD >= 0.5) interpretation = 'medium';
  else if (absD >= 0.2) interpretation = 'small';
  return { d: Number(d.toFixed(3)), interpretation };
}

/**
 * Wilcoxon 签名秩检验 (two-tailed, 正态近似)
 * 适用于 n >= 10 的场景
 * @param {number[]} before
 * @param {number[]} after
 * @returns {{ W, zStat, pValue, n }}
 */
function wilcoxonSignedRank(before, after) {
  if (before.length !== after.length || before.length < 5) {
    return { W: null, zStat: null, pValue: null, n: before.length };
  }
  const diffs = before.map((v, i) => after[i] - v).filter((d) => d !== 0);
  const n = diffs.length;
  if (n < 5) {
    return { W: null, zStat: null, pValue: null, n };
  }

  // Rank absolute differences
  const indexed = diffs.map((d, i) => ({ diff: d, abs: Math.abs(d), sign: d > 0 ? 1 : -1 }));
  indexed.sort((a, b) => a.abs - b.abs);

  // Assign ranks with tie handling
  let rank = 1;
  for (let i = 0; i < indexed.length;) {
    let j = i;
    while (j < indexed.length && indexed[j].abs === indexed[i].abs) j++;
    const avgRank = (rank + rank + j - i - 1) / 2;
    for (let k = i; k < j; k++) indexed[k].rank = avgRank;
    rank += j - i;
    i = j;
  }

  // W+ = sum of ranks for positive diffs
  const wPlus = indexed.filter((x) => x.sign > 0).reduce((acc, x) => acc + x.rank, 0);
  const wMinus = indexed.filter((x) => x.sign < 0).reduce((acc, x) => acc + x.rank, 0);
  const W = Math.min(wPlus, wMinus);

  // Normal approximation (n >= 10)
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  if (sigma === 0) return { W, zStat: 0, pValue: 1, n };
  const zStat = (W - mu) / sigma;
  const pValue = 2 * normalCDF(-Math.abs(zStat)); // two-tailed
  return { W, zStat: Number(zStat.toFixed(3)), pValue: Number(Math.min(pValue, 1).toFixed(4)), n };
}

/**
 * 完整统计检验套件
 * @param {number[]} baselineScores - baseline 配对分数
 * @param {number[]} fewshotScores - fewshot 配对分数
 * @returns {Object} 完整统计结果
 */
function runPairedTests(baselineScores, fewshotScores) {
  const tTest = pairedTTest(baselineScores, fewshotScores);
  const ci = confidenceInterval95(baselineScores, fewshotScores);
  const effect = cohensD(baselineScores, fewshotScores);
  const wilcoxon = wilcoxonSignedRank(baselineScores, fewshotScores);

  return {
    sampleSize: baselineScores.length,
    pairedTTest: tTest,
    confidenceInterval95: ci,
    cohensD: effect,
    wilcoxon,
    significant: tTest.pValue !== null && tTest.pValue < 0.05,
    summary: formatSummary(tTest, ci, effect, wilcoxon)
  };
}

function formatSummary(tTest, ci, effect, wilcoxon) {
  const parts = [];
  if (ci.mean !== null) {
    parts.push(`Mean diff: ${ci.mean > 0 ? '+' : ''}${ci.mean}`);
  }
  if (ci.lower !== null) {
    parts.push(`95% CI: [${ci.lower}, ${ci.upper}]`);
  }
  if (tTest.pValue !== null) {
    parts.push(`t-test p=${tTest.pValue.toFixed(4)}`);
  }
  if (wilcoxon.pValue !== null) {
    parts.push(`Wilcoxon p=${wilcoxon.pValue.toFixed(4)}`);
  }
  if (effect.d !== null) {
    parts.push(`Cohen's d=${effect.d} (${effect.interpretation})`);
  }
  return parts.join('; ');
}

// ========== 数学辅助函数 ==========

/** 标准正态 CDF (Abramowitz & Stegun approximation) */
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/** t 分布 p-value (one-tailed, Abramowitz & Stegun approximation) */
function tDistPValue(t, df) {
  // Use normal approximation for large df
  if (df > 100) return 1 - normalCDF(t);
  // Regularized incomplete beta function approximation
  const x = df / (df + t * t);
  return 0.5 * regIncBeta(df / 2, 0.5, x);
}

/** t 分布临界值 (近似, 用于 CI) */
function tCriticalValue(df, alpha) {
  // Common values lookup for small df
  const table = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021,
    50: 2.009, 60: 2.000, 80: 1.990, 100: 1.984, 120: 1.980
  };
  if (table[df]) return table[df];
  // Find nearest
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df >= keys[i] && df <= keys[i + 1]) {
      const ratio = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return table[keys[i]] * (1 - ratio) + table[keys[i + 1]] * ratio;
    }
  }
  return 1.96; // fallback to z
}

/** 正则化不完全 Beta 函数 (连分数近似) */
function regIncBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
  // Lentz's continued fraction
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let m = Math.floor(i / 2);
    let numerator;
    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-10) break;
  }
  return front * (f - 1) / a;
}

/** Log-gamma (Stirling approximation) */
function lgamma(x) {
  if (x <= 0) return 0;
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

module.exports = {
  pairedTTest,
  confidenceInterval95,
  cohensD,
  wilcoxonSignedRank,
  runPairedTests
};
