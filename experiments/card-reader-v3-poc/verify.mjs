import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { chromium } from '@playwright/test';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`POC server did not start: ${url}`);
}

run('npm', ['run', 'test']);
run('npm', ['run', 'build']);

const preview = spawn('npm', ['exec', 'vite', '--', 'preview', '--host', '127.0.0.1', '--port', '4178'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});

try {
  await waitForServer('http://127.0.0.1:4178');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4178');
  await page.getByRole('heading', { name: 'fine folks', level: 1 }).waitFor();
  const sections = page.locator('.language-section');
  if (await sections.count() !== 3) throw new Error('Expected three language sections');
  if (await page.evaluate(() => globalThis.__unsafe_card_script__ === true)) throw new Error('Unsafe card script executed');

  const pronunciation = page.getByRole('button', { name: '良い，读音 よい' });
  await pronunciation.hover();
  await page.getByRole('tooltip').getByText('よい', { exact: true }).waitFor();
  await page.mouse.move(4, 4);
  await pronunciation.focus();
  await page.getByRole('tooltip').getByText('よい', { exact: true }).waitFor();

  await page.getByRole('button', { name: '播放语音' }).first().click();
  await page.getByRole('status').getByText(/fine-folks-en-01\.mp3/u).waitFor();

  await page.locator('.language-section.is-en li').nth(1).evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.nodeValue?.includes('informal')) text = walker.nextNode();
    if (!text) throw new Error('Selection fixture text not found');
    const value = text.nodeValue || '';
    const start = value.indexOf('informal');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'informal and warm'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('toolbar', { name: '选区操作' }).waitFor();
  await pronunciation.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  if (await page.getByRole('toolbar', { name: '选区操作' }).locator('strong').getAttribute('title') !== '良い') {
    throw new Error('Japanese selection did not reach the shared selection toolbar');
  }

  await page.screenshot({ path: 'dist/card-reader-v3-poc.png', fullPage: true });
  await browser.close();
  console.log('Card Reader v3 POC: 4 contract tests + desktop browser verification passed');
} finally {
  preview.kill('SIGTERM');
}
