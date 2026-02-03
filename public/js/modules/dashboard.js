/**
 * Mission Control Dashboard Logic
 */
import { formatTime } from './utils.js';

// D3 is loaded globally via script tag in dashboard.html for now
// In a bundler setup, we would import d3 from 'd3'

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

function initDashboard() {
    updateTimestamp();
    
    // Live polling
    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 30000);

    // Load Data
    loadGenerationData();
    loadHistoricalAnalytics(30);

    setupTabs();
}

function updateTimestamp() {
    const now = new Date();
    const el = document.getElementById('lastUpdatedTime');
    if (el) el.textContent = now.toLocaleTimeString();
}

// --- Layer 1: Infrastructure ---

async function fetchInfrastructureStatus() {
    try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error('Health check failed');
        const data = await res.json();
        
        renderServiceMatrix(data.services);
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

// --- Layer 2: Generation Analytics ---

function loadGenerationData() {
    const raw = localStorage.getItem('latest_observability');
    if (!raw) return;

    try {
        const data = JSON.parse(raw);
        
        if (data.comparison) {
            document.getElementById('card-arena').classList.remove('hidden');
            renderArena(data);
            
            const primary = data.gemini.observability;
            renderTokenEconomics(primary.tokens, primary.cost);
            renderQuota(primary.quota);
            renderPromptInspector(primary.prompt);
            renderLLMOutput(data.gemini.output);
            renderQualityBadge(primary.quality);
            
            if (primary.performance) renderTimelineChart(primary.performance);
            if (primary.quality) renderRadarChart(primary.quality);
        } else {
            document.getElementById('card-arena').classList.add('hidden');
            renderTokenEconomics(data.tokens, data.cost);
            renderQuota(data.quota);
            renderPromptInspector(data.prompt);
            renderLLMOutput(data.llm_output);
            renderQualityBadge(data.quality);
            
            if (data.performance) renderTimelineChart(data.performance);
            if (data.quality) renderRadarChart(data.quality);
        }
    } catch (e) {
        console.error('Error parsing local observability data', e);
    }
}

function renderArena(data) {
    const comp = data.comparison;
    const metrics = comp.metrics;
    const normalizeCost = (v) => (typeof v === 'number' ? v : (v?.total || 0));
    
    const winnerBadge = document.getElementById('arenaWinner');
    const winnerText = comp.winner === 'gemini' ? 'GEMINI WINS' : comp.winner === 'local' ? 'LOCAL WINS' : 'TIE';
    winnerBadge.textContent = winnerText;
    
    const winColor = comp.winner === 'gemini' ? '#3b82f6' : comp.winner === 'local' ? '#10b981' : '#f59e0b';
    winnerBadge.style.color = winColor;
    winnerBadge.style.borderColor = winColor;
    
    const maxSpeed = Math.max(metrics.speed.gemini, metrics.speed.local);
    
    // Gemini
    document.getElementById('geminiSpeedVal').textContent = `${metrics.speed.gemini}ms`;
    document.getElementById('geminiSpeedBar').style.width = `${(metrics.speed.gemini / maxSpeed) * 100}%`;
    document.getElementById('geminiQualityVal').textContent = metrics.quality.gemini;
    document.getElementById('geminiQualityBar').style.width = `${metrics.quality.gemini}%`;
    document.getElementById('geminiCostVal').textContent = `$${normalizeCost(metrics.cost.gemini).toFixed(5)}`;
    
    // Local
    document.getElementById('localSpeedVal').textContent = `${metrics.speed.local}ms`;
    document.getElementById('localSpeedBar').style.width = `${(metrics.speed.local / maxSpeed) * 100}%`;
    document.getElementById('localQualityVal').textContent = metrics.quality.local;
    document.getElementById('localQualityBar').style.width = `${metrics.quality.local}%`;
    document.getElementById('localCostVal').textContent = `$${normalizeCost(metrics.cost.local).toFixed(5)}`;
    
    document.getElementById('arenaRecommendation').textContent = comp.recommendation;
}

function renderTokenEconomics(tokens, cost) {
    if (!tokens) return;
    document.getElementById('tokenInput').textContent = tokens.input;
    document.getElementById('tokenOutput').textContent = tokens.output;
    document.getElementById('tokenTotal').textContent = tokens.total;
    if (cost) document.getElementById('tokenCost').textContent = `$${cost.total.toFixed(5)}`;
}

function renderQualityBadge(quality) {
    if (!quality) return;
    const badge = document.getElementById('qualityScoreBadge');
    badge.textContent = `Score: ${quality.score}`;
    
    const color = quality.score >= 90 ? '#10b981' :
                  quality.score >= 70 ? '#3b82f6' : 
                  quality.score >= 50 ? '#f59e0b' : '#ef4444';
    
    badge.style.color = color;
    badge.style.borderColor = color;
}

// --- D3 Charts Optimized ---

function renderQuota(quota) {
    if (!quota) return;
    const width = 100, height = 100, margin = 10;
    const radius = Math.min(width, height) / 2 - margin;
    
    const container = d3.select("#quotaChart");
    let svg = container.select("svg");
    
    if (svg.empty()) {
        svg = container.append("svg")
            .attr("width", width)
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${width/2},${height/2})`);
    } else {
        svg = svg.select("g");
    }

    const data = {a: quota.percentage, b: 100 - quota.percentage};
    const color = d3.scaleOrdinal().domain(["a", "b"]).range(["#3b82f6", "rgba(255,255,255,0.1)"]);
    const pie = d3.pie().value(d => d[1]);
    const data_ready = pie(Object.entries(data));
    
    const u = svg.selectAll("path").data(data_ready);

    u.join("path")
        .transition().duration(1000)
        .attr('d', d3.arc().innerRadius(radius - 6).outerRadius(radius))
        .attr('fill', d => color(d.data[0]))
        .style("stroke-width", "0px");

    document.getElementById('quotaPercent').textContent = `${Math.round(quota.percentage)}%`;
}

function renderTimelineChart(performance) {
    const container = document.getElementById('timelineChart');
    const width = container.clientWidth;
    const height = container.clientHeight;

    let svg = d3.select("#timelineChart").select("svg");
    if (svg.empty()) {
        svg = d3.select("#timelineChart").append("svg")
            .attr("width", width)
            .attr("height", height);
    }

    const phases = performance.phases || {};
    const data = [
        { name: "Prompt", start: 0, dur: phases.promptBuild || 50, color: "#3b82f6" },
        { name: "LLM", start: phases.promptBuild || 50, dur: phases.llmCall || 1000, color: "#8b5cf6" },
        { name: "Parse", start: (phases.promptBuild||50) + (phases.llmCall||1000), dur: phases.jsonParse || 50, color: "#10b981" },
        { name: "TTS", start: (phases.promptBuild||50) + (phases.llmCall||1000) + (phases.jsonParse||50), dur: phases.audioGenerate || 0, color: "#f59e0b" }
    ].filter(d => d.dur > 0);

    const totalTime = performance.totalTime || 2000;
    const xScale = d3.scaleLinear().domain([0, totalTime]).range([0, width]);

    // Bars
    svg.selectAll("rect")
        .data(data)
        .join(
            enter => enter.append("rect")
                .attr("y", height / 2 - 10)
                .attr("height", 20)
                .attr("rx", 4)
                .attr("fill", d => d.color)
                .attr("x", d => xScale(d.start))
                .attr("width", 0)
                .call(enter => enter.transition().duration(800)
                    .attr("width", d => xScale(d.start + d.dur) - xScale(d.start))),
            update => update.transition().duration(800)
                .attr("x", d => xScale(d.start))
                .attr("width", d => xScale(d.start + d.dur) - xScale(d.start)),
            exit => exit.remove()
        );

    // Labels
    svg.selectAll("text.label")
        .data(data)
        .join(
            enter => enter.append("text")
                .attr("class", "label")
                .attr("y", height / 2 - 15)
                .attr("font-family", "Inter")
                .attr("font-size", "10px")
                .attr("fill", "#94a3b8")
                .attr("x", d => xScale(d.start) + 2)
                .text(d => d.dur > 50 ? d.name : ''),
            update => update
                .attr("x", d => xScale(d.start) + 2)
                .text(d => d.dur > 50 ? d.name : '')
        );

    // Total Time
    const totalText = svg.selectAll("text.total").data([totalTime]);
    totalText.join(
        enter => enter.append("text")
            .attr("class", "total")
            .attr("x", width - 10)
            .attr("y", height - 10)
            .attr("text-anchor", "end")
            .attr("fill", "#e2e8f0")
            .attr("font-size", "12px")
            .attr("font-family", "JetBrains Mono")
            .text(`Total: ${totalTime}ms`),
        update => update.text(`Total: ${totalTime}ms`)
    );
}

function renderRadarChart(quality) {
    const container = document.getElementById('radarChart');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = 30;
    const radius = Math.min(width, height) / 2 - margin;
    
    let svg = d3.select("#radarChart").select("svg");
    let g;
    if (svg.empty()) {
        svg = d3.select("#radarChart").append("svg")
            .attr("width", width)
            .attr("height", height);
        g = svg.append("g").attr("transform", `translate(${width/2},${height/2})`);
        
        // Static Grid
        const rScale = d3.scaleLinear().range([0, radius]).domain([0, 100]);
        [25, 50, 75, 100].forEach(d => {
            g.append("circle")
               .attr("r", rScale(d))
               .attr("fill", "none")
               .attr("stroke", "rgba(255,255,255,0.1)")
               .attr("stroke-dasharray", "4,4");
        });
    } else {
        g = svg.select("g");
    }

    const dims = quality.dimensions || { structuralIntegrity: 0, contentRichness: 0, complianceWithStandards: 0, audioCompleteness: 0 };
    const data = {
        "Struct": dims.structuralIntegrity,
        "Richness": dims.contentRichness,
        "Compliance": dims.complianceWithStandards,
        "Audio": dims.audioCompleteness
    };
    
    const features = Object.keys(data);
    const angleSlice = Math.PI * 2 / features.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 100]);
    
    const line = d3.lineRadial()
        .angle((d, i) => i * angleSlice)
        .radius(d => rScale(d[1]))
        .curve(d3.curveLinearClosed);
        
    g.selectAll("path.radar-area")
        .data([Object.entries(data)])
        .join(
            enter => enter.append("path")
                .attr("class", "radar-area")
                .attr("fill", "rgba(16, 185, 129, 0.2)")
                .attr("stroke", "#10b981")
                .attr("stroke-width", 2)
                .attr("d", line),
            update => update.transition().duration(1000).attr("d", line)
        );
        
    // Axes labels (Static)
    if (g.selectAll(".axis").empty()) {
        const axis = g.selectAll(".axis")
            .data(features)
            .enter().append("g").attr("class", "axis");
            
        axis.append("line")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", (d, i) => rScale(100) * Math.cos(angleSlice * i - Math.PI/2))
            .attr("y2", (d, i) => rScale(100) * Math.sin(angleSlice * i - Math.PI/2))
            .attr("stroke", "rgba(255,255,255,0.1)");
            
        axis.append("text")
            .attr("x", (d, i) => rScale(115) * Math.cos(angleSlice * i - Math.PI/2))
            .attr("y", (d, i) => rScale(115) * Math.sin(angleSlice * i - Math.PI/2))
            .text(d => d)
            .style("text-anchor", "middle")
            .style("font-size", "10px")
            .style("fill", "#94a3b8");
    }
}

// --- Layer 3: Details & Analytics ---

function renderPromptInspector(promptData) {
    if (!promptData) return;
    document.getElementById('promptFullText').textContent = promptData.full || 'No data';
    document.getElementById('promptRole').textContent = promptData.structure?.systemInstruction || 'N/A';
    
    const cotList = document.getElementById('promptCoTList');
    cotList.innerHTML = '';
    (promptData.structure?.chainOfThought || []).forEach(step => {
        const li = document.createElement('li');
        li.textContent = step;
        cotList.appendChild(li);
    });
}

function renderLLMOutput(output) {
    if (!output) return;
    try {
        const formatted = typeof output === 'string' ? JSON.stringify(JSON.parse(output), null, 2) : JSON.stringify(output, null, 2);
        document.getElementById('outputFormattedText').textContent = formatted;
    } catch (e) {
        document.getElementById('outputFormattedText').textContent = 'Invalid JSON';
    }
    const raw = typeof output === 'string' ? output : JSON.stringify(output);
    document.getElementById('outputRawText').textContent = raw;
}

async function loadHistoricalAnalytics(days) {
    try {
        const dateTo = new Date().toISOString().split('T')[0];
        const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [statsRes, historyRes] = await Promise.all([
            fetch(`/api/statistics?dateFrom=${dateFrom}&dateTo=${dateTo}`),
            fetch(`/api/history?limit=100&dateFrom=${dateFrom}&dateTo=${dateTo}`)
        ]);

        if (statsRes.ok && historyRes.ok) {
            const stats = await statsRes.json();
            const history = await historyRes.json();
            renderQualityTrend(history.records);
            renderProviderDistribution(stats.statistics);
            renderTokenTrend(history.records);
        }
    } catch (err) {
        console.error('Analytics load failed', err);
    }
}

// Charts for Analytics (Simplified for brevity, assuming similar D3 join pattern)
function renderQualityTrend(records) { /* Implementation similar to previous dashboard.js but with D3 join */ }
function renderProviderDistribution(stats) { /* ... */ }
function renderTokenTrend(records) { /* ... */ }

function setupTabs() {
    const buttons = document.querySelectorAll('.tab');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const card = btn.closest('.card');
            card.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
            card.querySelectorAll('.prompt-content').forEach(c => c.classList.add('hidden'));
            btn.classList.add('active');
            
            const contentMap = {
                'promptFull': 'promptViewFull', 'promptStruct': 'promptViewStruct',
                'outputFormatted': 'outputViewFormatted', 'outputRaw': 'outputViewRaw'
            };
            const el = document.getElementById(contentMap[target]);
            if (el) el.classList.remove('hidden');
        });
    });
    
    const timeBtns = document.querySelectorAll('.time-btn');
    timeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            timeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadHistoricalAnalytics(parseInt(btn.dataset.days));
        });
    });
}
