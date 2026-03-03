import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "提质效率 ROI 分析 (Efficiency Curve)");

const data = [
    { round: "Baseline", efficiency: 0 },
    { round: "R1", efficiency: 14.14 },
    { round: "R2", efficiency: 10.50 },
    { round: "R3", efficiency: 15.80 }
];

const x = d3.scalePoint().domain(data.map(d => d.round)).range([200, 1000]);
const y = d3.scaleLinear().domain([0, 20]).range([STYLE.height - 150, 150]);

const line = d3.line().x(d => x(d.round)).y(d => y(d.efficiency)).curve(d3.curveMonotoneX);

svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", PALETTE.Client.border)
    .attr("stroke-width", 4)
    .attr("d", line);

svg.selectAll("circle")
    .data(data)
    .enter().append("circle")
    .attr("cx", d => x(d.round))
    .attr("cy", d => y(d.efficiency))
    .attr("r", 10)
    .attr("fill", "white")
    .attr("stroke", PALETTE.Client.border)
    .attr("stroke-width", 3);

svg.selectAll("text.val")
    .data(data)
    .enter().append("text")
    .attr("x", d => x(d.round))
    .attr("y", d => y(d.efficiency) - 20)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .attr("fill", PALETTE.Client.text)
    .text(d => d.efficiency);

svg.append("text")
    .attr("x", 600).attr("y", 580)
    .attr("text-anchor", "middle").attr("font-size", 16).attr("fill", "#757575")
    .text("KPI: Gain per 1k Extra Tokens (Higher is better)");

saveSVG(dom, 'slide_07_efficiency_roi.svg');
