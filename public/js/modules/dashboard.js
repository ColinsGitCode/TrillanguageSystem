/**
 * Mission Control Dashboard Logic
 * Theme: Sci-Fi / Observability
 */
import { formatTime, formatDate } from './utils.js';

// D3 is loaded globally via script tag

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

function initDashboard() {
    updateTicker();
    setInterval(updateTicker, 1000);
    
    // Live polling
    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 10000); // Fast poll for status

    // Load Analytics
    loadGenerationData(); // Local latest
    loadHistoricalAnalytics(30);

    setupInteractions();
}

function updateTicker() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }); // 24h format
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
        
        // Mock Quota (since API doesn't fully support it yet)
        const mockQuota = { percentage: 42 }; 
        renderQuotaGauge(mockQuota);

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

    // Helper to render row
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
    
    const percent = Math.min(storage.percentage * 100, 100); // Assuming percentage is 0-1
    const bar = document.getElementById('storageBar');
    bar.style.width = `${percent}%`;
    
    // Dynamic color
    const color = percent > 90 ? 'var(--neon-red)' : percent > 70 ? 'var(--neon-amber)' : 'var(--neon-purple)';
    bar.style.backgroundColor = color;
    bar.style.boxShadow = `0 0 10px ${color}`;

    document.getElementById('storageMeta').textContent = `${storage.records || 0} RECORDS`;
}

function renderQuotaGauge(quota) {
    const container = document.getElementById('quotaChart');
    container.innerHTML = '';
    const width = 120, height = 80; // Half circle
    const radius = 50;
    
    const svg = d3.select(container).append("svg")
        .attr("width", width).attr("height", height)
        .append("g").attr("transform", `translate(${width/2},${height - 10})`);
        
    const arc = d3.arc().innerRadius(radius - 8).outerRadius(radius).startAngle(-Math.PI/2);
    
    // Background Arc
    svg.append("path")
       .datum({endAngle: Math.PI/2})
       .attr("d", arc)
       .attr("fill", "rgba(255,255,255,0.1)");
       
    // Value Arc
    const valAngle = -Math.PI/2 + (Math.PI * (quota.percentage / 100));
    svg.append("path")
       .datum({endAngle: valAngle})
       .attr("d", arc)
       .attr("fill", "var(--neon-blue)")
       .style("filter", "drop-shadow(0 0 4px var(--neon-blue))");
       
    document.getElementById('quotaPercent').textContent = `${Math.round(quota.percentage)}%`;
}

// --- Layer 2: Model Arena (Latest Request) ---

function loadGenerationData() {
    const raw = localStorage.getItem('latest_observability');
    if (!raw) return;

    try {
        const data = JSON.parse(raw);
        // Assuming single generation for now, populate Local side as primary
        // If comparison data exists, populate both.
        
        let localData = data;
        let geminiData = null;
        
        if (data.comparison) {
            localData = data.local?.observability;
            geminiData = data.gemini?.observability;
            
            // Recommendation
            document.getElementById('arenaRecommendation').textContent = 
                `>> WINNER: ${data.comparison.winner.toUpperCase()} // ${data.comparison.recommendation}`;
        } else {
            // Single mode: Assume Local
            document.getElementById('arenaRecommendation').textContent = ">> SINGLE MODE // LOCAL LLM ACTIVE";
        }

        // Render Local
        if (localData) {
            updateArenaStats('local', localData);
            logLiveFeed(localData, 'LOCAL');
        }
        
        // Render Gemini (if exists)
        if (geminiData) {
            updateArenaStats('gemini', geminiData);
        } else {
            // Reset Gemini UI to "OFFLINE" look
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

function logLiveFeed(obs, provider) {
    const feed = document.getElementById('liveFeed');
    const row = document.createElement('div');
    row.style.borderLeft = `2px solid ${provider === 'GEMINI' ? 'var(--neon-blue)' : 'var(--neon-purple)'}`;
    row.style.paddingLeft = '8px';
    
    const time = new Date().toLocaleTimeString();
    const score = obs.quality?.score || 0;
    
    row.innerHTML = `
        <span style="color:var(--sci-text-muted)">[${time}]</span> 
        <span style="color:#fff">GEN COMPLETE</span> 
        <span style="color:var(--neon-green)">Q:${score}</span>
    `;
    
    feed.prepend(row); // Add to top
    if (feed.children.length > 8) feed.lastElementChild.remove();
}

// --- Layer 3: Historical Analytics ---

async function loadHistoricalAnalytics(days) {
    try {
        const dateTo = new Date().toISOString().split('T')[0];
        const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const res = await fetch(`/api/history?limit=100&dateFrom=${dateFrom}&dateTo=${dateTo}`);
        if (res.ok) {
            const data = await res.json();
            renderQualityTrend(data.records);
        }
    } catch (err) {
        console.error('Analytics load failed', err);
    }
}

function renderQualityTrend(records) {
    const container = document.getElementById('qualityTrendChart');
    container.innerHTML = '';
    
    if (!records || !records.length) {
        container.innerHTML = '<div style="text-align:center; padding-top:40px; color:var(--sci-text-muted)">NO SIGNAL</div>';
        return;
    }

    const width = container.clientWidth;
    const height = 200;
    const margin = {top: 10, right: 10, bottom: 20, left: 30};
    
    // Process Data: Daily Average
    const dateMap = {};
    records.forEach(r => {
        const d = r.created_at.split('T')[0];
        if (!dateMap[d]) dateMap[d] = { sum:0, count:0 };
        dateMap[d].sum += r.quality_score;
        dateMap[d].count++;
    });
    
    const data = Object.entries(dateMap)
        .map(([date, obj]) => ({ date: new Date(date), val: obj.sum/obj.count }))
        .sort((a,b) => a.date - b.date);

    const svg = d3.select(container).append("svg")
        .attr("width", width).attr("height", height);
        
    const x = d3.scaleTime().domain(d3.extent(data, d => d.date)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, 100]).range([height - margin.bottom, margin.top]);
    
    // Gradient
    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id", "areaGrad").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "var(--neon-blue)").attr("stop-opacity", 0.4);
    grad.append("stop").attr("offset", "100%").attr("stop-color", "var(--neon-blue)").attr("stop-opacity", 0);
    
    // Area
    svg.append("path")
       .datum(data)
       .attr("fill", "url(#areaGrad)")
       .attr("d", d3.area().x(d => x(d.date)).y0(height - margin.bottom).y1(d => y(d.val)).curve(d3.curveMonotoneX));
       
    // Line
    svg.append("path")
       .datum(data)
       .attr("fill", "none")
       .attr("stroke", "var(--neon-blue)")
       .attr("stroke-width", 2)
       .style("filter", "drop-shadow(0 0 4px var(--neon-blue))")
       .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.val)).curve(d3.curveMonotoneX));
       
    // Axes (Simplified)
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
       .call(d3.axisBottom(x).ticks(5).tickSize(0))
       .select(".domain").remove();
       
    svg.selectAll("text").attr("fill", "var(--sci-text-muted)").style("font-family", "JetBrains Mono");
}

function setupInteractions() {
    // Add time range button logic if needed
}