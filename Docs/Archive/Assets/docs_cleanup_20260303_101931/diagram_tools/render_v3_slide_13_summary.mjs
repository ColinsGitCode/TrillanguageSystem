import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "总结与决策请求");

// Decision Checklist Card
const checklist = svg.append("g").attr("transform", "translate(100, 150)");
checklist.append("rect").attr("width", 500).attr("height", 400).attr("rx", 12).attr("fill", "#F8F9FA").attr("stroke", "#3b82f6").attr("stroke-width", 2);
checklist.append("text").attr("x", 250).attr("y", 50).attr("text-anchor", "middle").attr("font-size", 24).attr("font-weight", "bold").attr("fill", "#1565C0").text("决策请求 (Action Items)");

const items = [
    "确认下一轮实验预算 (样本数 50+)",
    "确认 Teacher 模型锁定 (Gemini 3 Pro)",
    "批准 30/60/90 天 KPI 目标",
    "启动 Vector DB 预研资源分配"
];

items.forEach((item, i) => {
    checklist.append("text").attr("x", 50).attr("y", 120 + i * 60).attr("font-size", 18).text("☐ " + item);
});

// Final Radar
const radarG = svg.append("g").attr("transform", "translate(850, 350)");
const axes = ["Quality", "Cost", "Latency", "Stability", "Success"];
const data = [90, 70, 85, 92, 100];
const angleSlice = (Math.PI * 2) / axes.length;
const radius = 150;
const rScale = d3.scaleLinear().domain([0, 100]).range([0, radius]);

axes.forEach((axis, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    radarG.append("line").attr("x1", 0).attr("y1", 0).attr("x2", radius * Math.cos(angle)).attr("y2", radius * Math.sin(angle)).attr("stroke", "#E0E0E0");
    radarG.append("text").attr("x", (radius + 20) * Math.cos(angle)).attr("y", (radius + 20) * Math.sin(angle)).attr("text-anchor", "middle").attr("font-size", 12).text(axis);
});

const line = d3.lineRadial().angle((d, i) => i * angleSlice).radius(d => rScale(d)).curve(d3.curveLinearClosed);
radarG.append("path").datum(data).attr("d", line).attr("fill", "#10b981").attr("fill-opacity", 0.2).attr("stroke", "#10b981").attr("stroke-width", 3);

saveSVG(dom, 'slide_13_v3_summary.svg');
