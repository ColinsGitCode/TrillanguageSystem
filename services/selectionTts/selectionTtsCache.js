'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SelectionTtsCache {
  constructor(options = {}) {
    this.rootPath = options.rootPath;
    this.ttlMs = Math.max(1000, Number(options.ttlMs) || (168 * 60 * 60 * 1000));
    this.maxBytes = Math.max(1, Number(options.maxBytes) || (256 * 1024 * 1024));
    this.clock = options.clock || Date.now;
    this.fs = options.fs || fs.promises;
  }

  paths(key) {
    return {
      audio: path.join(this.rootPath, `${key}.audio`),
      metadata: path.join(this.rootPath, `${key}.json`),
    };
  }

  async get(key) {
    const files = this.paths(key);
    try {
      const [metadataText, stat] = await Promise.all([
        this.fs.readFile(files.metadata, 'utf8'),
        this.fs.stat(files.audio),
      ]);
      const metadata = JSON.parse(metadataText);
      if (this.clock() - Number(metadata.createdAtMs || stat.mtimeMs) > this.ttlMs) {
        await this.remove(key);
        return null;
      }
      if (!Number.isFinite(metadata.bytes) || metadata.bytes !== stat.size || stat.size <= 0) {
        await this.remove(key);
        return null;
      }
      const buffer = await this.fs.readFile(files.audio);
      await Promise.allSettled([
        this.fs.utimes(files.audio, new Date(), new Date()),
        this.fs.utimes(files.metadata, new Date(), new Date()),
      ]);
      return { buffer, metadata };
    } catch (_error) {
      return null;
    }
  }

  async set(key, buffer, metadata) {
    const files = this.paths(key);
    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const audioTemp = `${files.audio}.${nonce}.tmp`;
    const metadataTemp = `${files.metadata}.${nonce}.tmp`;
    try {
      await this.fs.mkdir(this.rootPath, { recursive: true });
      const storedMetadata = {
        ...metadata,
        bytes: buffer.length,
        createdAtMs: this.clock(),
      };
      await this.fs.writeFile(audioTemp, buffer, { flag: 'wx' });
      await this.fs.writeFile(metadataTemp, JSON.stringify(storedMetadata), { flag: 'wx' });
      await this.fs.rename(audioTemp, files.audio);
      await this.fs.rename(metadataTemp, files.metadata);
      await this.cleanup();
      return true;
    } catch (_error) {
      await Promise.allSettled([
        this.fs.rm(audioTemp, { force: true }),
        this.fs.rm(metadataTemp, { force: true }),
      ]);
      return false;
    }
  }

  async remove(key) {
    const files = this.paths(key);
    await Promise.allSettled([
      this.fs.rm(files.audio, { force: true }),
      this.fs.rm(files.metadata, { force: true }),
    ]);
  }

  async cleanup() {
    let names;
    try {
      names = await this.fs.readdir(this.rootPath);
    } catch (_error) {
      return { removed: 0, bytes: 0 };
    }
    const audioNames = names.filter((name) => name.endsWith('.audio'));
    const entries = [];
    let removed = 0;
    for (const name of audioNames) {
      const key = name.slice(0, -'.audio'.length);
      const files = this.paths(key);
      try {
        const stat = await this.fs.stat(files.audio);
        if (this.clock() - stat.mtimeMs > this.ttlMs) {
          await this.remove(key);
          removed += 1;
        } else {
          entries.push({ key, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch (_error) {
        await this.remove(key);
        removed += 1;
      }
    }
    let bytes = entries.reduce((sum, item) => sum + item.size, 0);
    entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
    while (bytes > this.maxBytes && entries.length) {
      const oldest = entries.shift();
      await this.remove(oldest.key);
      bytes -= oldest.size;
      removed += 1;
    }
    return { removed, bytes };
  }
}

module.exports = { SelectionTtsCache };
