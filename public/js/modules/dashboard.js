/**
 * Mission Control Dashboard (Overview)
 */
import { formatDate } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

const state = {
    days: 30,
};

function initDashboard() {
    updateTimestamp();
    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 30000);

    loadDashboard(state.days);
    setupTimeRangeButtons();
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

        renderServiceMatrix(data.services || []);
        renderStorage(data.storage);

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

    const percent = Math.min(storage.percentage, 100);
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
        const [historyRes, totalRes, statsRes] = await Promise.all([
            fetchHistory({ limit: 200, dateFrom, dateTo }),
            fetchHistory({ limit: 1 }),
            fetchStatistics({ dateFrom, dateTo }),
        ]);

        const records = historyRes.records || [];
        const totalCount = totalRes.pagination?.total || records.length;
        const stats = statsRes.statistics || [];

        const summary = aggregateStats(stats, records);

        renderOverview({
            totalCount,
            avgQuality: summary.avgQuality,
            avgTokens: summary.avgTokens,
            avgLatency: summary.avgLatency,
            days,
        });

        renderCostSummary({
            totalCost: summary.totalCost,
            avgCost: summary.avgCost,
            currency: summary.currency,
        });

        renderProviderPie(stats, records);

        renderQualityTrend(records, days);
        renderTokenTrend(records, days);
        renderLatencyTrend(records, days);

        renderRecent(records);
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

function getDateRange(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    const dateFrom = start.toISOString().split('T')[0];
    const dateTo = end.toISOString().split('T')[0];
    return { dateFrom, dateTo };
}

function aggregateStats(stats, records) {
    const totals = {
        count: 0,
        totalCost: 0,
        totalTokens: 0,
        totalQuality: 0,
        totalLatency: 0,
    };

    if (stats && stats.length) {
        stats.forEach(s => {
            const count = Number(s.total_count || 0);
            totals.count += count;
            totals.totalCost += Number(s.total_cost || 0);
            totals.totalTokens += Number(s.avg_tokens || 0) * count;
            totals.totalQuality += Number(s.avg_quality || 0) * count;
            totals.totalLatency += Number(s.avg_response_time || 0) * count;
        });
    } else if (records && records.length) {
        records.forEach(r => {
            totals.count += 1;
            totals.totalCost += Number(r.cost_total || 0);
            totals.totalTokens += Number(r.tokens_total || 0);
            totals.totalQuality += Number(r.quality_score || 0);
            totals.totalLatency += Number(r.performance_total_ms || 0);
        });
    }

    const count = totals.count || 1;
    return {
        totalCost: totals.totalCost,
        avgCost: totals.totalCost / count,
        avgTokens: totals.totalTokens / count,
        avgQuality: totals.totalQuality / count,
        avgLatency: totals.totalLatency / count,
        currency: 'USD',
    };
}

function renderOverview({ totalCount, avgQuality, avgTokens, avgLatency, days }) {
    setText('overviewTotal', formatNumber(totalCount));
    setText('overviewAvgQuality', formatNumber(avgQuality, 1));
    setText('overviewAvgTokens', formatNumber(avgTokens, 0));
    setText('overviewAvgLatency', formatNumber(avgLatency, 0));
    setText('overviewRange', days ? `Last ${days} days` : 'All time');
}

function renderCostSummary({ totalCost, avgCost, currency }) {
    setText('costTotal', formatCurrency(totalCost, currency));
    setText('costAvg', formatCurrency(avgCost, currency));
    setText('costCurrency', currency || 'USD');
}

function renderProviderPie(stats, records) {
    const container = document.getElementById('providerPieChart');
    const legend = document.getElementById('providerLegend');
    container.innerHTML = '';
    legend.innerHTML = '';

    const data = stats && stats.length
        ? stats.map(s => ({ label: s.llm_provider || 'unknown', value: Number(s.total_count || 0) }))
        : aggregateProvider(records);

    if (!data.length) {
        container.innerHTML = '<div class="empty-hint">No data</div>';
        return;
    }

    const width = container.clientWidth || 220;
    const height = 220;
    const radius = Math.min(width, height) / 2 - 10;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);

    const color = d3.scaleOrdinal()
        .domain(data.map(d => d.label))
        .range(['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f97316']);

    const pie = d3.pie().value(d => d.value);
    const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

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
        row.className = 'legend-item';
        row.innerHTML = `
            <span class="legend-dot" style="background:${color(item.label)}"></span>
            <span class="legend-label">${item.label}</span>
            <span class="legend-value">${item.value}</span>
        `;
        legend.appendChild(row);
    });
}

function renderQualityTrend(records) {
    const series = buildDailySeries(records, r => r.quality_score, 'avg');
    renderLineChart('qualityTrendChart', series, '#10b981');
}

function renderTokenTrend(records) {
    const series = buildDailySeries(records, r => r.tokens_total, 'avg');
    renderLineChart('tokenTrendChart', series, '#3b82f6');
}

function renderLatencyTrend(records) {
    const series = buildDailySeries(records, r => r.performance_total_ms, 'avg');
    renderLineChart('latencyTrendChart', series, '#f59e0b');
}

function buildDailySeries(records, selector, mode = 'avg') {
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
            const sum = values.reduce((a, b) => a + b, 0);
            const val = mode === 'avg' ? sum / values.length : sum;
            return { day, value: val, dateObj: new Date(day) };
        })
        .sort((a, b) => a.dateObj - b.dateObj);
}

function renderLineChart(containerId, data, color) {
    const container = document.getElementById(containerId);
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

function renderRecent(records) {
    const body = document.getElementById('recentTableBody');
    const countEl = document.getElementById('recentCount');
    body.innerHTML = '';

    if (!records.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-cell">No records</td></tr>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    const top = records.slice(0, 8);
    top.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeCell(r.phrase)}</td>
            <td><span class="pill">${escapeCell(r.llm_provider)}</span></td>
            <td>${formatNumber(r.quality_score, 0)}</td>
            <td>${formatNumber(r.tokens_total, 0)}</td>
            <td>${formatCurrency(r.cost_total, 'USD')}</td>
            <td>${formatDate(r.created_at)}</td>
        `;
        body.appendChild(tr);
    });

    if (countEl) countEl.textContent = `${top.length}`;
}

function aggregateProvider(records = []) {
    const map = new Map();
    records.forEach(r => {
        const key = r.llm_provider || 'unknown';
        map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return '-';
    return num.toFixed(digits);
}

function formatCurrency(value, currency) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return '-';
    return `${num.toFixed(5)} ${currency || 'USD'}`;
}

function escapeCell(value) {
    if (value === null || value === undefined) return '-';
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}
