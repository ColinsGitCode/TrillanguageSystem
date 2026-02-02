document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

function initDashboard() {
    updateTimestamp();
    
    // 1. Start Infrastructure Monitoring (Live)
    fetchInfrastructureStatus();
    setInterval(fetchInfrastructureStatus, 30000); // 30s poll

    // 2. Load Generation Analytics (From Storage)
    loadGenerationData();

    // 3. Setup UI interactions
    setupTabs();
}

function updateTimestamp() {
    const now = new Date();
    document.getElementById('lastUpdatedTime').textContent = now.toLocaleTimeString();
}

// --- Layer 1: Infrastructure ---

async function fetchInfrastructureStatus() {
    try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error('Health check failed');
        const data = await res.json();
        
        renderServiceMatrix(data.services);
        renderStorage(data.storage);
        // Quota is often derived from generation data for now, but if health has it, use it
        // Current backend health check doesn't reliably return live quota usage yet, sticking to local data or mock
        
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
    container.innerHTML = ''; // Clear skeleton

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
    document.getElementById('storageBar').style.width = `${percent}%`;
    
    if (percent > 90) {
        document.getElementById('storageBar').style.backgroundColor = 'var(--color-warning)';
    }

    document.getElementById('storageMeta').textContent = `${storage.recordsCount || 0} files total`;
}

// --- Layer 2: Generation Analytics ---

function loadGenerationData() {
    const raw = localStorage.getItem('latest_observability');
    if (!raw) {
        console.log('No generation data found.');
        return;
    }

    try {
        const data = JSON.parse(raw);
        
        if (data.comparison) {
            // Comparison Mode
            document.getElementById('card-arena').classList.remove('hidden');
            renderArena(data);
            
            // Populate standard fields with Gemini data (as primary)
            const primary = data.gemini.observability;
            renderTokenEconomics(primary.tokens, primary.cost);
            renderQuota(primary.quota); // Quota is global usually
            renderPromptInspector(primary.prompt);
            renderQualityBadge(primary.quality);
            
            // Visualize primary performance
            if (primary.performance) renderTimelineChart(primary.performance);
            if (primary.quality) renderRadarChart(primary.quality);
            
        } else {
            // Single Mode
            document.getElementById('card-arena').classList.add('hidden');
            renderTokenEconomics(data.tokens, data.cost);
            renderQuota(data.quota);
            renderPromptInspector(data.prompt);
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
    const normalizeCost = (value) => {
        if (typeof value === 'number') return value;
        if (value && typeof value.total === 'number') return value.total;
        return 0;
    };
    
    // Winner
    const winnerBadge = document.getElementById('arenaWinner');
    const winnerText = comp.winner === 'gemini' ? 'GEMINI WINS' : comp.winner === 'local' ? 'LOCAL WINS' : 'TIE';
    winnerBadge.textContent = winnerText;
    
    const winColor = comp.winner === 'gemini' ? '#3b82f6' : comp.winner === 'local' ? '#10b981' : '#f59e0b';
    winnerBadge.style.color = winColor;
    winnerBadge.style.borderColor = winColor;
    
    // Stats - Max values for bars
    const maxSpeed = Math.max(metrics.speed.gemini, metrics.speed.local);
    
    // Gemini
    document.getElementById('geminiSpeedVal').textContent = `${metrics.speed.gemini}ms`;
    document.getElementById('geminiSpeedBar').style.width = `${(metrics.speed.gemini / maxSpeed) * 100}%`;
    document.getElementById('geminiQualityVal').textContent = metrics.quality.gemini;
    document.getElementById('geminiQualityBar').style.width = `${metrics.quality.gemini}%`;
    const geminiCost = normalizeCost(metrics.cost.gemini);
    document.getElementById('geminiCostVal').textContent = `$${geminiCost.toFixed(5)}`;
    
    // Local
    document.getElementById('localSpeedVal').textContent = `${metrics.speed.local}ms`;
    document.getElementById('localSpeedBar').style.width = `${(metrics.speed.local / maxSpeed) * 100}%`;
    document.getElementById('localQualityVal').textContent = metrics.quality.local;
    document.getElementById('localQualityBar').style.width = `${metrics.quality.local}%`;
    const localCost = normalizeCost(metrics.cost.local);
    document.getElementById('localCostVal').textContent = `$${localCost.toFixed(5)}`;
    
    document.getElementById('arenaRecommendation').textContent = comp.recommendation;
}

function renderTokenEconomics(tokens, cost) {
    if (!tokens) return;
    document.getElementById('tokenInput').textContent = tokens.input;
    document.getElementById('tokenOutput').textContent = tokens.output;
    document.getElementById('tokenTotal').textContent = tokens.total;
    
    if (cost) {
        document.getElementById('tokenCost').textContent = `$${cost.total.toFixed(5)}`;
    }
}

function renderQuota(quota) {
    if (!quota) return;
    
    // Simple Donut using D3
    const width = 100, height = 100, margin = 10;
    const radius = Math.min(width, height) / 2 - margin;
    
    document.getElementById('quotaChart').innerHTML = '';
    const svg = d3.select("#quotaChart")
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${width/2},${height/2})`);

    const data = {a: quota.percentage, b: 100 - quota.percentage};
    const color = d3.scaleOrdinal().domain(["a", "b"]).range(["#3b82f6", "rgba(255,255,255,0.1)"]);
    
    const pie = d3.pie().value(d => d[1]);
    const data_ready = pie(Object.entries(data));
    
    svg.selectAll('whatever')
      .data(data_ready)
      .join('path')
      .attr('d', d3.arc().innerRadius(radius - 6).outerRadius(radius))
      .attr('fill', d => color(d.data[0]))
      .style("stroke-width", "0px");

    document.getElementById('quotaPercent').textContent = `${Math.round(quota.percentage)}%`;
}

function renderQualityBadge(quality) {
    if (!quality) return;
    document.getElementById('qualityScoreBadge').textContent = `Score: ${quality.score}`;
    
    const color = quality.score >= 90 ? 'var(--color-success)' :
                  quality.score >= 70 ? 'var(--color-accent)' : 
                  quality.score >= 50 ? 'var(--color-warning)' : 'var(--color-error)';
    
    document.getElementById('qualityScoreBadge').style.color = color;
    document.getElementById('qualityScoreBadge').style.borderColor = color;
}

// --- D3 Charts ---

function renderTimelineChart(performance) {
    const container = document.getElementById('timelineChart');
    container.innerHTML = '';
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select("#timelineChart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    // Extract phases
    const phases = performance.phases || {};
    const data = [
        { name: "Prompt", start: 0, dur: phases.promptBuild || 50, color: "#3b82f6" },
        { name: "LLM", start: phases.promptBuild || 50, dur: phases.llmCall || 1000, color: "#8b5cf6" },
        { name: "Parse", start: (phases.promptBuild||50) + (phases.llmCall||1000), dur: phases.jsonParse || 50, color: "#10b981" },
        { name: "TTS", start: (phases.promptBuild||50) + (phases.llmCall||1000) + (phases.jsonParse||50), dur: phases.audioGenerate || 0, color: "#f59e0b" }
    ].filter(d => d.dur > 0);

    const totalTime = performance.totalTime || 2000;
    
    const xScale = d3.scaleLinear()
        .domain([0, totalTime])
        .range([0, width]);

    // Bars
    svg.selectAll("rect")
        .data(data)
        .enter()
        .append("rect")
        .attr("x", d => xScale(d.start))
        .attr("y", height / 2 - 10)
        .attr("width", d => xScale(d.start + d.dur) - xScale(d.start))
        .attr("height", 20)
        .attr("fill", d => d.color)
        .attr("rx", 4);

    // Labels
    svg.selectAll("text")
        .data(data)
        .enter()
        .append("text")
        .attr("x", d => xScale(d.start) + 2)
        .attr("y", height / 2 - 15)
        .text(d => d.dur > 50 ? d.name : '') // Only show label if wide enough
        .attr("font-family", "Inter")
        .attr("font-size", "10px")
        .attr("fill", "#94a3b8");
        
    // Total Time Label
    svg.append("text")
        .attr("x", width - 10)
        .attr("y", height - 10)
        .attr("text-anchor", "end")
        .text(`Total: ${totalTime}ms`)
        .attr("fill", "#e2e8f0")
        .attr("font-size", "12px")
        .attr("font-family", "JetBrains Mono");
}

function renderRadarChart(quality) {
    const container = document.getElementById('radarChart');
    container.innerHTML = '';
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    const margin = 30;
    const radius = Math.min(width, height) / 2 - margin;
    
    const svg = d3.select("#radarChart")
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${width/2},${height/2})`);
        
    // Dimensions
    const dims = quality.dimensions || { structuralIntegrity: 0, contentRichness: 0, complianceWithStandards: 0, audioCompleteness: 0 };
    const data = {
        "Struct": dims.structuralIntegrity,
        "Richness": dims.contentRichness,
        "Compliance": dims.complianceWithStandards,
        "Audio": dims.audioCompleteness
    };
    
    const features = Object.keys(data);
    const angleSlice = Math.PI * 2 / features.length;
    
    // Scales
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 100]);
    
    // Grid circles
    [25, 50, 75, 100].forEach(d => {
        svg.append("circle")
           .attr("r", rScale(d))
           .attr("fill", "none")
           .attr("stroke", "rgba(255,255,255,0.1)")
           .attr("stroke-dasharray", "4,4");
    });
    
    // Axes
    const axis = svg.selectAll(".axis")
        .data(features)
        .enter()
        .append("g")
        .attr("class", "axis");
        
    axis.append("line")
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", (d, i) => rScale(100) * Math.cos(angleSlice * i - Math.PI/2))
        .attr("y2", (d, i) => rScale(100) * Math.sin(angleSlice * i - Math.PI/2))
        .attr("stroke", "rgba(255,255,255,0.1)")
        .attr("stroke-width", "1px");
        
    axis.append("text")
        .attr("x", (d, i) => rScale(115) * Math.cos(angleSlice * i - Math.PI/2))
        .attr("y", (d, i) => rScale(115) * Math.sin(angleSlice * i - Math.PI/2))
        .text(d => d)
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .style("fill", "#94a3b8");
        
    // Shape
    const line = d3.lineRadial()
        .angle((d, i) => i * angleSlice)
        .radius(d => rScale(d[1]))
        .curve(d3.curveLinearClosed);
        
    svg.append("path")
        .datum(Object.entries(data))
        .attr("d", line)
        .attr("fill", "rgba(16, 185, 129, 0.2)")
        .attr("stroke", "#10b981")
        .attr("stroke-width", 2);
}

// --- Layer 3: Prompt Inspector ---

function renderPromptInspector(promptData) {
    if (!promptData) return;
    
    const { structure, full } = promptData;
    
    document.getElementById('promptRole').textContent = structure.systemInstruction || 'N/A';
    
    const cotList = document.getElementById('promptCoTList');
    cotList.innerHTML = '';
    (structure.chainOfThought || []).forEach(step => {
        const li = document.createElement('li');
        li.textContent = step;
        cotList.appendChild(li);
    });
    
    document.getElementById('promptRawText').textContent = full;
}

function setupTabs() {
    const buttons = document.querySelectorAll('.tab');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Reset
            buttons.forEach(b => b.classList.remove('active'));
            document.getElementById('promptViewStruct').classList.add('hidden');
            document.getElementById('promptViewRaw').classList.add('hidden');
            
            // Set
            btn.classList.add('active');
            const target = btn.dataset.target;
            if (target === 'struct') {
                document.getElementById('promptViewStruct').classList.remove('hidden');
            } else {
                document.getElementById('promptViewRaw').classList.remove('hidden');
            }
        });
    });
}
