import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "总结：落地价值与全维度表现");

const axes = ["Completeness", "Accuracy", "Naturalness", "Formatting", "Cost-Control"];
const data = [
    { name: "Baseline", vals: [60, 55, 40, 50, 95], color: "#9E9E9E" },
    { name: "Optimized (Few-shot)", vals: [92, 88, 85, 94, 75], color: "#10b981" },
    { name: "Cloud (Gemini)", vals: [98, 96, 95, 98, 30], color: "#FF9800" }
];

const angleSlice = (Math.PI * 2) / axes.length;
const radius = 200;
const rScale = d3.scaleLinear().domain([0, 100]).range([0, radius]);

const g = svg.append("g").attr("transform", `translate(${STYLE.width / 2},${STYLE.height / 2 + 20})`);

// Levels
[25, 50, 75, 100].forEach(lv => g.append("circle").attr("r", rScale(lv)).attr("fill", "none").attr("stroke", "#EEEEEE"));

// Axes
axes.forEach((axis, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", radius * Math.cos(angle)).attr("y2", radius * Math.sin(angle)).attr("stroke", "#E0E0E0");
    g.append("text").attr("x", (radius + 20) * Math.cos(angle)).attr("y", (radius + 20) * Math.sin(angle)).attr("text-anchor", "middle").attr("font-size", 12).text(axis);
});

// Radar Shapes
const line = d3.lineRadial().angle((d, i) => i * angleSlice).radius(d => rScale(d)).curve(d3.curveLinearClosed);
data.forEach(d => {
    g.append("path").datum(d.vals).attr("d", line).attr("fill", d.color).attr("fill-opacity", 0.1).attr("stroke", d.color).attr("stroke-width", 3);
});

// Legend
const legend = svg.append("g").attr("transform", "translate(1000, 150)");
data.forEach((d, i) => {
    const lg = legend.append("g").attr("transform", `translate(0, ${i * 30})`);
    lg.append("rect").attr("width", 15).attr("height", 15).attr("fill", d.color);
    lg.append("text").attr("x", 25).attr("y", 12).attr("font-size", 12).text(d.name);
});

saveSVG(dom, 'slide_12_summary_radar.svg');
