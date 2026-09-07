const { expect } = require('@playwright/test');

async function enqueueAndWait(request, phrase, cardType, { targetFolder = '' } = {}) {
  const created = await request.post('/api/generation-jobs', {
    data: { phrase, card_type: cardType, source_mode: 'input', target_folder: targetFolder },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const id = body.job.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    return (await response.json()).job.status;
  }, { timeout: 30_000, intervals: [100, 200, 500] }).toBe('success');
  return body.job;
}

async function waitForPronunciationContent(page) {
  await expect(page.getByTestId('react-card-content').locator('.pronunciation-token').first()).toBeVisible();
}

async function selectVisibleText(page, text, { keyboard = false } = {}) {
  const content = page.getByTestId('react-card-content');
  await waitForPronunciationContent(page);
  await content.evaluate((container, options) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    const joined = nodes.map((item) => item.nodeValue || '').join('');
    const matchStart = joined.indexOf(options.text);
    if (matchStart < 0) throw new Error(`Unable to find selection text: ${options.text}`);
    const matchEnd = matchStart + options.text.length;
    let cursor = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    for (const candidate of nodes) {
      const length = String(candidate.nodeValue || '').length;
      if (!startNode && matchStart >= cursor && matchStart <= cursor + length) {
        startNode = candidate;
        startOffset = matchStart - cursor;
      }
      if (matchEnd >= cursor && matchEnd <= cursor + length) {
        endNode = candidate;
        endOffset = matchEnd - cursor;
        break;
      }
      cursor += length;
    }
    if (!startNode || !endNode) throw new Error(`Unable to map selection text: ${options.text}`);
    if (options.keyboard) {
      container.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }));
    }
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (options.keyboard) {
      document.dispatchEvent(new Event('selectionchange'));
      container.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }));
    } else {
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  }, { text, keyboard });
}

module.exports = { enqueueAndWait, waitForPronunciationContent, selectVisibleText };
