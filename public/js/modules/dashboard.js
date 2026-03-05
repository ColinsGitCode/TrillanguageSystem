/**
 * Mission Control Dashboard v2
 * 从通用 LLM 监控转型为"评审→注入→效果→调参"业务仪表盘
 */
import { formatDate } from './utils.js';
import { initInfoModal, bindInfoButtons } from './info-modal.js';
import { api } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

const state = {
    days: 30,
    queueTimerId: null,
    knowledgeTimerId: null,
    selectedKnowledgeJobId: null,
    knowledgeJobs: [],
    knowledgeDetailToken: 0
};
const QUEUE_SNAPSHOT_STORAGE_KEY = 'generation_queue_snapshot_v1';
const QUEUE_POLL_INTERVAL_MS = 1500;
const KNOWLEDGE_POLL_INTERVAL_MS = 3000;

function initDashboard() {
    updateTimestamp();
    initInfoModal();
    bindInfoButtons();
    initQueueTelemetry();
    initKnowledgeOps();

    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 30000);

    loadDashboard(state.days);
    setupTimeRangeButtons();
}

function initQueueTelemetry() {
    renderTaskQueueDetails(readQueueSnapshot());

    if (state.queueTimerId) clearInterval(state.queueTimerId);
    state.queueTimerId = setInterval(() => {
        renderTaskQueueDetails(readQueueSnapshot());
    }, QUEUE_POLL_INTERVAL_MS);

    window.addEventListener('storage', (event) => {
        if (event.key !== QUEUE_SNAPSHOT_STORAGE_KEY) return;
        renderTaskQueueDetails(parseQueueSnapshot(event.newValue));
    });
}

function updateTimestamp() {
    const now = new Date();
    const el = document.getElementById('lastUpdatedTime');
    if (el) el.textContent = now.toLocaleTimeString();
}

async function fetchInfrastructureStatus() {
    try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error('Health check failed');
        const data = await res.json();

        const services = data.services || [];
        renderServiceMatrix(services);

        const storageService = services.find(s => s.type === 'storage' || s.name === 'Storage');
        renderStorage(storageService?.details || data.storage);

        updateTimestamp();
        document.querySelector('.status-dot').style.backgroundColor = 'var(--color-success)';
        document.getElementById('systemStatusText').textContent = 'System Operational';
    } catch (err) {
        console.error('Infra fetch error:', err);
        document.querySelector('.status-dot').style.backgroundColor = 'var(--color-error)';
        document.getElementById('systemStatusText').textContent = 'System Alert';
        document.querySelector('.status-dot').style.animation = 'none';
    }
}

function renderServiceMatrix(services) {
    const container = document.getElementById('serviceMatrix');
    container.innerHTML = '';

    if (!services.length) {
        container.innerHTML = '<div class="empty-hint">No services</div>';
        return;
    }

    services.forEach(svc => {
        const el = document.createElement('div');
        el.className = 'service-item';

        const statusClass = svc.status === 'online' ? 'svc-online' :
            svc.status === 'degraded' ? 'svc-degraded' : 'svc-offline';
        const latency = svc.latency ? `${svc.latency}ms` : '-';

        el.innerHTML = `
            <div class="svc-name">${svc.name}</div>
            <div class="svc-status">
                <div class="svc-dot ${statusClass}"></div>
                <span>${svc.status === 'online' ? latency : 'OFF'}</span>
            </div>
        `;
        container.appendChild(el);
    });
}

function renderStorage(storage) {
    if (!storage) return;

    const gbUsed = (storage.used / (1024 * 1024 * 1024)).toFixed(2);
    document.getElementById('storageUsed').textContent = gbUsed;

    const percent = Math.min(storage.percentage || 0, 100);
    const bar = document.getElementById('storageBar');
    bar.style.width = `${percent}%`;

    if (percent > 90) bar.style.backgroundColor = 'var(--color-warning)';

    document.getElementById('storageMeta').textContent = `${storage.recordsCount || 0} files total`;
}

function setupTimeRangeButtons() {
    const buttons = document.querySelectorAll('.time-btn');
    buttons.forEach(btn => {
        btn.onclick = () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const days = Number(btn.dataset.days || 30);
            state.days = days;
            loadDashboard(days);
        };
    });
}

async function loadDashboard(days) {
    const { dateFrom, dateTo } = getDateRange(days);

    try {
        const [historyRes, statsRes, reviewRes, fewshotRes] = await Promise.all([
            fetchHistory({ limit: 200, dateFrom, dateTo }),
            fetchStatistics({ dateFrom, dateTo }),
            fetchReviewStats(),
            fetchFewshotStats(),
        ]);

        const records = historyRes.records || [];
        const stats = statsRes.statistics || null;

        renderProviderPie(stats?.providerDistribution, records);
        renderTokenTrend(stats?.tokenTrend, records, days);
        renderLatencyTrend(stats?.latencyTrend, records, days);
        renderQualityMini(stats?.qualityTrend, records, days);
        renderErrorMonitor(stats?.errors);
        renderRecent(records);

        renderReviewPipeline(reviewRes);
        renderFewshotEffect(fewshotRes);

        bindInfoButtons();
    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

async function fetchHistory({ limit = 200, dateFrom, dateTo } = {}) {
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', String(limit));
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await fetch(`/api/history?${params.toString()}`);
    if (!res.ok) throw new Error('History fetch failed');
    return res.json();
}

async function fetchStatistics({ dateFrom, dateTo } = {}) {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const res = await fetch(`/api/statistics?${params.toString()}`);
    if (!res.ok) throw new Error('Statistics fetch failed');
    return res.json();
}

async function fetchReviewStats() {
    try {
        const res = await fetch('/api/dashboard/review-stats');
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

async function fetchFewshotStats() {
    try {
        const res = await fetch('/api/dashboard/fewshot-stats');
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

function getDateRange(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    const dateFrom = start.toISOString().split('T')[0];
    const dateTo = end.toISOString().split('T')[0];
    return { dateFrom, dateTo };
}

function readQueueSnapshot() {
    const raw = localStorage.getItem(QUEUE_SNAPSHOT_STORAGE_KEY);
    return parseQueueSnapshot(raw);
}

function parseQueueSnapshot(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.warn('[Dashboard] invalid queue snapshot:', err.message);
        return null;
    }
}

function renderTaskQueueDetails(snapshot) {
    const container = document.getElementById('taskQueueDetails');
    if (!container) return;

    if (!snapshot || !snapshot.summary) {
        container.innerHTML = '<div class="empty-hint">No queue telemetry</div>';
        return;
    }

    const summary = snapshot.summary || {};
    const total = Number(summary.total || 0);
    const queued = Number(summary.queued || 0);
    const running = Number(summary.running || 0);
    const success = Number(summary.success || 0);
    const failed = Number(summary.failed || 0);
    const cancelled = Number(summary.cancelled || 0);
    const active = snapshot.activeTask || null;
    const recentTasks = Array.isArray(snapshot.recentTasks)
        ? snapshot.recentTasks.slice().reverse()
        : [];
    const cardTypeText = (rawType) => String(rawType || '').toLowerCase() === 'grammar_ja' ? '语法' : '三语';

    const activeText = active
        ? `#${active.seq} · [${cardTypeText(active.cardType)}] ${escapeHtml(active.phrase || '-')}`
        : 'Idle';
    const updatedAtText = snapshot.updatedAt ? formatDate(snapshot.updatedAt) : '-';

    container.innerHTML = `
        <div class="queue-metrics-grid">
            <div class="queue-metric-chip"><span class="k">Total</span><span class="v">${total}</span></div>
            <div class="queue-metric-chip"><span class="k">Queued</span><span class="v">${queued}</span></div>
            <div class="queue-metric-chip"><span class="k">Running</span><span class="v">${running}</span></div>
            <div class="queue-metric-chip"><span class="k">Success</span><span class="v">${success}</span></div>
            <div class="queue-metric-chip"><span class="k">Failed</span><span class="v">${failed}</span></div>
            <div class="queue-metric-chip"><span class="k">Cancelled</span><span class="v">${cancelled}</span></div>
        </div>
        <div class="queue-active-line">
            <span class="label">Active Task</span>
            <span class="value">${activeText}</span>
            <span class="stamp">Updated ${updatedAtText}</span>
        </div>
        <div class="queue-recent-list">
            ${recentTasks.length ? recentTasks.map((task) => `
                <div class="queue-recent-item status-${escapeHtml(task.status || 'queued')}">
                    <div class="queue-recent-head">
                        <span class="qid">#${Number(task.seq || 0)}</span>
                        <span class="qstatus">${escapeHtml(String(task.status || 'queued').toUpperCase())}</span>
                        <span class="qtype">${cardTypeText(task.cardType)}</span>
                        <span class="qattempt">try ${Number(task.attempts || 0)}</span>
                        <span class="qtime">${formatQueueTime(task.finishedAt || task.createdAt)}</span>
                    </div>
                    <div class="qphrase">${escapeHtml(task.phrase || '-')}</div>
                </div>
            `).join('') : '<div class="empty-hint">No queue task records</div>'}
        </div>
    `;
}

function formatQueueTime(value) {
    const ts = Number(value || 0);
    if (!Number.isFinite(ts) || ts <= 0) return '-';
    const delta = Date.now() - ts;
    if (delta < 1000) return 'just now';
    if (delta < 60000) return `${Math.floor(delta / 1000)}s ago`;
    if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
    return `${Math.floor(delta / 86400000)}d ago`;
}

// ========== Knowledge Ops ==========

function initKnowledgeOps() {
    const startBtn = document.getElementById('knowledgeStartBtn');
    const jobsList = document.getElementById('knowledgeJobsList');
    if (!startBtn || !jobsList) return;

    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        setKnowledgeToast('Starting knowledge job...', '');
        try {
            const payload = collectKnowledgeJobPayload();
            const data = await api.startKnowledgeJob(payload);
            const job = data?.job || null;
            if (job?.id) state.selectedKnowledgeJobId = Number(job.id);
            setKnowledgeToast(`Job #${job?.id || '-'} queued`, 'success');
            await refreshKnowledgeOps();
        } catch (err) {
            setKnowledgeToast(`Failed to start job: ${err.message}`, 'error');
        } finally {
            startBtn.disabled = false;
        }
    });

    jobsList.addEventListener('click', async (event) => {
        const cancelBtn = event.target.closest('.ko-cancel-btn');
        if (cancelBtn) {
            event.stopPropagation();
            const jobId = Number(cancelBtn.dataset.jobId || 0);
            if (!jobId) return;
            cancelBtn.disabled = true;
            try {
                await api.cancelKnowledgeJob(jobId);
                setKnowledgeToast(`Job #${jobId} cancelled`, 'success');
                await refreshKnowledgeOps();
            } catch (err) {
                setKnowledgeToast(`Cancel failed: ${err.message}`, 'error');
                cancelBtn.disabled = false;
            }
            return;
        }

        const item = event.target.closest('.knowledge-job-item');
        if (!item) return;
        const jobId = Number(item.dataset.jobId || 0);
        if (!jobId) return;
        state.selectedKnowledgeJobId = jobId;
        renderKnowledgeJobs(state.knowledgeJobs || []);
        await renderSelectedKnowledgeJobDetail(state.knowledgeJobs || []);
    });

    refreshKnowledgeOps();
    if (state.knowledgeTimerId) clearInterval(state.knowledgeTimerId);
    state.knowledgeTimerId = setInterval(refreshKnowledgeOps, KNOWLEDGE_POLL_INTERVAL_MS);
}

function collectKnowledgeJobPayload() {
    const jobType = document.getElementById('knowledgeJobType')?.value || 'summary';
    const folderFrom = String(document.getElementById('knowledgeScopeFrom')?.value || '').trim();
    const folderTo = String(document.getElementById('knowledgeScopeTo')?.value || '').trim();
    const limitRaw = Number(document.getElementById('knowledgeScopeLimit')?.value || 0);
    const cardType = document.getElementById('knowledgeCardType')?.value || 'all';
    const batchSizeRaw = Number(document.getElementById('knowledgeBatchSize')?.value || 50);

    const scope = {};
    if (folderFrom) scope.folderFrom = folderFrom;
    if (folderTo) scope.folderTo = folderTo;
    if (Number.isFinite(limitRaw) && limitRaw > 0) scope.limit = limitRaw;
    if (cardType && cardType !== 'all') scope.cardTypes = [cardType];

    return {
        jobType,
        scope,
        batchSize: Math.max(1, batchSizeRaw || 50),
        triggeredBy: 'dashboard'
    };
}

async function refreshKnowledgeOps() {
    const token = ++state.knowledgeDetailToken;
    try {
        const [jobsRes, summaryRes] = await Promise.all([
            api.getKnowledgeJobs(20),
            api.getKnowledgeSummaryLatest()
        ]);
        const jobs = Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : [];
        state.knowledgeJobs = jobs;

        if (!state.selectedKnowledgeJobId && jobs.length) {
            state.selectedKnowledgeJobId = Number(jobs[0].id);
        } else if (state.selectedKnowledgeJobId && !jobs.some((job) => Number(job.id) === Number(state.selectedKnowledgeJobId))) {
            state.selectedKnowledgeJobId = jobs.length ? Number(jobs[0].id) : null;
        }

        renderKnowledgeJobs(jobs);
        renderKnowledgeSummary(summaryRes?.summary || null);
        await renderSelectedKnowledgeJobDetail(jobs, token);
    } catch (err) {
        setKnowledgeToast(`Knowledge ops refresh failed: ${err.message}`, 'error');
    }
}

function renderKnowledgeJobs(jobs) {
    const container = document.getElementById('knowledgeJobsList');
    if (!container) return;

    if (!Array.isArray(jobs) || jobs.length === 0) {
        container.innerHTML = '<div class="empty-hint">No jobs</div>';
        return;
    }

    container.innerHTML = jobs.map((job) => {
        const jobId = Number(job.id || 0);
        const selectedClass = Number(state.selectedKnowledgeJobId) === jobId ? 'selected' : '';
        const status = String(job.status || 'queued').toLowerCase();
        const progress = formatJobProgress(job);
        const startedAt = job.startedAt ? formatDate(job.startedAt) : '-';
        const createdAt = job.createdAt ? formatDate(job.createdAt) : '-';
        const cancellable = status === 'queued' || status === 'running';
        return `
            <div class="knowledge-job-item status-${escapeHtml(status)} ${selectedClass}" data-job-id="${jobId}">
                <div class="knowledge-job-head">
                    <span>#${jobId}</span>
                    <span class="badge">${escapeHtml(job.jobType || '-')}</span>
                    <span>${escapeHtml(status.toUpperCase())}</span>
                    ${cancellable ? `<button class="ko-cancel-btn" data-job-id="${jobId}">Cancel</button>` : ''}
                </div>
                <div class="knowledge-job-meta">
                    <span>${progress.text}</span>
                    <span>${startedAt !== '-' ? `Start ${startedAt}` : `Create ${createdAt}`}</span>
                </div>
                <div class="knowledge-job-progress"><span style="width:${progress.percent}%;"></span></div>
            </div>
        `;
    }).join('');
}

async function renderSelectedKnowledgeJobDetail(jobs, token = state.knowledgeDetailToken) {
    const container = document.getElementById('knowledgeJobDetail');
    if (!container) return;

    const selected = (Array.isArray(jobs) ? jobs : []).find((job) => Number(job.id) === Number(state.selectedKnowledgeJobId));
    if (!selected) {
        container.innerHTML = '<div class="empty-hint">Select a job</div>';
        return;
    }

    const progress = formatJobProgress(selected);
    const duration = formatDuration(selected.startedAt, selected.finishedAt);
    const summaryKeys = Object.keys(selected.resultSummary || {});

    container.innerHTML = `
        <div class="knowledge-kv">
            <div class="k">Job</div><div class="v">#${Number(selected.id)}</div>
            <div class="k">Type</div><div class="v">${escapeHtml(selected.jobType || '-')}</div>
            <div class="k">Status</div><div class="v">${escapeHtml(String(selected.status || '-').toUpperCase())}</div>
            <div class="k">Progress</div><div class="v">${progress.text}</div>
            <div class="k">Duration</div><div class="v">${duration}</div>
            <div class="k">Triggered By</div><div class="v">${escapeHtml(selected.triggeredBy || '-')}</div>
            <div class="k">Summary Keys</div><div class="v">${summaryKeys.length ? escapeHtml(summaryKeys.join(', ')) : '-'}</div>
        </div>
        <div id="knowledgePreviewBlock" class="knowledge-preview-block">
            <div class="empty-hint">Loading preview...</div>
        </div>
    `;

    const previewHtml = await loadKnowledgePreview(selected);
    if (token !== state.knowledgeDetailToken) return;
    const previewNode = document.getElementById('knowledgePreviewBlock');
    if (previewNode) previewNode.innerHTML = previewHtml;
}

function renderKnowledgeSummary(summary) {
    const container = document.getElementById('knowledgeSummaryBrief');
    if (!container) return;

    if (!summary) {
        container.innerHTML = '<div class="empty-hint">No summary yet</div>';
        return;
    }

    const topTopics = Array.isArray(summary.topTopics) ? summary.topTopics.slice(0, 4) : [];
    const actionItems = Array.isArray(summary.actionItems) ? summary.actionItems.slice(0, 3) : [];
    const observations = Array.isArray(summary.qualityObservations) ? summary.qualityObservations.slice(0, 3) : [];

    container.innerHTML = `
        <div style="margin-bottom:8px;">${escapeHtml(summary.overview || '-')}</div>
        <div class="knowledge-inline-tags">
            ${topTopics.length
                ? topTopics.map((item) => `<span class="tag">${escapeHtml(item.topic)} · ${Number(item.count || 0)}</span>`).join('')
                : '<span class="tag">No topics</span>'}
        </div>
        <ul class="knowledge-preview-list">
            ${observations.map((item) => `
                <li>
                    <strong>${escapeHtml(String(item.severity || 'info').toUpperCase())}</strong>
                    · ${escapeHtml(item.finding || '-')}
                </li>
            `).join('')}
            ${actionItems.map((item) => `
                <li>Action P${Number(item.priority || 0)} · ${escapeHtml(item.action || '-')}</li>
            `).join('')}
        </ul>
    `;
}

async function loadKnowledgePreview(job) {
    const status = String(job?.status || '').toLowerCase();
    if (!['success', 'partial'].includes(status)) {
        if (status === 'failed') {
            return `<div class="empty-hint">Job failed: ${escapeHtml(job.errorMessage || 'unknown error')}</div>`;
        }
        return `<div class="empty-hint">Preview available after job success</div>`;
    }

    const jobType = String(job.jobType || '').toLowerCase();
    try {
        if (jobType === 'summary') {
            const data = await api.getKnowledgeSummaryLatest();
            const summary = data?.summary || null;
            if (!summary) return '<div class="empty-hint">No summary output</div>';
            const observations = Array.isArray(summary.qualityObservations) ? summary.qualityObservations.slice(0, 4) : [];
            return `
                <ul class="knowledge-preview-list">
                    ${observations.map((item) => `<li>${escapeHtml(item.finding || '-')}</li>`).join('')}
                </ul>
            `;
        }
        if (jobType === 'index') {
            const data = await api.getKnowledgeIndex({ limit: 8 });
            const entries = Array.isArray(data?.entries) ? data.entries : [];
            if (!entries.length) return '<div class="empty-hint">No index entries</div>';
            return `
                <ul class="knowledge-preview-list">
                    ${entries.map((item) => `
                        <li>
                            <strong>${escapeHtml(item.phrase || '-')}</strong>
                            · ${escapeHtml(item.cardType || '-')}
                            · score ${formatNumber(item.score, 0)}
                        </li>
                    `).join('')}
                </ul>
            `;
        }
        if (jobType === 'issues_audit') {
            const data = await api.getKnowledgeIssues({ limit: 12 });
            const issues = Array.isArray(data?.issues) ? data.issues : [];
            if (!issues.length) return '<div class="empty-hint">No issues</div>';
            const byType = {};
            issues.forEach((item) => {
                const type = String(item.issueType || 'unknown');
                byType[type] = (byType[type] || 0) + 1;
            });
            return `
                <div class="knowledge-inline-tags">
                    ${Object.entries(byType).slice(0, 5).map(([type, count]) => `<span class="tag">${escapeHtml(type)} · ${count}</span>`).join('')}
                </div>
                <ul class="knowledge-preview-list">
                    ${issues.slice(0, 6).map((item) => `
                        <li>
                            [${escapeHtml(item.severity || 'na')}] ${escapeHtml(item.phrase || '-')}
                        </li>
                    `).join('')}
                </ul>
            `;
        }
        if (jobType === 'grammar_link') {
            const data = await api.getKnowledgeGrammar({ limit: 8 });
            const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
            if (!patterns.length) return '<div class="empty-hint">No grammar patterns</div>';
            return `
                <ul class="knowledge-preview-list">
                    ${patterns.map((item) => `
                        <li>
                            <strong>${escapeHtml(item.pattern || '-')}</strong>
                            · refs ${Array.isArray(item.exampleRefs) ? item.exampleRefs.length : 0}
                        </li>
                    `).join('')}
                </ul>
            `;
        }
        if (jobType === 'cluster') {
            const data = await api.getKnowledgeClusters(8);
            const clusters = Array.isArray(data?.clusters) ? data.clusters : [];
            if (!clusters.length) return '<div class="empty-hint">No clusters</div>';
            return `
                <ul class="knowledge-preview-list">
                    ${clusters.map((item) => `
                        <li>
                            <strong>${escapeHtml(item.label || item.clusterKey || '-')}</strong>
                            · cards ${Array.isArray(item.cards) ? item.cards.length : 0}
                        </li>
                    `).join('')}
                </ul>
            `;
        }
        if (jobType === 'synonym_boundary') {
            const indexData = await api.getKnowledgeIndex({ limit: 1 });
            const seed = Array.isArray(indexData?.entries) ? indexData.entries[0] : null;
            if (!seed || !seed.phrase) {
                return '<div class="empty-hint">No synonym seed phrase</div>';
            }
            const synonymData = await api.getKnowledgeSynonyms(seed.phrase, 6);
            const groups = Array.isArray(synonymData?.groups) ? synonymData.groups : [];
            if (!groups.length) return '<div class="empty-hint">No synonym groups</div>';
            return `
                <ul class="knowledge-preview-list">
                    ${groups.map((item) => `
                        <li>
                            <strong>${escapeHtml(item.groupKey || '-')}</strong>
                            · risk ${escapeHtml(item.misuseRisk || '-')}
                            · members ${Array.isArray(item.members) ? item.members.length : 0}
                        </li>
                    `).join('')}
                </ul>
            `;
        }
        return '<div class="empty-hint">No preview renderer for this task</div>';
    } catch (err) {
        return `<div class="empty-hint">Preview load failed: ${escapeHtml(err.message)}</div>`;
    }
}

function formatJobProgress(job) {
    const total = Number(job?.totalBatches || 0);
    const done = Number(job?.doneBatches || 0);
    if (!Number.isFinite(total) || total <= 0) {
        return { percent: 0, text: `${done}/- batches` };
    }
    const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    return { percent, text: `${done}/${total} batches (${percent}%)` };
}

function formatDuration(startedAt, finishedAt) {
    if (!startedAt) return '-';
    const startTs = Date.parse(startedAt);
    if (Number.isNaN(startTs)) return '-';
    const endTs = finishedAt ? Date.parse(finishedAt) : Date.now();
    if (Number.isNaN(endTs) || endTs <= startTs) return '-';
    const delta = endTs - startTs;
    if (delta < 1000) return `${delta}ms`;
    if (delta < 60000) return `${Math.round(delta / 1000)}s`;
    if (delta < 3600000) return `${Math.round(delta / 60000)}m`;
    return `${Math.round(delta / 3600000)}h`;
}

function setKnowledgeToast(message, tone = '') {
    const el = document.getElementById('knowledgeOpsToast');
    if (!el) return;
    el.classList.remove('error', 'success');
    if (tone) el.classList.add(tone);
    el.textContent = message || '';
}

// ========== Review Pipeline ==========

function renderReviewPipeline(data) {
    const container = document.getElementById('reviewPipeline');
    if (!container) return;
    container.innerHTML = '';

    if (!data || !data.eligibility) {
        container.innerHTML = '<div class="empty-hint">No review data</div>';
        return;
    }

    const eligMap = {};
    (data.eligibility || []).forEach(r => { eligMap[r.eligibility] = r.count; });
    const approved = eligMap.approved || 0;
    const pending = eligMap.pending || 0;
    const rejected = eligMap.rejected || 0;
    const total = approved + pending + rejected;

    // Build grid
    const grid = document.createElement('div');
    grid.className = 'rp-grid';

    // Left column: eligibility bar + stats
    const left = document.createElement('div');

    // Eligibility bar
    if (total > 0) {
        const bar = document.createElement('div');
        bar.className = 'eligibility-bar';
        bar.innerHTML = `
            <div class="seg-approved" style="width:${(approved / total * 100).toFixed(1)}%"></div>
            <div class="seg-pending" style="width:${(pending / total * 100).toFixed(1)}%"></div>
            <div class="seg-rejected" style="width:${(rejected / total * 100).toFixed(1)}%"></div>
        `;
        left.appendChild(bar);
    }

    // Legend
    const legend = document.createElement('div');
    legend.className = 'eligibility-legend';
    legend.innerHTML = `
        <div class="legend-item"><span class="dot dot-approved"></span> Approved ${approved}</div>
        <div class="legend-item"><span class="dot dot-pending"></span> Pending ${pending}</div>
        <div class="legend-item"><span class="dot dot-rejected"></span> Rejected ${rejected}</div>
    `;
    left.appendChild(legend);

    // By-language stats
    const langMap = {};
    (data.byLang || []).forEach(r => {
        if (!langMap[r.lang]) langMap[r.lang] = {};
        langMap[r.lang][r.eligibility] = r.count;
    });
    const stats = document.createElement('div');
    stats.className = 'eligibility-stats';
    ['en', 'ja'].forEach(lang => {
        const approvedCount = langMap[lang]?.approved || 0;
        const totalCount = Object.values(langMap[lang] || {}).reduce((a, b) => a + b, 0);
        stats.innerHTML += `
            <div class="stat-item">
                <div class="stat-value">${approvedCount}</div>
                <div class="stat-label">${lang.toUpperCase()} Approved / ${totalCount}</div>
            </div>
        `;
    });
    left.appendChild(stats);

    // Right column: campaign progress + activity chart
    const right = document.createElement('div');

    // Campaign progress
    if (data.campaign) {
        const cp = data.campaign;
        const cpDiv = document.createElement('div');
        cpDiv.className = 'campaign-progress';
        cpDiv.innerHTML = `
            <div class="cp-header">
                <span style="font-weight:600;">${escapeHtml(cp.name || 'Active Campaign')}</span>
                <span>${cp.completion_rate || 0}%</span>
            </div>
            <div class="cp-bar">
                <div class="cp-fill" style="width:${cp.completion_rate || 0}%"></div>
            </div>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:6px;">
                ${cp.reviewed_examples || 0} / ${cp.total_examples || 0} reviewed
                &middot; ${cp.approved_examples || 0} approved
            </div>
        `;
        right.appendChild(cpDiv);
    } else {
        const noCP = document.createElement('div');
        noCP.style.cssText = 'font-size:0.8rem; color:var(--text-secondary); padding:12px; background:#f9fafb; border-radius:8px; text-align:center;';
        noCP.textContent = 'No active campaign';
        right.appendChild(noCP);
    }

    // Review activity chart
    const activity = data.recentActivity || [];
    if (activity.length > 0) {
        const chartDiv = document.createElement('div');
        chartDiv.id = 'reviewActivityChart';
        chartDiv.style.cssText = 'width:100%; height:100px; margin-top:12px;';
        right.appendChild(chartDiv);

        grid.appendChild(left);
        grid.appendChild(right);
        container.appendChild(grid);

        const chartData = activity.map(r => ({
            day: r.day,
            value: r.reviews,
            dateObj: new Date(r.day)
        }));
        renderLineChart('reviewActivityChart', chartData, '#10b981');
    } else {
        grid.appendChild(left);
        grid.appendChild(right);
        container.appendChild(grid);
    }

    // Avg scores
    if (data.avgScores && data.avgScores.totalReviews > 0) {
        const scoresDiv = document.createElement('div');
        scoresDiv.style.cssText = 'display:flex; gap:16px; margin-top:12px; font-size:0.8rem;';
        const s = data.avgScores;
        scoresDiv.innerHTML = `
            <span style="color:var(--text-secondary);">Avg Scores:</span>
            <span>Sentence <strong>${Number(s.avgSentence || 0).toFixed(1)}</strong></span>
            <span>Translation <strong>${Number(s.avgTranslation || 0).toFixed(1)}</strong></span>
            <span>TTS <strong>${Number(s.avgTts || 0).toFixed(1)}</strong></span>
        `;
        container.appendChild(scoresDiv);
    }
}

// ========== Few-shot Effectiveness ==========

function renderFewshotEffect(data) {
    const container = document.getElementById('fewshotEffect');
    if (!container) return;
    container.innerHTML = '';

    if (!data || !data.byVariant || data.byVariant.length === 0) {
        container.innerHTML = '<div class="empty-hint">No few-shot data</div>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'fs-grid';

    // Left: comparison card
    const left = document.createElement('div');
    const variantMap = {};
    data.byVariant.forEach(v => { variantMap[v.variant] = v; });
    const baseline = variantMap.baseline || {};
    const fewshot = variantMap.fewshot || {};

    const compCard = document.createElement('div');
    compCard.className = 'comparison-card';

    function fmtNum(v, digits = 1) {
        if (v === null || v === undefined) return '-';
        return Number(v).toFixed(digits);
    }

    function deltaHtml(base, fs, metric) {
        if (!base || !fs) return '';
        const diff = fs - base;
        const pct = base > 0 ? ((diff / base) * 100).toFixed(1) : '0.0';
        // For tokens and latency, lower is better (negative delta is good)
        const lowerIsBetter = metric === 'tokens' || metric === 'latency';
        let cls = 'delta-neutral';
        if (diff > 0) cls = lowerIsBetter ? 'delta-negative' : 'delta-positive';
        if (diff < 0) cls = lowerIsBetter ? 'delta-positive' : 'delta-negative';
        const sign = diff > 0 ? '+' : '';
        return `<span class="delta-badge ${cls}">${sign}${pct}%</span>`;
    }

    compCard.innerHTML = `
        <div class="comp-col baseline">
            <h4>Baseline</h4>
            <div class="comp-row"><span class="label">Quality</span><span class="value">${fmtNum(baseline.avgQuality)}</span></div>
            <div class="comp-row"><span class="label">Tokens</span><span class="value">${fmtNum(baseline.avgTokens, 0)}</span></div>
            <div class="comp-row"><span class="label">Latency</span><span class="value">${fmtNum(baseline.avgLatency, 0)}ms</span></div>
            <div class="comp-row"><span class="label">Runs</span><span class="value">${baseline.runs || 0}</span></div>
        </div>
        <div class="comp-col fewshot">
            <h4>Few-shot</h4>
            <div class="comp-row"><span class="label">Quality</span><span class="value">${fmtNum(fewshot.avgQuality)} ${deltaHtml(baseline.avgQuality, fewshot.avgQuality, 'quality')}</span></div>
            <div class="comp-row"><span class="label">Tokens</span><span class="value">${fmtNum(fewshot.avgTokens, 0)} ${deltaHtml(baseline.avgTokens, fewshot.avgTokens, 'tokens')}</span></div>
            <div class="comp-row"><span class="label">Latency</span><span class="value">${fmtNum(fewshot.avgLatency, 0)}ms ${deltaHtml(baseline.avgLatency, fewshot.avgLatency, 'latency')}</span></div>
            <div class="comp-row"><span class="label">Runs</span><span class="value">${fewshot.runs || 0}</span></div>
        </div>
    `;
    left.appendChild(compCard);

    // Right: injection rate + fallback reasons
    const right = document.createElement('div');

    // Injection rate
    const ir = data.injectionRate || {};
    const enabled = Number(ir.enabled || 0);
    const total = Number(ir.total || 0);
    const rate = total > 0 ? ((enabled / total) * 100).toFixed(1) : '0.0';

    const irDiv = document.createElement('div');
    irDiv.className = 'injection-rate';
    irDiv.innerHTML = `
        <div class="rate-value">${rate}%</div>
        <div class="rate-label">Injection Rate (${enabled}/${total})</div>
    `;
    right.appendChild(irDiv);

    // Fallback reasons
    const fallbacks = data.fallbackReasons || [];
    if (fallbacks.length > 0) {
        const fbTitle = document.createElement('div');
        fbTitle.style.cssText = 'font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;';
        fbTitle.textContent = 'Fallback Reasons';
        right.appendChild(fbTitle);

        const ul = document.createElement('ul');
        ul.className = 'fallback-list';
        fallbacks.forEach(fb => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="fb-reason">${escapeHtml(fb.fallback_reason)}</span>
                <span class="fb-count">${fb.count}</span>
            `;
            ul.appendChild(li);
        });
        right.appendChild(ul);
    }

    grid.appendChild(left);
    grid.appendChild(right);
    container.appendChild(grid);
}

// ========== Error Monitor ==========

function renderErrorMonitor(errors) {
    const container = document.getElementById('errorMonitor');
    if (!container) return;
    container.innerHTML = '';

    if (!errors) {
        container.innerHTML = '<div class="empty-hint">No error data</div>';
        return;
    }

    const total = errors.total || 0;
    const rate = errors.rate != null ? Number(errors.rate).toFixed(1) : '0.0';

    const summary = document.createElement('div');
    summary.className = 'error-summary';
    const color = total === 0 ? 'var(--color-success)' : 'var(--color-error)';
    summary.innerHTML = `
        <span class="error-total" style="color:${color};">${total}</span>
        <span class="error-rate">${rate}% error rate</span>
    `;
    container.appendChild(summary);

    const byType = errors.byType || [];
    if (byType.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'error-type-list';
        byType.forEach(e => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="et-type">${escapeHtml(e.error_type || 'unknown')}</span>
                <span class="et-count">${e.count}</span>
            `;
            ul.appendChild(li);
        });
        container.appendChild(ul);
    }
}

// ========== Quality Mini ==========

function renderQualityMini(trend, records, days) {
    const container = document.getElementById('qualityMini');
    if (!container) return;
    container.innerHTML = '';

    const scores = records
        .map(r => Number(r.quality_score))
        .filter(v => !Number.isNaN(v) && v > 0);

    if (scores.length === 0) {
        container.innerHTML = '<div class="empty-hint">No data</div>';
        return;
    }

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const color = avg >= 85 ? 'var(--color-success)' : avg >= 70 ? 'var(--color-warning)' : 'var(--color-error)';

    container.innerHTML = `
        <div class="qm-score" style="color:${color};">${avg.toFixed(1)}</div>
        <div class="qm-label">Avg Score (${days}d)</div>
        <div class="qm-note">Template compliance check, not content quality</div>
    `;
}

// ========== Trend Charts ==========

function renderTokenTrend(trend, records, days) {
    const data = buildTrendSeries(trend, records, days, 'tokens');
    renderLineChart('tokenTrendChart', data, '#3b82f6');
}

function renderLatencyTrend(trend, records, days) {
    const data = buildTrendSeries(trend, records, days, 'latency');
    renderLineChart('latencyTrendChart', data, '#f59e0b');
}

function buildTrendSeries(trend, records, days, type) {
    const key = `${days}d`;
    if (trend && trend[key]) {
        const mapped = trend[key].map(row => {
            const value = type === 'quality' ? row.avgScore :
                type === 'tokens' ? row.avgTokens : row.avgMs;
            return {
                day: row.date,
                value,
                dateObj: new Date(row.date)
            };
        });
        return mapped.sort((a, b) => a.dateObj - b.dateObj);
    }

    const selector = type === 'quality'
        ? r => r.quality_score
        : type === 'tokens'
            ? r => r.tokens_total
            : r => r.performance_total_ms;

    return buildDailySeries(records, selector);
}

function buildDailySeries(records, selector) {
    const map = new Map();
    records.forEach(r => {
        const rawDate = r.created_at || r.generation_date;
        if (!rawDate) return;
        const day = new Date(rawDate).toISOString().split('T')[0];
        const value = Number(selector(r));
        if (Number.isNaN(value)) return;
        if (!map.has(day)) map.set(day, []);
        map.get(day).push(value);
    });

    return Array.from(map.entries())
        .map(([day, values]) => {
            const sumValues = values.reduce((a, b) => a + b, 0);
            const avgValue = sumValues / values.length;
            return { day, value: avgValue, dateObj: new Date(day) };
        })
        .sort((a, b) => a.dateObj - b.dateObj);
}

// ========== Provider Pie ==========

function renderProviderPie(providerDistribution, records) {
    const container = document.getElementById('providerDistribution');
    if (!container) return;

    container.innerHTML = '';

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';

    const chartDiv = document.createElement('div');
    container.appendChild(chartDiv);

    const legendDiv = document.createElement('div');
    legendDiv.className = 'legend-container';
    legendDiv.style.display = 'flex';
    legendDiv.style.gap = '12px';
    legendDiv.style.marginTop = '12px';
    legendDiv.style.fontSize = '12px';
    container.appendChild(legendDiv);

    const data = providerDistribution
        ? Object.entries(providerDistribution).map(([label, value]) => ({ label, value }))
        : aggregateProvider(records);

    if (!data.length) {
        container.innerHTML = '<div class="empty-hint">No data</div>';
        return;
    }

    const width = 200;
    const height = 200;
    const radius = Math.min(width, height) / 2 - 10;

    const svg = d3.select(chartDiv)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);

    const color = d3.scaleOrdinal()
        .domain(data.map(d => d.label))
        .range(['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f97316']);

    const pie = d3.pie().value(d => d.value);
    const arc = d3.arc().innerRadius(radius * 0.6).outerRadius(radius);

    svg.selectAll('path')
        .data(pie(data))
        .enter()
        .append('path')
        .attr('d', arc)
        .attr('fill', d => color(d.data.label))
        .attr('stroke', 'rgba(255,255,255,0.1)')
        .attr('stroke-width', 1);

    data.forEach(item => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '4px';
        row.innerHTML = `
            <span style="width:8px; height:8px; border-radius:50%; background:${color(item.label)}"></span>
            <span style="color:var(--text-secondary);">${item.label}</span>
            <span style="font-weight:600;">${item.value}</span>
        `;
        legendDiv.appendChild(row);
    });
}

// ========== Live Feed ==========

function renderRecent(records) {
    const container = document.getElementById('liveFeed');
    if (!container) return;

    container.innerHTML = '';

    if (!records.length) {
        container.innerHTML = '<div style="color:var(--text-secondary); padding:8px;">No recent records</div>';
        return;
    }

    const top = records.slice(0, 10);
    top.forEach(r => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

        const score = r.quality_score || 0;
        const color = score >= 80 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-error)';

        div.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <span style="color:var(--text-primary); font-weight:600;">${escapeHtml(r.phrase)}</span>
                <span style="font-size:10px; color:var(--text-secondary);">${formatDate(r.created_at)}</span>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <span class="badge" style="font-size:10px;">${escapeHtml(r.llm_provider)}</span>
                <span style="font-family:'JetBrains Mono'; color:${color}; font-size:11px;">${formatNumber(score, 0)}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// ========== Generic Line Chart ==========

function renderLineChart(containerId, data, color) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!data.length) {
        container.innerHTML = '<div class="empty-hint">No data</div>';
        return;
    }

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 180;
    const padding = 28;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.dateObj))
        .range([padding, width - padding]);

    const maxY = d3.max(data, d => d.value) || 1;
    const y = d3.scaleLinear()
        .domain([0, maxY * 1.1])
        .range([height - padding, padding]);

    const line = d3.line()
        .x(d => x(d.dateObj))
        .y(d => y(d.value))
        .curve(d3.curveMonotoneX);

    svg.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('d', line);

    svg.selectAll('circle')
        .data(data)
        .enter()
        .append('circle')
        .attr('cx', d => x(d.dateObj))
        .attr('cy', d => y(d.value))
        .attr('r', 3)
        .attr('fill', color);

    const xAxis = d3.axisBottom(x).ticks(4).tickSizeOuter(0);
    const yAxis = d3.axisLeft(y).ticks(4).tickSizeOuter(0);

    svg.append('g')
        .attr('transform', `translate(0,${height - padding})`)
        .call(xAxis)
        .selectAll('text')
        .style('fill', '#94a3b8')
        .style('font-size', '10px');

    svg.append('g')
        .attr('transform', `translate(${padding},0)`)
        .call(yAxis)
        .selectAll('text')
        .style('fill', '#94a3b8')
        .style('font-size', '10px');

    svg.selectAll('path.domain, line').style('stroke', 'rgba(148,163,184,0.3)');
}

// ========== Utilities ==========

function aggregateProvider(records = []) {
    const map = new Map();
    records.forEach(r => {
        const key = r.llm_provider || 'unknown';
        map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
}

function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return '-';
    return num.toFixed(digits);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '-';
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}
