#!/usr/bin/env bash
set -euo pipefail

echo "[1/7] React typecheck"
npm run typecheck:react

echo "[2/7] ESLint"
npm run lint

echo "[3/7] Unit tests"
npm test

echo "[4/7] Integration tests"
npm run test:integration

echo "[5/7] Architecture ownership and completion gates"
npm run test:architecture

echo "[6/7] Production smoke"
npm run smoke

echo "[7/7] Playwright functional and visual tests"
npm run test:e2e

echo "Architecture acceptance OK"
