---
name: import-textbook-track
description: Extract ordered English/Japanese textbook expressions from user-provided local screenshots, add Chinese study cues and kanji-only ruby, bind an optional official Track audio file, and produce a validated Git-external draft Manifest. Use when Codex is asked to import, re-run, audit, or revise a Track from a locally owned bilingual textbook for Three LANS. Do not use the application's OCR endpoint or write SQLite directly.
---

# Import Textbook Track

Create a reviewable local draft from ordered textbook screenshots. Keep official source text, AI-derived fields, and user edits distinct.

## Required inputs

Obtain or infer these values before writing output:

- stable lowercase `course_key`;
- positive `track_number`;
- ordered absolute screenshot paths;
- optional absolute official audio path;
- explicit Git-external source root;
- expected expression count when the user or book provides it.

Never default the source root to the repository. Never copy textbook text into Git, tests, logs, or chat summaries.

## Workflow

1. Inspect every screenshot directly with image understanding. Do not call `/api/ocr` or another application OCR route.
2. Confirm page order and identify official vocabulary blocks separately from ordered English/Japanese expression pairs.
3. Copy source images and optional official audio into a stable course/Track directory below the Git-external source root. Do not alter originals.
4. Run `scripts/hash-assets.mjs` for each copied asset. Use its SHA-256, size, MIME, and safe relative path in the Manifest.
5. Transcribe official English and Japanese exactly. Preserve punctuation, contractions, spelling, and wording even when a pair is not literal.
6. Add one concise Chinese cue per pair. Treat it as `ai-derived`, never as official content.
7. Segment Japanese so only Han-character segments receive `reading`. Keep okurigana, kana, numbers, spaces, and punctuation in separate plain segments.
8. Add bounded phrase, grammar, register, and cross-language notes. Mark textbook glossary entries `official-source` with a source span; mark generated notes `ai-derived` unless the user edited them.
9. Record normalized source regions and field-level confidence. Use an editor note for ambiguity or non-literal pairing; do not silently rewrite the book.
10. Save a `textbook-track-manifest/v1` draft outside Git with placeholder 64-character hashes.
11. Run `scripts/validate-manifest.mjs --write-hashes` to compute unit/source/content hashes, validate schema and assets, and write a content-free dry-run summary.
12. Run the same validator again without `--write-hashes`. The second summary must have identical hashes and counts.
13. Stop at the dry-run. Ask for content confirmation before any future import API call. Never access SQLite from this Skill.

## Commands

```bash
node skills/import-textbook-track/scripts/hash-assets.mjs \
  --root "/absolute/textbook/source/root" \
  --path "course-key/track-01/source-01.png"

node skills/import-textbook-track/scripts/validate-manifest.mjs \
  --manifest "/absolute/textbook/source/root/course-key/track-01/manifest.v1.draft.json" \
  --source-root "/absolute/textbook/source/root" \
  --write-hashes \
  --summary "/absolute/textbook/source/root/course-key/track-01/dry-run-summary.json"

```

Read [references/track-manifest-schema.md](references/track-manifest-schema.md) when creating or revising fields. The machine contract remains `Docs/Architecture/schemas/textbook-track-manifest.v1.schema.json`.

## Hard stops

Stop and report a blocking error when:

- page order or English/Japanese pairing cannot be resolved;
- an official source field is illegible;
- a path escapes the source root or crosses a symlink;
- an asset hash, size, MIME, unit hash, content hash, or source fingerprint differs;
- ruby text does not reconstruct the official Japanese exactly;
- duplicate expression identities or ordinals exist;
- requested output would place actual textbook content in Git;
- the user has not confirmed the dry-run and an import/publish action is requested implicitly.

## Report

Return only the local Manifest/summary locations, counts, hash values, low-confidence expression keys, and blocking warnings. Do not repeat the textbook's full text in the report.
