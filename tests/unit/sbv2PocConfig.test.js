'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test.describe('Style-Bert-VITS2 POC container scaffold', () => {
  test.it('declares an opt-in Compose service and persistent model cache', () => {
    const compose = readRepoFile('docker-compose.yml');

    assert.match(compose, /^\s{2}tts-ja-sbv2:/m);
    assert.match(compose, /^\s{4}profiles:\s*\["sbv2"\]/m);
    assert.match(compose, /context:\s*\.\/tts\/style-bert-vits2/);
    assert.match(compose, /SBV2_MODEL_REPO=\$\{SBV2_MODEL_REPO:-litagin\/style_bert_vits2_jvnv\}/);
    assert.match(compose, /SBV2_MODEL_FILE=\$\{SBV2_MODEL_FILE:-jvnv-F1-jp\/jvnv-F1-jp_e160_s14000\.safetensors\}/);
    assert.match(compose, /sbv2_models:\/models/);
    assert.match(compose, /"\$\{SBV2_HOST_PORT:-15000\}:5000"/);
    assert.match(compose, /^\s{2}sbv2_models:/m);
  });

  test.it('provides a FastAPI wrapper with the expected health, model, and voice APIs', () => {
    const dockerfilePath = path.join(repoRoot, 'tts/style-bert-vits2/Dockerfile');
    const appPath = path.join(repoRoot, 'tts/style-bert-vits2/app.py');
    const requirements = readRepoFile('tts/style-bert-vits2/requirements.txt');

    assert.ok(fs.existsSync(dockerfilePath), 'SBV2 Dockerfile should exist');
    assert.ok(fs.existsSync(appPath), 'SBV2 FastAPI app should exist');

    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const app = fs.readFileSync(appPath, 'utf8');

    assert.match(dockerfile, /style-bert-vits2/);
    assert.match(dockerfile, /uvicorn/);
    assert.match(dockerfile, /torch/);
    assert.match(requirements, /numpy==1\.26\.4/);
    assert.match(app, /@app\.get\("\/status"\)/);
    assert.match(app, /@app\.get\("\/models\/info"\)/);
    assert.match(app, /@app\.get\("\/voice"\)/);
    assert.match(app, /ENABLE_OPENJTALK_WORKER =/);
    assert.match(app, /if ENABLE_OPENJTALK_WORKER:/);
    assert.match(app, /SBV2_BERT_MODEL/);
    assert.doesNotMatch(app, /device_map=DEVICE/);
    assert.doesNotMatch(app, /onnx_providers/);
    assert.match(app, /litagin\/style_bert_vits2_jvnv/);
    assert.match(app, /jvnv-F1-jp\/jvnv-F1-jp_e160_s14000\.safetensors/);
  });
});
