INSERT INTO textbook_expression_review_states(
  track_id, track_revision_id, expression_id, expression_revision_id,
  status, reason_code, reviewer, confirmed_at_utc, revision,
  created_at_utc, updated_at_utc
)
SELECT
  revision.track_id,
  revision.id,
  expression_revision.expression_id,
  expression_revision.id,
  'confirmed',
  NULL,
  'workflow-migration-008',
  COALESCE(track.published_at_utc, revision.verified_at_utc, revision.created_at_utc),
  1,
  COALESCE(track.published_at_utc, revision.verified_at_utc, revision.created_at_utc),
  COALESCE(track.published_at_utc, revision.verified_at_utc, revision.created_at_utc)
FROM textbook_track_revisions revision
JOIN textbook_tracks track
  ON track.id = revision.track_id
  AND track.current_revision_id = revision.id
JOIN textbook_expression_revisions expression_revision
  ON expression_revision.revision_id = revision.id
WHERE revision.status = 'published'
  AND track.status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM textbook_expression_review_states existing
    WHERE existing.track_revision_id = revision.id
  )
ON CONFLICT(track_revision_id, expression_id) DO NOTHING;
