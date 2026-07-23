import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('experiments/cloudscape-workflow');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist', 'assets');

if (packageJson.dependencies['@cloudscape-design/components'] !== '3.0.1333') {
  throw new Error('Cloudscape POC version must remain pinned');
}
if (!fs.existsSync(distDir)) throw new Error('Cloudscape POC build output missing');

const assets = fs.readdirSync(distDir).map((name) => ({
  name,
  bytes: fs.statSync(path.join(distDir, name)).size,
}));
const result = {
  isolated: true,
  cloudscapeVersion: packageJson.dependencies['@cloudscape-design/components'],
  assetCount: assets.length,
  totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  assets,
};
fs.writeFileSync(path.join(root, 'dist', 'poc-metrics.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
