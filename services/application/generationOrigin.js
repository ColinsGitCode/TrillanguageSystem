'use strict';

function relativeName(value, maxLength) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= maxLength && name !== '.' && name !== '..'
    && !/[/\\\u0000-\u001f]/u.test(name) ? name : null;
}

function resolveGenerationOrigin({ sourceMode, targetFolder, sourceContext } = {}) {
  const folder = String(targetFolder || '').trim();
  const context = sourceContext && typeof sourceContext === 'object' && !Array.isArray(sourceContext)
    ? sourceContext : {};
  if (sourceMode !== 'selection') return { targetFolder: folder, sourceContext: context };

  const origin = {};
  if (context.surface === 'card-modal') origin.surface = context.surface;
  if (Number.isSafeInteger(context.generationId) && context.generationId > 0) {
    origin.generationId = context.generationId;
  }
  // Old clients used the source folder as the destination. Keep it only as provenance.
  const sourceFolder = relativeName(context.folder, 128) || relativeName(folder, 128);
  const baseFilename = relativeName(context.baseFilename, 255);
  if (sourceFolder) origin.folder = sourceFolder;
  if (baseFilename) origin.baseFilename = baseFilename;

  // Empty destination lets the worker choose the execution day's configured timezone.
  return { targetFolder: '', sourceContext: origin };
}

module.exports = { resolveGenerationOrigin };
