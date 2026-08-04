import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCardDocument } from '../src/card-document';
import { sampleMarkdown } from '../src/fixture';

const output = fileURLToPath(new URL('../src/generated-card-document.json', import.meta.url));
await writeFile(output, `${JSON.stringify(parseCardDocument(sampleMarkdown), null, 2)}\n`, 'utf8');
