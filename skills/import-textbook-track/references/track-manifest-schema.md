# Track Manifest v1 field guide

Use this guide with `Docs/Architecture/schemas/textbook-track-manifest.v1.schema.json`. The JSON Schema is authoritative for shape; the validator is authoritative for cross-field and filesystem rules.

## Source roles

| Field | Role | Rule |
|---|---|---|
| `official.en/ja.text` | Official transcription | Preserve source wording exactly |
| `official.*.sourceSpan` | Source evidence | Reference a source image and normalized region |
| `derived.zhCue` | AI-derived study prompt | One concise Chinese cue shared by EN/JA units |
| `derived.rubySegments` | AI-derived reading aid | `reading` only on Han-only text segments |
| `derived.analysis` | Official glossary plus AI/user learning notes | Official entries require `official-source` and a source span |
| `confidence` | Extraction confidence | Number from 0 to 1 for each field group |
| `editorNote` | Ambiguity or user note | Never overwrite official text |

## Identity

- `course.key` is stable and lowercase kebab-case.
- `track.number` is the printed/audio Track number.
- Initial expression keys are `expr:01`, `expr:02`, and so on.
- `ordinal` controls display order; the stable key controls learning identity.
- Asset keys are `source:01...` and optional `official:01`.

## Ruby segmentation

The concatenated `rubySegments[].text` must exactly equal `official.ja.text`.

Good:

```json
[
  {"text": "学校", "reading": "がっこう"},
  {"text": "に"},
  {"text": "遅", "reading": "おく"},
  {"text": "れるわ。"}
]
```

Do not place okurigana or punctuation inside a segment with `reading`.

## Hashes

- `sourceFingerprint`: course/Track identity, Skill version, and ordered asset hashes.
- `contentHash`: semantic course/Track/assets/expressions, excluding timestamps, paths, revision number, and precomputed hashes.
- EN unit hash: version, expression key, Chinese cue, official English target.
- JA unit hash: version, expression key, Chinese cue, official Japanese target, canonical ruby segments.
- Manifest file hash: SHA-256 of canonical sorted JSON after computed hashes are present; it is emitted in the summary, not embedded in the Manifest.

Changing analysis, confidence, editor notes, source regions, or audio availability does not change a Study Item unit hash.

## Confidence

Use conservative values. Values below `0.85` appear in the dry-run review list. Pairing confidence represents whether the two official lines are a deliberate book pair, not whether they are literal translations.

## Local-only outputs

Actual Manifest, screenshots, audio, dry-run summary, Chinese cues, ruby, and official text stay below the explicit source root and outside Git. Repository tests use only synthetic content.
