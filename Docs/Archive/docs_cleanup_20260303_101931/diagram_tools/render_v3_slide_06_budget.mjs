import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "Token 预算与回退策略：安全第一");

const budgetData = [
    { label: "Role", value: 200, color: "#90CAF9" },
    { label: "Few-shot", value: 600, color: "#81C784" },
    { label: "Task", value: 1000, color: "#BA68C8" },
    { label: "Remaining", value: 248, color: "#EEEEEE" }
];

const total = 2048;
const g = svg.append("g").attr("transform", "translate(100, 150)");

// Draw Main Bar
let currentX = 0;
const scale = d3.scaleLinear().domain([0, total]).range([0, 1000]);

budgetData.forEach(d => {
    const w = scale(d.value);
    g.append("rect")
        .attr("x", currentX).attr("y", 50)
        .attr("width", w).attr("height", 60)
        .attr("fill", d.color).attr("stroke", "white");
    
    g.append("text")
        .attr("x", currentX + w/2).attr("y", 100)
        .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#424242").text(d.label);
    
    currentX += w;
});

// Fallback logic diagram
const fallbackG = svg.append("g").attr("transform", "translate(100, 350)");
const branches = [
    { label: "Normal Inject", status: "Success", x: 0 },
    { label: "Budget Exceeded", status: "Reduction", x: 300 },
    { label: "Length Over", status: "Truncate", x: 600 },
    { label: "Critical Fail", status: "Baseline Fallback", x: 900 }
];

branches.forEach((b, i) => {
    fallbackG.append("rect")
        .attr("x", b.x).attr("y", 0)
        .attr("width", 250).attr("height", 80)
        .attr("rx", 8).attr("fill", i === 0 ? "#E8F5E9" : i === 3 ? "#FFEBEE" : "#FFF3E0")
        .attr("stroke", i === 0 ? "#4CAF50" : i === 3 ? "#F44336" : "#FF9800");
    
    fallbackG.append("text")
        .attr("x", b.x + 125).attr("y", 35).attr("text-anchor", "middle").attr("font-weight", "bold").text(b.label);
    
    fallbackG.append("text")
        .attr("x", b.x + 125).attr("y", 60).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#757575").text(b.status);
});

saveSVG(dom, 'slide_06_v3_budget.svg');
