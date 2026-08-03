'use strict';

const CATEGORIES = new Set(['priority', 'status', 'skill', 'topic', 'custom']);
const COLORS = new Set(['gray', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple']);
const TARGET_TABLES = Object.freeze({
  generation: 'generations',
  textbook_track: 'textbook_tracks',
  textbook_expression: 'textbook_expressions',
  knowledge_point: 'kg_points',
});

function manualTagError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('zh-CN');
}

function parsePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw manualTagError('MANUAL_TAG_INVALID_INPUT', `${field} must be a positive integer`);
  }
  return parsed;
}

class ManualTagService {
  constructor({ database }) {
    this.database = database;
  }

  validateTarget(targetKind, targetId) {
    const table = TARGET_TABLES[targetKind];
    if (!table) {
      throw manualTagError('MANUAL_TAG_TARGET_KIND_INVALID', 'Unsupported tag target kind');
    }
    const id = parsePositiveInteger(targetId, 'targetId');
    const exists = this.database.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
    if (!exists) {
      throw manualTagError('MANUAL_TAG_TARGET_NOT_FOUND', 'Tag target not found', 404);
    }
    return { targetKind, targetId: id };
  }

  validateDefinition(input = {}) {
    const name = String(input.name || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
    const normalizedName = normalizeName(name);
    const category = String(input.category || 'custom');
    const color = String(input.color || 'gray');
    if (!name || Array.from(name).length > 40) {
      throw manualTagError('MANUAL_TAG_NAME_INVALID', 'Tag name must contain 1 to 40 characters');
    }
    if (!CATEGORIES.has(category)) {
      throw manualTagError('MANUAL_TAG_CATEGORY_INVALID', 'Unsupported tag category');
    }
    if (!COLORS.has(color)) {
      throw manualTagError('MANUAL_TAG_COLOR_INVALID', 'Unsupported tag color');
    }
    return { name, normalizedName, category, color };
  }

  list({ targetKind, targetId, includeArchived = false } = {}) {
    const tags = this.database.listManualTagDefinitions({ includeArchived });
    if (targetKind === undefined && targetId === undefined) return { tags, assignedTagIds: [] };
    const target = this.validateTarget(String(targetKind || ''), targetId);
    const assigned = this.database.listManualTagsForTarget(target.targetKind, target.targetId);
    return { tags, assignedTagIds: assigned.map((tag) => tag.id) };
  }

  create(input = {}) {
    const definition = this.validateDefinition(input);
    try {
      return this.database.createManualTagDefinition(definition);
    } catch (error) {
      if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw manualTagError('MANUAL_TAG_NAME_CONFLICT', 'A tag with this name already exists', 409);
      }
      throw error;
    }
  }

  update(idValue, input = {}) {
    const id = parsePositiveInteger(idValue, 'tagId');
    const expectedVersion = parsePositiveInteger(input.expectedVersion, 'expectedVersion');
    const current = this.database.getManualTagDefinition(id);
    if (!current || current.status !== 'active') {
      throw manualTagError('MANUAL_TAG_NOT_FOUND', 'Tag not found', 404);
    }
    const definition = this.validateDefinition({
      name: input.name ?? current.name,
      category: input.category ?? current.category,
      color: input.color ?? current.color,
    });
    try {
      const updated = this.database.updateManualTagDefinition(id, expectedVersion, definition);
      if (!updated) {
        throw manualTagError('MANUAL_TAG_VERSION_CONFLICT', 'Tag was updated elsewhere', 409, {
          current: this.database.getManualTagDefinition(id),
        });
      }
      return updated;
    } catch (error) {
      if (error.code === 'MANUAL_TAG_VERSION_CONFLICT') throw error;
      if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw manualTagError('MANUAL_TAG_NAME_CONFLICT', 'A tag with this name already exists', 409);
      }
      throw error;
    }
  }

  archive(idValue, input = {}) {
    const id = parsePositiveInteger(idValue, 'tagId');
    const expectedVersion = parsePositiveInteger(input.expectedVersion, 'expectedVersion');
    const current = this.database.getManualTagDefinition(id);
    if (!current || current.status !== 'active') {
      throw manualTagError('MANUAL_TAG_NOT_FOUND', 'Tag not found', 404);
    }
    const archived = this.database.archiveManualTagDefinition(id, expectedVersion);
    if (!archived) {
      throw manualTagError('MANUAL_TAG_VERSION_CONFLICT', 'Tag was updated elsewhere', 409, {
        current: this.database.getManualTagDefinition(id),
      });
    }
    return archived;
  }

  replaceAssignments(input = {}) {
    const target = this.validateTarget(String(input.targetKind || ''), input.targetId);
    const tagIds = [...new Set((Array.isArray(input.tagIds) ? input.tagIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0))];
    if (tagIds.length > 20) {
      throw manualTagError('MANUAL_TAG_ASSIGNMENT_LIMIT', 'A page can have at most 20 tags');
    }
    const definitions = tagIds.map((id) => this.database.getManualTagDefinition(id));
    if (definitions.some((tag) => !tag || tag.status !== 'active')) {
      throw manualTagError('MANUAL_TAG_NOT_FOUND', 'One or more tags are unavailable', 404);
    }
    const assigned = this.database.replaceManualTagsForTarget(
      target.targetKind, target.targetId, tagIds
    );
    return { ...target, tags: assigned };
  }

  listTargets(tagIdValue, options = {}) {
    const tagId = parsePositiveInteger(tagIdValue, 'tagId');
    const tag = this.database.getManualTagDefinition(tagId);
    if (!tag) throw manualTagError('MANUAL_TAG_NOT_FOUND', 'Tag not found', 404);
    const targetKind = options.targetKind ? String(options.targetKind) : null;
    if (targetKind && !TARGET_TABLES[targetKind]) {
      throw manualTagError('MANUAL_TAG_TARGET_KIND_INVALID', 'Unsupported tag target kind');
    }
    const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
    const offset = Math.max(0, Number(options.offset) || 0);
    const targets = this.database.listManualTagTargets(tagId, { targetKind, limit, offset })
      .map((target) => ({ ...target, ...this.describeTarget(target.targetKind, target.targetId) }));
    return { tag, targets, limit, offset };
  }

  describeTarget(targetKind, targetId) {
    if (targetKind === 'generation') {
      const row = this.database.db.prepare(
        'SELECT phrase, folder_name, base_filename FROM generations WHERE id = ?'
      ).get(targetId);
      return { title: row?.phrase || row?.base_filename || `卡片 #${targetId}`, subtitle: row?.folder_name || '' };
    }
    if (targetKind === 'textbook_track') {
      const row = this.database.db.prepare(
        'SELECT title, track_number FROM textbook_tracks WHERE id = ?'
      ).get(targetId);
      return { title: row?.title || `Track #${targetId}`, subtitle: row ? `Track ${row.track_number}` : '' };
    }
    if (targetKind === 'textbook_expression') {
      const row = this.database.db.prepare(`
        SELECT revision.official_en_text, expression.expression_key
        FROM textbook_expressions expression
        LEFT JOIN textbook_expression_revisions revision
          ON revision.expression_id = expression.id
        WHERE expression.id = ?
        ORDER BY revision.revision_id DESC LIMIT 1
      `).get(targetId);
      return { title: row?.official_en_text || `教材表达 #${targetId}`, subtitle: row?.expression_key || '' };
    }
    const row = this.database.db.prepare(
      'SELECT canonical_form, language, kp_kind FROM kg_points WHERE id = ?'
    ).get(targetId);
    return { title: row?.canonical_form || `知识点 #${targetId}`, subtitle: row ? `${row.language} · ${row.kp_kind}` : '' };
  }
}

module.exports = { ManualTagService, manualTagError, normalizeName };
