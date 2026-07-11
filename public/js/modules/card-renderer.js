const CARD_TYPES = new Set(['trilingual', 'grammar_ja', 'scenario_phrase']);

function normalizeCardType(value) {
    return CARD_TYPES.has(value) ? value : 'trilingual';
}

function enhanceCardHtmlByType(html, cardType = 'trilingual') {
    const source = String(html || '');
    if (!source.trim()) return '';
    const template = document.createElement('template');
    template.innerHTML = source;
    const existing = template.content.querySelector('[data-card-renderer-version="2"]');
    if (existing && template.content.children.length === 1) return template.innerHTML;

    const type = normalizeCardType(cardType);
    const wrapper = document.createElement('div');
    wrapper.className = `card-renderer card-renderer-${type.replace('_', '-')}`;
    wrapper.dataset.cardRendererVersion = '2';
    wrapper.dataset.cardType = type;
    wrapper.append(template.content.cloneNode(true));

    wrapper.querySelectorAll('h2').forEach((heading) => heading.classList.add('card-section-title'));
    wrapper.querySelectorAll('ruby').forEach((ruby) => ruby.classList.add('ja-ruby'));
    if (type === 'scenario_phrase') {
        wrapper.querySelectorAll('h3').forEach((heading) => {
            if (/^\s*\d{1,2}[.、]/.test(heading.textContent || '')) heading.classList.add('scenario-expression-heading');
        });
    } else if (type === 'grammar_ja') {
        wrapper.querySelectorAll('h2, h3').forEach((heading) => heading.classList.add('grammar-heading'));
    } else {
        wrapper.querySelectorAll('h2').forEach((heading, index) => {
            heading.classList.add(['language-en', 'language-ja', 'language-zh'][index] || 'language-extra');
        });
    }
    return wrapper.outerHTML;
}

function extractHighlightAnchors(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const seen = new Map();
    return [...template.content.querySelectorAll('mark.study-highlight-red')].map((mark) => {
        const text = (mark.textContent || '').replace(/\s+/g, ' ').trim();
        const occurrence = seen.get(text) || 0;
        seen.set(text, occurrence + 1);
        const parentText = (mark.parentElement?.textContent || '').replace(/\s+/g, ' ').trim();
        const start = Math.max(0, parentText.indexOf(text) - 20);
        return { text, occurrence, context: parentText.slice(start, start + text.length + 40) };
    }).filter((anchor) => anchor.text);
}

function replayHighlightAnchors(freshHtml, anchors = []) {
    const template = document.createElement('template');
    template.innerHTML = String(freshHtml || '');
    const root = template.content;
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest('button, script, style, rt, mark.study-highlight-red')) return NodeFilter.FILTER_REJECT;
            return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    anchors.forEach((anchor) => {
        let remaining = Number(anchor.occurrence || 0);
        for (const node of textNodes) {
            if (!node.parentNode) continue;
            const value = node.nodeValue || '';
            let from = 0;
            let index = value.indexOf(anchor.text, from);
            while (index >= 0) {
                if (remaining === 0) {
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + anchor.text.length);
                    const mark = document.createElement('mark');
                    mark.className = 'study-highlight-red';
                    range.surroundContents(mark);
                    return;
                }
                remaining -= 1;
                from = index + anchor.text.length;
                index = value.indexOf(anchor.text, from);
            }
        }
    });
    return template.innerHTML;
}

function migrateHighlightHtml(freshHtml, persistedHtml) {
    const anchors = extractHighlightAnchors(persistedHtml);
    return anchors.length ? replayHighlightAnchors(freshHtml, anchors) : freshHtml;
}

export { enhanceCardHtmlByType, extractHighlightAnchors, migrateHighlightHtml, replayHighlightAnchors };
