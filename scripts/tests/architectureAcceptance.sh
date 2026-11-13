#!/usr/bin/env bash
set -euo pipefail

echo "[1/8] React typecheck"
npm run typecheck:react

echo "[2/8] ESLint"
npm run lint

echo "[3/8] Unit tests"
npm test

echo "[4/8] Development toolchain security"
npm run test:toolchain-security

echo "[5/8] Integration tests"
npm run test:integration

echo "[6/8] Architecture ownership and completion gates"
npm run test:architecture

echo "[7/8] Production smoke"
npm run smoke

echo "[8/8] Playwright functional and visual tests"
npm run test:e2e

echo "Architecture acceptance OK"
