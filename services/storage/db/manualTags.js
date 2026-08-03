'use strict';

function nowUtc() {
  return new Date().toISOString();
}

function mapTag(row) {
  return row ? {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    status: row.status,
    isSeed: Boolean(row.is_seed),
    version: row.version,
    usageCount: Number(row.usage_count || 0),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  } : null;
}

function listDefinitions(db, { includeArchived = false } = {}) {
  return db.prepare(`
    SELECT definition.*, COUNT(assignment.id) AS usage_count
    FROM manual_tag_definitions definition
    LEFT JOIN manual_tag_assignments assignment ON assignment.tag_id = definition.id
    ${includeArchived ? '' : "WHERE definition.status = 'active'"}
    GROUP BY definition.id
    ORDER BY
      CASE definition.category
        WHEN 'priority' THEN 1 WHEN 'status' THEN 2 WHEN 'skill' THEN 3
        WHEN 'topic' THEN 4 ELSE 5 END,
      definition.normalized_name
  `).all().map(mapTag);
}

function getDefinition(db, id) {
  return mapTag(db.prepare(`
    SELECT definition.*, COUNT(assignment.id) AS usage_count
    FROM manual_tag_definitions definition
    LEFT JOIN manual_tag_assignments assignment ON assignment.tag_id = definition.id
    WHERE definition.id = ?
    GROUP BY definition.id
  `).get(id));
}

function createDefinition(db, tag) {
  const timestamp = nowUtc();
  const result = db.prepare(`
    INSERT INTO manual_tag_definitions(
      name, normalized_name, category, color, status, is_seed, version,
      created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, 'active', 0, 1, ?, ?)
  `).run(tag.name, tag.normalizedName, tag.category, tag.color, timestamp, timestamp);
  return getDefinition(db, Number(result.lastInsertRowid));
}

function updateDefinition(db, id, expectedVersion, tag) {
  const result = db.prepare(`
    UPDATE manual_tag_definitions
    SET name = ?, normalized_name = ?, category = ?, color = ?,
        version = version + 1, updated_at_utc = ?
    WHERE id = ? AND version = ? AND status = 'active'
  `).run(tag.name, tag.normalizedName, tag.category, tag.color, nowUtc(), id, expectedVersion);
  return result.changes ? getDefinition(db, id) : null;
}

function archiveDefinition(db, id, expectedVersion) {
  const result = db.prepare(`
    UPDATE manual_tag_definitions
    SET status = 'archived', version = version + 1, updated_at_utc = ?
    WHERE id = ? AND version = ? AND status = 'active'
  `).run(nowUtc(), id, expectedVersion);
  return result.changes ? getDefinition(db, id) : null;
}

function listAssigned(db, targetKind, targetId) {
  return db.prepare(`
    SELECT definition.*, 0 AS usage_count
    FROM manual_tag_assignments assignment
    JOIN manual_tag_definitions definition ON definition.id = assignment.tag_id
    WHERE assignment.target_kind = ? AND assignment.target_id = ?
      AND definition.status = 'active'
    ORDER BY definition.normalized_name
  `).all(targetKind, targetId).map(mapTag);
}

function replaceAssignments(db, targetKind, targetId, tagIds) {
  const timestamp = nowUtc();
  const replace = db.transaction(() => {
    db.prepare(`
      DELETE FROM manual_tag_assignments WHERE target_kind = ? AND target_id = ?
    `).run(targetKind, targetId);
    const insert = db.prepare(`
      INSERT INTO manual_tag_assignments(tag_id, target_kind, target_id, created_at_utc)
      VALUES (?, ?, ?, ?)
    `);
    tagIds.forEach((tagId) => insert.run(tagId, targetKind, targetId, timestamp));
  });
  replace();
  return listAssigned(db, targetKind, targetId);
}

function listTargets(db, tagId, { targetKind = null, limit = 100, offset = 0 } = {}) {
  const where = ['assignment.tag_id = ?'];
  const params = [tagId];
  if (targetKind) {
    where.push('assignment.target_kind = ?');
    params.push(targetKind);
  }
  params.push(limit, offset);
  return db.prepare(`
    SELECT assignment.target_kind, assignment.target_id, assignment.created_at_utc
    FROM manual_tag_assignments assignment
    WHERE ${where.join(' AND ')}
    ORDER BY assignment.created_at_utc DESC, assignment.id DESC
    LIMIT ? OFFSET ?
  `).all(...params).map((row) => ({
    targetKind: row.target_kind,
    targetId: row.target_id,
    createdAtUtc: row.created_at_utc,
  }));
}

module.exports = {
  archiveDefinition,
  createDefinition,
  getDefinition,
  listAssigned,
  listDefinitions,
  listTargets,
  replaceAssignments,
  updateDefinition,
};
