'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const hashedAsset = /^[\w.-]+-[\w-]{8,}\.(?:css|js)$/u;

function clientAssets(build = path.resolve('build')) {
  const root = path.join(build, 'client');
  const fallback = express.static(root, { index: false });
  const assets = new Map();
  for (const name of fs.readdirSync(path.join(root, 'assets'))) {
    if (!hashedAsset.test(name)) continue;
    const formats = ['br', 'gzip'].filter(format => fs.existsSync(path.join(build, 'encoded', name + '.' + format)));
    assets.set('/assets/' + name, { name, formats });
  }
  return (req, res, next) => {
    const asset = assets.get(req.path);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) return fallback(req, res, next);
    res.vary('Accept-Encoding');
    const encoding = req.acceptsEncodings(...asset.formats, 'identity');
    if (!encoding) return res.sendStatus(406);
    const compressed = encoding !== 'identity';
    if (compressed) res.set('Content-Encoding', encoding);
    res.type(asset.name.endsWith('.js') ? 'application/javascript' : 'text/css');
    const file = compressed ? path.join(build, 'encoded', asset.name + '.' + encoding) : path.join(root, 'assets', asset.name);
    return res.sendFile(file, { maxAge: '1y', immutable: true, acceptRanges: !compressed });
  };
}

module.exports = { clientAssets, hashedAsset };
