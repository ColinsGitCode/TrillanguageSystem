import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "ROI \u6548\u7387\uff1a\u6210\u672c\u4e0e\u589e\u76ca\u7684\u6743\u8861");

const data = [
    { round: "Baseline", deltaQ: 0, efficiency: 0 },
    { round: "Round 1", deltaQ: 3.5, efficiency: 8.2 },
    { round: "Round 2", deltaQ: 7.3, efficiency: 14.1 },
    { round: "Round 3", deltaQ: 8.5, efficiency: 12.4 }
];

const x = d3.scalePoint().domain(data.map(d => d.round)).range([STYLE.margin.left + 50, STYLE.width - STYLE.margin.right - 50]);
const yLeft = d3.scaleLinear().domain([0, 10]).range([STYLE.height - STYLE.margin.bottom, 150]);
const yRight = d3.scaleLinear().domain([0, 20]).range([STYLE.height - STYLE.margin.bottom, 150]);

// Bars (Delta Quality)
svg.selectAll("rect")
    .data(data)
    .enter().append("rect")
    .attr("x", d => x(d.round) - 20)
    .attr("y", d => yLeft(d.deltaQ))
    .attr("width", 40)
    .attr("height", d => (STYLE.height - STYLE.margin.bottom) - yLeft(d.deltaQ))
    .attr("fill", "#BBDEFB");

// Line (Efficiency)
const line = d3.line().x(d => x(d.round)).y(d => yRight(d.efficiency));
svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#1E88E5")
    .attr("stroke-width", 3)
    .attr("d", line);

svg.selectAll("circle")
    .data(data)
    .enter().append("circle")
    .attr("cx", d => x(d.round))
    .attr("cy", d => yRight(d.efficiency))
    .attr("r", 6)
    .attr("fill", "#1E88E5");

// Label peak
svg.append("text")
    .attr("x", x("Round 2")).attr("y", yRight(14.1) - 20)
    .attr("text-anchor", "middle").attr("font-size", 14).attr("font-weight", "bold").attr("fill", "#0D47A1")
    .text("Peak Efficiency: 14.14");

// Legend
const legend = svg.append("g").attr("transform", `translate(${STYLE.width - 200}, 100)`);
legend.append("rect").attr("width", 15).attr("height", 15).attr("fill", "#BBDEFB");
legend.append("text").attr("x", 20).attr("y", 12).attr("font-size", 12).text("\u8d28\u91cf\u589e\u76ca (\u0394Quality)");
legend.append("line").attr("x1", 0).attr("y1", 30).attr("x2", 15).attr("y2", 30).attr("stroke", "#1E88E5").attr("stroke-width", 2);
legend.append("text").attr("x", 20).attr("y", 34).attr("font-size", 12).text("\u63d0\u8d28\u6548\u7387 (Gain/1k Tokens)");

saveSVG(dom, 'slide_07_roi_efficiency.svg');
