import { escapeHtml, formatDate } from './utils.js';

let overlayEl = null;
let cardEl = null;
let closeBtnEl = null;
let bodyEl = null;
let escapeBound = false;
let currentDetail = { job: null, events: [] };

function parseQueueTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value).trim();
    if (!normalized) return 0;
    const utcLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)
        ? normalized.replace(' ', 'T') + 'Z'
        : normalized;
    const ts = Date.parse(utcLike);
    return Number.isFinite(ts) ? ts : 0;
}

function formatQueueDate(value) {
    const ts = parseQueueTimestamp(value);
    return ts > 0 ? formatDate(ts) : '-';
}

function getQueueEventLabel(eventType) {
    return {
        created: 'CREATED',
        picked: 'PICKED',
        retry_scheduled: 'RETRY',
        failed: 'FAILED',
        succeeded: 'SUCCESS',
        cancelled: 'CANCELLED',
        reset_to_queued_after_restart: 'RECOVERED'
    }[String(eventType || '').trim().toLowerCase()] || String(eventType || 'UNKNOWN').trim().toUpperCase();
}

function buildQueueEventNote(event = {}) {
    const payload = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
    if (payload.error) return String(payload.error).trim();
    if (payload.generationId) return `generation #${payload.generationId}`;
    if (payload.folder && payload.baseName) return `${payload.folder}/${payload.baseName}`;
    if (payload.phrase) return String(payload.phrase).trim();
    if (payload.providerUsed || payload.modelUsed) {
        return [payload.providerUsed, payload.modelUsed].filter(Boolean).join(' · ');
    }
    if (payload.attempts) return `attempt ${payload.attempts}`;
    return '';
}

function stringifyJson(value) {
    if (value == null) return '{}';
    try {
        return JSON.stringify(value, null, 2);
    } catch (_) {
        return String(value);
    }
}

function renderMetaItem(label, value) {
    return `
        <div class="queue-job-modal-meta-item">
            <span class="queue-job-modal-meta-label">${escapeHtml(label)}</span>
            <span class="queue-job-modal-meta-value">${escapeHtml(value == null || value === '' ? '-' : String(value))}</span>
        </div>
    `;
}

function renderCopyButton(action, key, label, testId = '') {
    return `
        <button
            type="button"
            class="queue-job-modal-copy-btn"
            data-action="${escapeHtml(action)}"
            data-copy-key="${escapeHtml(key)}"
            ${testId ? `data-testid="${escapeHtml(testId)}"` : ''}
        >${escapeHtml(label)}</button>
    `;
}

function renderSection(title, bodyHtml, testId = '', extraActionsHtml = '') {
    return `
        <section class="queue-job-modal-section"${testId ? ` data-testid="${escapeHtml(testId)}"` : ''}>
            <div class="queue-job-modal-section-head">
                <div class="queue-job-modal-section-title">${escapeHtml(title)}</div>
                <div class="queue-job-modal-section-actions">${extraActionsHtml}</div>
            </div>
            ${bodyHtml}
        </section>
    `;
}

async function copyText(text) {
    const normalized = String(text || '');
    if (!normalized) return false;
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized);
        return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = normalized;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
}

function markCopied(button) {
    if (!button) return;
    const original = button.dataset.copyLabel || button.textContent || '复制';
    button.dataset.copyLabel = original;
    button.textContent = '已复制';
    button.classList.add('is-copied');
    clearTimeout(button.__copyTimerId);
    button.__copyTimerId = setTimeout(() => {
        button.textContent = original;
        button.classList.remove('is-copied');
    }, 1200);
}

function resolveCopyPayload(button) {
    const key = String(button?.dataset.copyKey || '').trim();
    if (!key) return '';
    if (key === 'error') return String(currentDetail.job?.errorMessage || '');
    if (key === 'request') return stringifyJson(currentDetail.job?.requestPayload || {});
    if (key === 'sourceContext') return stringifyJson(currentDetail.job?.sourceContext || {});
    if (key === 'result') return stringifyJson(currentDetail.job?.resultSummary || {});
    if (key === 'events') return stringifyJson(currentDetail.events || []);
    if (key.startsWith('event:')) {
        const eventId = Number(key.slice('event:'.length));
        const event = (currentDetail.events || []).find((item) => Number(item.id || 0) === eventId);
        return stringifyJson(event?.payload || {});
    }
    return '';
}

function ensureModal() {
    if (overlayEl && cardEl && bodyEl) return;
    overlayEl = document.createElement('div');
    overlayEl.className = 'queue-job-modal-overlay hidden';
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('data-testid', 'queue-job-detail-modal');
    overlayEl.innerHTML = `
        <div class="queue-job-modal-card">
            <div class="queue-job-modal-head">
                <div class="queue-job-modal-title-wrap">
                    <div class="queue-job-modal-eyebrow">Generation Job</div>
                    <h3 class="queue-job-modal-title">任务详情</h3>
                </div>
                <button type="button" class="queue-job-modal-close" data-testid="queue-job-detail-close" aria-label="关闭">×</button>
            </div>
            <div class="queue-job-modal-body"></div>
        </div>
    `;
    document.body.appendChild(overlayEl);
    cardEl = overlayEl.querySelector('.queue-job-modal-card');
    closeBtnEl = overlayEl.querySelector('.queue-job-modal-close');
    bodyEl = overlayEl.querySelector('.queue-job-modal-body');

    closeBtnEl.addEventListener('click', closeGenerationJobDetailModal);
    overlayEl.addEventListener('click', (event) => {
        if (event.target === overlayEl) closeGenerationJobDetailModal();
    });
    cardEl.addEventListener('click', async (event) => {
        const copyBtn = event.target.closest('[data-action="copy-json"]');
        if (!copyBtn) return;
        event.preventDefault();
        const payload = resolveCopyPayload(copyBtn);
        if (!payload) return;
        try {
            const copied = await copyText(payload);
            if (copied) markCopied(copyBtn);
        } catch (_) {
            // noop
        }
    });
    if (!escapeBound) {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlayEl && !overlayEl.classList.contains('hidden')) {
                closeGenerationJobDetailModal();
            }
        });
        escapeBound = true;
    }
}

function renderGenerationJobDetail(data = {}) {
    const job = data.job || {};
    const events = Array.isArray(data.events) ? data.events : [];
    currentDetail = { job, events };
    const cardTypeLabel = String(job.jobType || '').toLowerCase() === 'grammar_ja' ? '语法卡' : '三语卡';
    const statusText = String(job.status || '-').toUpperCase();
    const errorHtml = job.errorMessage
        ? `
            <div class="queue-job-modal-error" data-testid="queue-job-detail-error">
                <div class="queue-job-modal-section-head">
                    <div class="queue-job-modal-error-title">错误详情</div>
                    <div class="queue-job-modal-section-actions">
                        ${renderCopyButton('copy-json', 'error', '复制错误', 'queue-job-copy-error')}
                    </div>
                </div>
                <div class="queue-job-modal-error-text">${escapeHtml(job.errorMessage)}</div>
            </div>
        `
        : '';

    const metaHtml = `
        <div class="queue-job-modal-meta-grid">
            ${renderMetaItem('Job ID', `#${Number(job.id || 0)}`)}
            ${renderMetaItem('状态', statusText)}
            ${renderMetaItem('卡片类型', cardTypeLabel)}
            ${renderMetaItem('来源', job.sourceMode || '-')}
            ${renderMetaItem('Provider', job.provider || '-')}
            ${renderMetaItem('Model', job.llmModel || '-')}
            ${renderMetaItem('尝试次数', `${Number(job.attempts || 0)} / ${Number(job.maxRetries || 0)}`)}
            ${renderMetaItem('目标目录', job.targetFolder || '-')}
            ${renderMetaItem('结果目录', job.resultFolder || '-')}
            ${renderMetaItem('结果文件', job.resultBaseFilename || '-')}
            ${renderMetaItem('生成记录', job.resultGenerationId ? `#${job.resultGenerationId}` : '-')}
            ${renderMetaItem('创建时间', formatQueueDate(job.createdAt))}
            ${renderMetaItem('开始时间', formatQueueDate(job.startedAt))}
            ${renderMetaItem('结束时间', formatQueueDate(job.finishedAt))}
        </div>
    `;

    const requestPayloadHtml = `<pre class="queue-job-modal-pre">${escapeHtml(stringifyJson(job.requestPayload || {}))}</pre>`;
    const sourceContextHtml = `<pre class="queue-job-modal-pre">${escapeHtml(stringifyJson(job.sourceContext || {}))}</pre>`;
    const resultSummaryHtml = `<pre class="queue-job-modal-pre">${escapeHtml(stringifyJson(job.resultSummary || {}))}</pre>`;
    const eventsHtml = events.length
        ? `
            <div class="queue-job-modal-events" data-testid="queue-job-detail-events">
                ${events.map((event) => `
                    <div class="queue-job-modal-event">
                        <div class="queue-job-modal-event-head">
                            <div class="queue-job-modal-event-head-main">
                                <span class="queue-job-modal-event-type">${escapeHtml(getQueueEventLabel(event.eventType))}</span>
                                <span class="queue-job-modal-event-time">${escapeHtml(formatQueueDate(event.createdAt))}</span>
                            </div>
                            ${renderCopyButton('copy-json', `event:${Number(event.id || 0)}`, '复制事件JSON')}
                        </div>
                        <div class="queue-job-modal-event-note">${escapeHtml(buildQueueEventNote(event) || '-')}</div>
                        <pre class="queue-job-modal-pre is-compact">${escapeHtml(stringifyJson(event.payload || {}))}</pre>
                    </div>
                `).join('')}
            </div>
        `
        : '<div class="queue-job-modal-empty">暂无审计事件</div>';

    bodyEl.innerHTML = `
        <div class="queue-job-modal-headerline">
            <div class="queue-job-modal-jobline">#${Number(job.id || 0)} · ${escapeHtml(job.phraseNormalized || job.phraseRaw || '-')}</div>
            <div class="queue-job-modal-status status-${escapeHtml(String(job.status || 'queued'))}">${escapeHtml(statusText)}</div>
        </div>
        ${errorHtml}
        ${renderSection('任务元信息', metaHtml, 'queue-job-detail-meta')}
        ${renderSection('请求 Payload', requestPayloadHtml, 'queue-job-detail-request', renderCopyButton('copy-json', 'request', '复制 Payload', 'queue-job-copy-request'))}
        ${renderSection('Source Context', sourceContextHtml, 'queue-job-detail-source-context', renderCopyButton('copy-json', 'sourceContext', '复制 Context', 'queue-job-copy-source-context'))}
        ${renderSection('结果摘要', resultSummaryHtml, 'queue-job-detail-result', renderCopyButton('copy-json', 'result', '复制结果', 'queue-job-copy-result'))}
        ${renderSection('审计事件', eventsHtml, 'queue-job-detail-event-section', renderCopyButton('copy-json', 'events', '复制全部事件', 'queue-job-copy-events'))}
    `;
}

export async function openGenerationJobDetailModal({ api, jobId, eventLimit = 80 } = {}) {
    const numericJobId = Number(jobId || 0);
    if (!api || !numericJobId) return;
    ensureModal();
    bodyEl.innerHTML = '<div class="queue-job-modal-loading">加载任务详情中...</div>';
    overlayEl.classList.remove('hidden');

    try {
        const detail = await api.getGenerationJob(numericJobId, { includeEvents: true, eventLimit });
        renderGenerationJobDetail(detail || {});
    } catch (err) {
        bodyEl.innerHTML = `
            <div class="queue-job-modal-error" data-testid="queue-job-detail-error">
                <div class="queue-job-modal-error-title">任务详情加载失败</div>
                <div class="queue-job-modal-error-text">${escapeHtml(String(err?.message || 'unknown error'))}</div>
            </div>
        `;
    }
}

export function closeGenerationJobDetailModal() {
    if (!overlayEl) return;
    overlayEl.classList.add('hidden');
}
