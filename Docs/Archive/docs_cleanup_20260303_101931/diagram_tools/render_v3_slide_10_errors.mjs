import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "失败样本与机制瓶颈分析");

const errors = [
    { type: "Fetch Failed", count: 12, color: "#EF5350" },
    { type: "Truncated Output", count: 8, color: "#FF7043" },
    { type: "JSON Parse Error", count: 5, color: "#FFA726" },
    { type: "Budget Exceeded", count: 15, color: "#AB47BC" }
];

const x = d3.scaleLinear().domain([0, 20]).range([STYLE.margin.left + 150, STYLE.width - STYLE.margin.right]);
const y = d3.scaleBand().domain(errors.map(d => d.type)).range([150, 450]).padding(0.4);

svg.selectAll("rect")
    .data(errors)
    .enter().append("rect")
    .attr("x", STYLE.margin.left + 150)
    .attr("y", d => y(d.type))
    .attr("width", d => x(d.count) - (STYLE.margin.left + 150))
    .attr("height", y.bandwidth())
    .attr("fill", d => d.color).attr("rx", 4);

svg.selectAll("text.label")
    .data(errors)
    .enter().append("text")
    .attr("x", STYLE.margin.left + 140)
    .attr("y", d => y(d.type) + y.bandwidth()/2)
    .attr("text-anchor", "end").attr("dy", ".35em").attr("font-size", 14).attr("font-weight", "bold").text(d => d.type);

svg.selectAll("text.val")
    .data(errors)
    .enter().append("text")
    .attr("x", d => x(d.count) + 10)
    .attr("y", d => y(d.type) + y.bandwidth()/2)
    .attr("dy", ".35em").attr("font-size", 14).text(d => d.count);

// Root Cause box
svg.append("rect").attr("x", 100).attr("y", 500).attr("width", 1000).attr("height", 80).attr("rx", 8).attr("fill", "#FFF3E0").attr("stroke", "#FF9800");
svg.append("text").attr("x", 600).attr("y", 545).attr("text-anchor", "middle").attr("font-size", 18).attr("font-weight", "bold").attr("fill", "#E65100")
    .text("瓶颈定位：高质量 Teacher 样本不足 & 预算触发频繁回退");

saveSVG(dom, 'slide_10_v3_errors.svg');
