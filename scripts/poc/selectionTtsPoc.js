#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateAudioBatch, synthesizeSpeech } = require('../../services/generation/ttsService');
const { getSharedTtsCoordinator } = require('../../services/generation/ttsRequestCoordinator');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-tts-poc-'));

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function measure(label, task) {
  const startedAt = performance.now();
  try {
    const result = await synthesizeSpeech(task, { requestClass: 'interactive' });
    return {
      label,
      ok: true,
      elapsedMs: Math.round(performance.now() - startedAt),
      queueWaitMs: result.queueWaitMs,
      contended: result.contended,
      bytes: result.buffer.length,
      contentType: result.contentType,
      provider: result.ttsProvider,
      model: result.ttsModel,
      voice: result.ttsVoice,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: error.code || error.name || 'TTS_POC_FAILED',
      message: error.message || String(error),
    };
  }
}

async function main() {
  const idle = [];
  idle.push(await measure('idle-en', {
    language: 'en',
    text: 'Please read this sentence clearly.',
    speed: 1,
  }));
  idle.push(await measure('idle-ja', {
    language: 'ja',
    text: 'この文をはっきり読んでください。',
    speed: 1,
  }));

  const batchTasks = [
    ...Array.from({ length: 20 }, (_, index) => ({
      lang: 'en',
      text: `This is scenario expression number ${index + 1}.`,
      filename_suffix: `_en_${String(index + 1).padStart(2, '0')}`,
      extension: 'mp3',
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      lang: 'ja',
      text: `これは場面表現の${index + 1}番目です。`,
      filename_suffix: `_ja_${String(index + 1).padStart(2, '0')}`,
      extension: 'wav',
    })),
  ];

  const batchStartedAt = performance.now();
  const batchPromise = generateAudioBatch(batchTasks, {
    outputDir,
    baseName: 'scenario-contention',
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const contended = [];
  for (let round = 0; round < 3; round += 1) {
    const pair = await Promise.all([
      measure(`contended-en-${round + 1}`, {
        language: 'en',
        text: 'Interactive English pronunciation check.',
        speed: round === 0 ? 0.8 : round === 1 ? 1 : 1.2,
      }),
      measure(`contended-ja-${round + 1}`, {
        language: 'ja',
        text: '対話中の日本語発音を確認します。',
        speed: round === 0 ? 0.8 : round === 1 ? 1 : 1.2,
      }),
    ]);
    contended.push(...pair);
  }

  const batch = await batchPromise;
  const batchElapsedMs = Math.round(performance.now() - batchStartedAt);
  const successfulContended = contended.filter((item) => item.ok);
  const report = {
    generatedAtUtc: new Date().toISOString(),
    configuration: {
      sharedCoordinator: getSharedTtsCoordinator().snapshot(),
      englishEndpoint: process.env.TTS_EN_ENDPOINT || null,
      japaneseEndpoint: process.env.TTS_JA_ENDPOINT || null,
      batchTasks: batchTasks.length,
    },
    idle,
    contention: {
      samples: contended,
      successCount: successfulContended.length,
      failureCount: contended.length - successfulContended.length,
      p50Ms: percentile(successfulContended.map((item) => item.elapsedMs), 0.5),
      p95Ms: percentile(successfulContended.map((item) => item.elapsedMs), 0.95),
      maxMs: successfulContended.length
        ? Math.max(...successfulContended.map((item) => item.elapsedMs))
        : null,
    },
    batch: {
      elapsedMs: batchElapsedMs,
      successCount: batch.results.length,
      failureCount: batch.errors.length,
    },
    decision: {
      strategy: 'shared-priority-coordinator',
      interactivePriority: true,
      batchStarvationMs: getSharedTtsCoordinator().snapshot().batchStarvationMs,
      timeoutMs: 15000,
      selectionConcurrency: 2,
      busyHintAfterMs: 600,
      passed: batch.errors.length === 0
        && contended.every((item) => item.ok && item.elapsedMs <= 15000),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.decision.passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
