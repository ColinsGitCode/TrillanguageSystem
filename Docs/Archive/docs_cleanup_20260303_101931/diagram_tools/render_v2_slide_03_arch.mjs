import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "系统架构：全链路可观测性设计");

const nodes = [
    { id: "Frontend", type: "Client", x: 150, y: 337, label: "UI (Dashboard)" },
    { id: "Backend", type: "Gateway", x: 450, y: 337, label: "Express Server" },
    { id: "Proxy", type: "Gateway", x: 450, y: 150, label: "Gemini Host Proxy" },
    { id: "LLM_Local", type: "Model", x: 750, y: 337, label: "Local LLM (Ollama)" },
    { id: "LLM_Cloud", type: "Model", x: 750, y: 150, label: "Gemini 3 Pro" },
    { id: "Storage", type: "Data", x: 1050, y: 337, label: "SQLite + FileSys" }
];

const links = [
    { s: "Frontend", t: "Backend", label: "REST API" },
    { s: "Backend", t: "Proxy", label: "Model Pass-thru" },
    { s: "Proxy", t: "LLM_Cloud", label: "CLI Bridge" },
    { s: "Backend", t: "LLM_Local", label: "OpenAI API" },
    { s: "Backend", t: "Storage", label: "Persistent" }
];

// Draw Links
const linkGroup = svg.append("g");
links.forEach(l => {
    const s = nodes.find(n => n.id === l.s);
    const t = nodes.find(n => n.id === l.t);
    linkGroup.append("line")
        .attr("x1", s.x).attr("y1", s.y).attr("x2", t.x).attr("y2", t.y)
        .attr("stroke", "#BDBDBD").attr("stroke-width", 2);
    
    // Label on line
    linkGroup.append("text")
        .attr("x", (s.x + t.x)/2 + 5).attr("y", (s.y + t.y)/2 - 5)
        .attr("font-size", 10).attr("fill", "#9E9E9E").text(l.label);
});

// Draw Nodes
const nodeGroup = svg.selectAll("g.node").data(nodes).enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`);

nodeGroup.append("rect")
    .attr("x", -85).attr("y", -35).attr("width", 170).attr("height", 70).attr("rx", 10)
    .attr("fill", d => PALETTE[d.type].bg).attr("stroke", d => PALETTE[d.type].border).attr("stroke-width", 2);

nodeGroup.append("text").attr("text-anchor", "middle").attr("dy", ".35em")
    .attr("font-weight", "bold").attr("font-size", 13).attr("fill", d => PALETTE[d.type].text).text(d => d.label);

saveSVG(dom, 'slide_03_v2_architecture.svg');
