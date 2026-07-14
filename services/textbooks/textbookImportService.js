'use strict';

const { validateManifestDraft } = require('./manifestValidator');

class TextbookImportService {
  constructor({ dbService, sourceRoot }) {
    this.dbService = dbService;
    this.sourceRoot = sourceRoot;
  }

  async dryRun(payload = {}) {
    const validated = await validateManifestDraft({
      sourceRoot: this.sourceRoot,
      manifestRelativePath: payload.manifestRelativePath,
      expectedManifestHash: payload.expectedManifestHash,
    });
    return {
      summary: validated.summary,
      manifestHash: validated.manifestHash,
    };
  }

  async importDraft(payload = {}) {
    const validated = await validateManifestDraft({
      sourceRoot: this.sourceRoot,
      manifestRelativePath: payload.manifestRelativePath,
      expectedManifestHash: payload.expectedManifestHash,
    });
    const track = this.dbService.importTextbookDraft({
      manifest: validated.manifest,
      manifestRelativePath: validated.manifestRelativePath,
      manifestHash: validated.manifestHash,
    });
    return {
      track,
      summary: validated.summary,
      manifestHash: validated.manifestHash,
    };
  }
}

module.exports = {
  TextbookImportService,
};
