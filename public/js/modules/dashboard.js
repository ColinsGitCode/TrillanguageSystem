/**
 * Mission Control Dashboard Logic (Enhanced)
 * Theme: Sci-Fi / Observability
 * Version: 2.0 with Full Analytics
 */
import { formatTime, formatDate } from './utils.js';

// D3 is loaded globally via script tag

let currentTrendPeriod = '30d';
let latestPhraseForFeed = null;

// 中文指标说明映射
const METRIC_TOOLTIPS = {
    quota: 'API 配额使用情况 - 每月限额 100 万 tokens',
    storage: '本地存储数据使用量 - 包含所有生成的文件',
    quality: '生成内容质量评分 - 基于 4 维度综合计算',
    tokens: 'Token 消耗趋势 - 输入+输出 tokens 统计',
    cost: 'API 调用成本趋势 - 按 tokens 计费',
    latency: 'API 响应延迟趋势 - 从请求到响应的时间',
    provider: '服务供应商分布 - Gemini API vs 本地模型',
    errors: '错误发生统计 - 失败率和错误类型分析',
    liveFeed: '实时生成动态 - 显示最近的生成记录',
    infrastructure: '基础设施状态 - Web/TTS 服务健康检查',
    arena: '模型性能对比 - 速度和质量综合评估',
    webService: 'Web 服务状态 - 主应用后端服务',
    ttsEn: '英语 TTS 服务 - Kokoro 语音合成',
    ttsJa: '日语 TTS 服务 - VOICEVOX 语音合成'
};

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

function initDashboard() {
    updateTicker();
    setInterval(updateTicker, 1000);

    // Live polling
    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 10000);

    // Load Analytics with real statistics
    loadGenerationData();
    loadRealStatistics();

    setupInteractions();
}

function updateTicker() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false });
    const el = document.getElementById('lastUpdatedTime');
    if (el) el.textContent = `T-SYNC ${timeStr}`;
}

// --- Layer 1: Infrastructure ---

async function fetchInfrastructureStatus() {
    try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error('Health check failed');
        const data = await res.json();

        renderServiceMatrix(data);
        renderStorage(data.storage);

        document.querySelector('.status-dot').style.backgroundColor = 'var(--neon-green)';
        document.querySelector('.status-dot').style.boxShadow = '0 0 8px var(--neon-green)';
        document.getElementById('systemStatusText').textContent = 'SYSTEM ONLINE';
        document.getElementById('systemStatusText').style.color = 'var(--neon-green)';

    } catch (err) {
        console.error('Infra fetch error:', err);
        document.querySelector('.status-dot').style.backgroundColor = 'var(--neon-red)';
        document.querySelector('.status-dot').style.boxShadow = '0 0 8px var(--neon-red)';
        document.getElementById('systemStatusText').textContent = 'SYSTEM ALERT';
        document.getElementById('systemStatusText').style.color = 'var(--neon-red)';
    }
}

function renderServiceMatrix(healthData) {
    const container = document.getElementById('serviceMatrix');
    container.innerHTML = '';

    const renderRow = (label, status, meta) => {
        const color = status === 'healthy' ? 'var(--neon-green)' : 'var(--neon-red)';
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.justifyContent = 'space-between';
        el.style.alignItems = 'center';
        el.style.fontFamily = 'JetBrains Mono';
        el.style.fontSize = '12px';
        el.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        el.style.paddingBottom = '4px';

        el.innerHTML = `
            <span style="color: var(--sci-text-muted);">${label}</span>
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="color: var(--sci-text-main);">${meta || ''}</span>
                <div style="width:6px; height:6px; border-radius:50%; background:${color}; box-shadow: 0 0 5px ${color};"></div>
            </div>
        `;
        container.appendChild(el);
    };

    renderRow('LLM CORE', healthData.llm?.status, healthData.llm?.model);
    renderRow('TTS ENGINE (EN)', healthData.tts_en?.status, 'Kokoro');
    renderRow('TTS ENGINE (JA)', healthData.tts_ja?.status, 'VoiceVox');
}

function renderStorage(storage) {
    if (!storage) return;

    const gbUsed = (storage.used / (1024 * 1024 * 1024)).toFixed(2);
    document.getElementById('storageUsed').textContent = gbUsed;

    const percent = Math.min(storage.percentage * 100, 100);
    const bar = document.getElementById('storageBar');
    bar.style.width = `${percent}%`;

    const color = percent > 90 ? 'var(--neon-red)' : percent > 70 ? 'var(--neon-amber)' : 'var(--neon-purple)';
    bar.style.backgroundColor = color;
    bar.style.boxShadow = `0 0 10px ${color}`;

    document.getElementById('storageMeta').textContent = `${storage.records || 0} RECORDS`;
}

// Use REAL quota data from statistics
function renderQuotaGauge(quota) {
    const container = document.getElementById('quotaChart');
    container.innerHTML = '';
    const width = 120, height = 80;
    const radius = 50;

    const svg = d3.select(container).append("svg")
        .attr("width", width).attr("height", height)
        .append("g").attr("transform", `translate(${width/2},${height - 10})`);

    const arc = d3.arc().innerRadius(radius - 8).outerRadius(radius).startAngle(-Math.PI/2);

    svg.append("path")
       .datum({endAngle: Math.PI/2})
       .attr("d", arc)
       .attr("fill", "rgba(255,255,255,0.1)");

    const percentage = Math.min(quota.percentage || 0, 100);
    const valAngle = -Math.PI/2 + (Math.PI * (percentage / 100));

    const color = percentage > 90 ? 'var(--neon-red)' : percentage > 70 ? 'var(--neon-amber)' : 'var(--neon-blue)';

    svg.append("path")
       .datum({endAngle: valAngle})
       .attr("d", arc)
       .attr("fill", color)
       .style("filter", `drop-shadow(0 0 4px ${color})`);

    document.getElementById('quotaPercent').textContent = `${Math.round(percentage)}%`;

    // Quota warning
    if (percentage > 80) {
        const warning = document.createElement('div');
        warning.style.cssText = 'font-size:10px; color:var(--neon-amber); margin-top:4px; text-align:center;';
        warning.textContent = `⚠ ${quota.estimatedDaysRemaining || 0}d remaining`;
        container.appendChild(warning);
    }
}

// --- Layer 2: Model Arena ---

function loadGenerationData() {
    const raw = localStorage.getItem('latest_observability');
    if (!raw) return;

    try {
        const data = JSON.parse(raw);
        let localData = data;
        let geminiData = null;

        if (data.comparison) {
            localData = data.local?.observability;
            geminiData = data.gemini?.observability;
            document.getElementById('arenaRecommendation').textContent =
                `>> WINNER: ${data.comparison.winner.toUpperCase()} // ${data.comparison.recommendation}`;
        } else {
            document.getElementById('arenaRecommendation').textContent = ">> SINGLE MODE // LOCAL LLM ACTIVE";
        }

        if (localData) {
            updateArenaStats('local', localData);
            // Enhanced live feed
            const phrase = localStorage.getItem('latest_phrase') || 'unknown';
            logLiveFeed(localData, 'LOCAL', phrase, 'success');
        }

        if (geminiData) {
            updateArenaStats('gemini', geminiData);
        } else {
            updateArenaStats('gemini', null);
        }

    } catch (e) {
        console.error('Error parsing local observability data', e);
    }
}

function updateArenaStats(side, obs) {
    const speedEl = document.getElementById(`${side}SpeedVal`);
    const qualEl = document.getElementById(`${side}QualityVal`);

    if (!obs) {
        speedEl.textContent = 'OFFLINE';
        speedEl.style.color = 'var(--sci-text-muted)';
        qualEl.textContent = '-';
        return;
    }

    speedEl.textContent = `${obs.performance?.totalTime || 0}ms`;
    speedEl.style.color = 'var(--sci-text-main)';

    const score = obs.quality?.score || 0;
    qualEl.textContent = score;
    qualEl.style.color = score >= 80 ? 'var(--neon-green)' : score >= 60 ? 'var(--neon-amber)' : 'var(--neon-red)';
    qualEl.style.textShadow = `0 0 10px ${qualEl.style.color}`;
}

// Enhanced Live Feed
function logLiveFeed(obs, provider, phrase, status = 'success') {
    const feed = document.getElementById('liveFeed');
    const row = document.createElement('div');
    row.className = 'feed-row';

    const color = provider === 'GEMINI' ? 'var(--neon-blue)' : 'var(--neon-purple)';
    const statusColor = status === 'success' ? 'var(--neon-green)' : 'var(--neon-red)';
    const statusIcon = status === 'success' ? '✓' : '✗';

    row.style.cssText = `
        border-left: 2px solid ${color};
        padding-left: 8px;
        margin-bottom: 4px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.2s;
    `;
    row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.05)';
    row.onmouseleave = () => row.style.background = 'transparent';

    const time = new Date().toLocaleTimeString();
    const score = obs?.quality?.score || 0;
    const tokens = obs?.tokens?.total || 0;
    const cost = obs?.cost?.total || 0;
    const phraseShort = phrase.substring(0, 20) + (phrase.length > 20 ? '...' : '');

    row.innerHTML = `
        <span style="color:var(--sci-text-muted)">[${time}]</span>
        <span style="color:${statusColor}">${statusIcon}</span>
        <span style="color:#fff">${phraseShort}</span>
        <span style="color:${color}">${provider}</span>
        ${status === 'success' ? `
            <span style="color:var(--neon-green)">Q:${score}</span>
            <span style="color:var(--sci-text-muted)">T:${tokens}</span>
            <span style="color:var(--neon-amber)">$${cost.toFixed(5)}</span>
        ` : `
            <span style="color:var(--neon-red)">${obs?.error || 'ERROR'}</span>
        `}
    `;

    feed.prepend(row);
    if (feed.children.length > 12) feed.lastElementChild.remove();
}

// --- Layer 3: Real Statistics with All Trends ---

async function loadRealStatistics() {
    try {
        const dateTo = new Date().toISOString().split('T')[0];
        const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const res = await fetch(`/api/statistics?dateFrom=${dateFrom}&dateTo=${dateTo}`);
        if (!res.ok) throw new Error('Statistics fetch failed');

        const data = await res.json();
        const stats = data.statistics;

        // Render all components with real data
        renderQuotaGauge(stats.quota);
        renderProviderDistribution(stats.providerDistribution);
        renderErrorMonitor(stats.errors);

        // Render all trend charts
        renderQualityTrend(stats.qualityTrend[currentTrendPeriod]);
        renderTokenTrend(stats.tokenTrend[currentTrendPeriod]);
        renderCostTrend(stats.tokenTrend[currentTrendPeriod], stats.totalCost); // Reuse token data
        renderLatencyTrend(stats.latencyTrend[currentTrendPeriod]);

    } catch (err) {
        console.error('Statistics load failed:', err);
    }
}

// Provider Distribution (NEW)
function renderProviderDistribution(distribution) {
    const container = document.getElementById('providerDistribution');
    if (!container) return;

    container.innerHTML = '';
    const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);

    Object.entries(distribution).forEach(([provider, count]) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        const color = provider === 'local' ? 'var(--neon-purple)' : 'var(--neon-blue)';

        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 8px;';
        row.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
                <span style="color:var(--sci-text-main); text-transform:uppercase;">${provider}</span>
                <span style="color:${color};">${percentage.toFixed(1)}%</span>
            </div>
            <div style="height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                <div style="height:100%; width:${percentage}%; background:${color}; box-shadow: 0 0 8px ${color};"></div>
            </div>
        `;
        container.appendChild(row);
    });
}

// Error Monitor (NEW)
function renderErrorMonitor(errors) {
    const container = document.getElementById('errorMonitor');
    if (!container) return;

    container.innerHTML = '';

    const totalClass = errors.rate > 0.05 ? 'error-high' : 'error-normal';
    const statusColor = errors.rate > 0.05 ? 'var(--neon-red)' : 'var(--neon-amber)';

    const summary = document.createElement('div');
    summary.style.cssText = `
        padding: 8px;
        background: rgba(255,255,255,0.05);
        border-left: 3px solid ${statusColor};
        margin-bottom: 8px;
        font-size: 12px;
    `;
    summary.innerHTML = `
        <span style="color:${statusColor}; margin-right:8px;">⚠</span>
        <span style="color:var(--sci-text-main);">Failed: ${errors.total} (${(errors.rate * 100).toFixed(1)}%)</span>
    `;
    container.appendChild(summary);

    if (Object.keys(errors.byType).length > 0) {
        const breakdown = document.createElement('div');
        breakdown.style.cssText = 'font-size:11px; padding-left:8px;';

        Object.entries(errors.byType).forEach(([type, count]) => {
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom:4px; color:var(--sci-text-muted);';
            row.innerHTML = `<span style="color:var(--neon-red);">•</span> ${type.replace('_', ' ')}: ${count}`;
            breakdown.appendChild(row);
        });

        container.appendChild(breakdown);
    }
}

// Quality Trend (Enhanced)
function renderQualityTrend(trendData) {
    const container = document.getElementById('qualityTrendChart');
    if (!container) return;

    container.innerHTML = '';

    if (!trendData || !trendData.length) {
        container.innerHTML = '<div style="text-align:center; padding-top:40px; color:var(--sci-text-muted)">NO SIGNAL</div>';
        return;
    }

    renderTrendChart(container, trendData, {
        valueKey: 'avgScore',
        yDomain: [0, 100],
        color: 'var(--neon-green)',
        gradientId: 'qualityGrad'
    });
}

// Token Trend (NEW)
function renderTokenTrend(trendData) {
    const container = document.getElementById('tokenTrendChart');
    if (!container) return;

    container.innerHTML = '';

    if (!trendData || !trendData.length) {
        container.innerHTML = '<div style="text-align:center; padding-top:40px; color:var(--sci-text-muted)">NO SIGNAL</div>';
        return;
    }

    const maxTokens = d3.max(trendData, d => d.avgTokens) || 2000;

    renderTrendChart(container, trendData, {
        valueKey: 'avgTokens',
        yDomain: [0, maxTokens * 1.2],
        color: 'var(--neon-purple)',
        gradientId: 'tokenGrad'
    });
}

// Cost Trend (NEW) - Cumulative
function renderCostTrend(trendData, totalCost) {
    const container = document.getElementById('costTrendChart');
    if (!container) return;

    container.innerHTML = '';

    if (!trendData || !trendData.length) {
        container.innerHTML = '<div style="text-align:center; padding-top:40px; color:var(--sci-text-muted)">NO SIGNAL</div>';
        return;
    }

    // Calculate cumulative cost
    let cumulative = 0;
    const costData = trendData.map(d => {
        cumulative += (d.avgTokens || 0) * 0.00001; // Rough estimate
        return { date: d.date, cumulative, count: d.count };
    });

    renderTrendChart(container, costData, {
        valueKey: 'cumulative',
        yDomain: [0, d3.max(costData, d => d.cumulative) * 1.2 || 1],
        color: 'var(--neon-amber)',
        gradientId: 'costGrad',
        isCumulative: true
    });
}

// Latency Trend (NEW)
function renderLatencyTrend(trendData) {
    const container = document.getElementById('latencyTrendChart');
    if (!container) return;

    container.innerHTML = '';

    if (!trendData || !trendData.length) {
        container.innerHTML = '<div style="text-align:center; padding-top:40px; color:var(--sci-text-muted)">NO SIGNAL</div>';
        return;
    }

    const maxLatency = d3.max(trendData, d => d.avgMs) || 3000;

    renderTrendChart(container, trendData, {
        valueKey: 'avgMs',
        yDomain: [0, maxLatency * 1.2],
        color: 'var(--neon-blue)',
        gradientId: 'latencyGrad'
    });
}

// Generic Trend Chart Renderer
function renderTrendChart(container, data, options) {
    const { valueKey, yDomain, color, gradientId, isCumulative = false } = options;

    const width = container.clientWidth;
    const height = 200;
    const margin = {top: 10, right: 10, bottom: 20, left: 40};

    const processedData = data.map(d => ({
        date: new Date(d.date),
        val: d[valueKey] || 0,
        count: d.count || 0
    })).sort((a,b) => a.date - b.date);

    const svg = d3.select(container).append("svg")
        .attr("width", width).attr("height", height);

    const x = d3.scaleTime()
        .domain(d3.extent(processedData, d => d.date))
        .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
        .domain(yDomain)
        .range([height - margin.bottom, margin.top]);

    // Gradient
    const defs = svg.append("defs");
    const grad = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", color).attr("stop-opacity", 0.4);
    grad.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", 0);

    // Area
    svg.append("path")
       .datum(processedData)
       .attr("fill", `url(#${gradientId})`)
       .attr("d", d3.area()
           .x(d => x(d.date))
           .y0(height - margin.bottom)
           .y1(d => y(d.val))
           .curve(d3.curveMonotoneX));

    // Line
    svg.append("path")
       .datum(processedData)
       .attr("fill", "none")
       .attr("stroke", color)
       .attr("stroke-width", 2)
       .style("filter", `drop-shadow(0 0 4px ${color})`)
       .attr("d", d3.line()
           .x(d => x(d.date))
           .y(d => y(d.val))
           .curve(d3.curveMonotoneX));

    // Axes
    svg.append("g")
       .attr("transform", `translate(0,${height - margin.bottom})`)
       .call(d3.axisBottom(x).ticks(5).tickSize(0))
       .select(".domain").remove();

    svg.append("g")
       .attr("transform", `translate(${margin.left},0)`)
       .call(d3.axisLeft(y).ticks(4).tickSize(0))
       .select(".domain").remove();

    svg.selectAll("text")
       .attr("fill", "var(--sci-text-muted)")
       .style("font-family", "JetBrains Mono")
       .style("font-size", "10px");
}

function setupInteractions() {
    // Period selector buttons (if implemented in HTML)
    const periodBtns = document.querySelectorAll('[data-period]');
    periodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentTrendPeriod = btn.dataset.period;
            periodBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadRealStatistics();
        });
    });
}

// Export for external use (like from app.js when generation completes)
window.dashboardLogFeed = logLiveFeed;
