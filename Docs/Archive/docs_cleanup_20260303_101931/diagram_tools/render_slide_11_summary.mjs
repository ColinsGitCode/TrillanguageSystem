import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u603b\u7ed3\u4e0e\u7ed3\u8bba");

const axes = ["\u5b8c\u6574\u6027", "\u51c6\u786e\u6027", "\u4f8b\u53e5\u8d28\u91cf", "\u683c\u5f0f\u5316", "\u6210\u672c\u53ef\u63a7"];
const data = [
    { name: "Baseline", vals: [60, 55, 40, 50, 95], color: "#9E9E9E" },
    { name: "Few-shot", vals: [90, 85, 88, 92, 70], color: "#10b981" }
];

const angleSlice = (Math.PI * 2) / axes.length;
const radius = 200;
const rScale = d3.scaleLinear().domain([0, 100]).range([0, radius]);

const g = svg.append("g").attr("transform", `translate(${STYLE.width / 2},${STYLE.height / 2 + 20})`);

// Draw levels
[25, 50, 75, 100].forEach(lv => {
    g.append("circle").attr("r", rScale(lv)).attr("fill", "none").attr("stroke", "#EEEEEE");
});

// Draw Axes
axes.forEach((axis, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    g.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", radius * Math.cos(angle))
        .attr("y2", radius * Math.sin(angle))
        .attr("stroke", "#E0E0E0");
    g.append("text")
        .attr("x", (radius + 20) * Math.cos(angle))
        .attr("y", (radius + 20) * Math.sin(angle))
        .attr("text-anchor", "middle")
        .attr("font-size", 14)
        .text(axis);
});

// Draw Shapes
const line = d3.lineRadial().angle((d, i) => i * angleSlice).radius(d => rScale(d)).curve(d3.curveLinearClosed);

data.forEach(d => {
    g.append("path")
        .datum(d.vals)
        .attr("d", line)
        .attr("fill", d.color)
        .attr("fill-opacity", 0.2)
        .attr("stroke", d.color)
        .attr("stroke-width", 3);
});

// Legend
const legend = svg.append("g").attr("transform", `translate(${STYLE.width - 200}, 150)`);
data.forEach((d, i) => {
    const lg = legend.append("g").attr("transform", `translate(0, ${i * 30})`);
    lg.append("rect").attr("width", 15).attr("height", 15).attr("fill", d.color).attr("fill-opacity", 0.3).attr("stroke", d.color);
    lg.append("text").attr("x", 25).attr("y", 12).attr("font-size", 14).text(d.name);
});

saveSVG(dom, 'slide_11_summary.svg');
