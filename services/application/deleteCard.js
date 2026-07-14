'use strict';

const fs = require('node:fs');

function createDeleteCardUseCase(ports) {
  const required = [
    'getGenerationById',
    'deleteGenerationWithLearningState',
    'deleteCardHighlightByFile',
    'deleteRecordFiles',
  ];
  for (const name of required) {
    if (typeof ports[name] !== 'function') throw new TypeError(`delete card port ${name} is required`);
  }

  return function deleteCard(recordId) {
    const record = ports.getGenerationById(recordId);
    if (!record) return null;
    const exactPaths = [record.md_file_path, record.html_file_path, record.meta_file_path].filter(Boolean);
    for (const audio of record.audioFiles || []) {
      if (audio.file_path) exactPaths.push(audio.file_path);
    }

    // Database state is authoritative. Preserve learning history before any
    // best-effort filesystem cleanup can fail.
    const database = ports.deleteGenerationWithLearningState(recordId);
    const highlightDeleted = ports.deleteCardHighlightByFile(record.folder_name, record.base_filename);
    const deletedPaths = new Set();
    const cleanupErrors = [];
    for (const filePath of exactPaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedPaths.add(filePath);
        }
      } catch (error) {
        cleanupErrors.push({ filePath, message: error.message });
        ports.log?.warn?.({ err: error, filePath, recordId }, 'card deletion file cleanup failed');
      }
    }
    try {
      for (const filePath of ports.deleteRecordFiles(record.folder_name, record.base_filename)) {
        deletedPaths.add(filePath);
      }
    } catch (error) {
      cleanupErrors.push({ filePath: null, message: error.message });
      ports.log?.warn?.({ err: error, recordId }, 'card deletion fallback cleanup failed');
    }

    return {
      recordId,
      database,
      deletedFiles: deletedPaths.size,
      deletedPaths: Array.from(deletedPaths),
      highlightDeleted,
      cleanupErrors,
    };
  };
}

module.exports = { createDeleteCardUseCase };
