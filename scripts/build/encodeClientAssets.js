'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { hashedAsset } = require('../../lib/clientAssets');

function encodeClientAssets(build = path.resolve('build')) {
  const source = path.join(build, 'client/assets');
  const output = path.join(build, 'encoded');
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(source).filter(name => hashedAsset.test(name))) {
    const bytes = fs.readFileSync(path.join(source, name));
    fs.writeFileSync(path.join(output, name + '.br'), zlib.brotliCompressSync(bytes, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    }));
    fs.writeFileSync(path.join(output, name + '.gzip'), zlib.gzipSync(bytes));
  }
}

if (require.main === module) encodeClientAssets();
module.exports = { encodeClientAssets };
