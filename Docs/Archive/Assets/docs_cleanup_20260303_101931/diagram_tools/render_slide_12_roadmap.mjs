import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u672a\u6765\u5c55\u671b \uff06 Q&A");

const milestones = [
    { label: "\u8bed\u4e49\u76f8\u4f3c\u5ea6\u53d6\u6837", date: "Q1 2026", x: 200 },
    { label: "\u52a8\u6001 Token \u9884\u7b97", date: "Q2 2026", x: 500 },
    { label: "\u591a Teacher \u878d\u5408\u673a\u5236", date: "Q3 2026", x: 800 },
    { label: "\u5de5\u4e1a\u7ea7\u751f\u4ea7\u843d\u5730", date: "Q4 2026", x: 1000 }
];

const y = 400;

svg.append("line")
    .attr("x1", 50).attr("y1", y)
    .attr("x2", 1150).attr("y2", y)
    .attr("stroke", "#E0E0E0").attr("stroke-width", 4);

const groups = svg.selectAll("g.mile")
    .data(milestones)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${y})`);

groups.append("circle")
    .attr("r", 10)
    .attr("fill", "#2196F3")
    .attr("stroke", "white")
    .attr("stroke-width", 3);

groups.append("text")
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .text(d => d.date);

groups.append("text")
    .attr("y", -40)
    .attr("text-anchor", "middle")
    .attr("font-size", 16)
    .attr("fill", "#1565C0")
    .text(d => d.label);

svg.append("text")
    .attr("x", STYLE.width / 2).attr("y", 200)
    .attr("text-anchor", "middle").attr("font-size", 48).attr("font-weight", "bold").attr("fill", "#EEEEEE")
    .text("Q & A");

saveSVG(dom, 'slide_12_roadmap.svg');
