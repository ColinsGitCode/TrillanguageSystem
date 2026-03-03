import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u81ea\u6f14\u8fdb\uff1aTeacher \u5bf9\u9f50\u8d8b\u52bf");

const data = [
    { round: "Round 1", align: 79.6 },
    { round: "Round 2", align: 82.1 },
    { round: "Round 3", align: 84.4 }
];

const x = d3.scalePoint().domain(data.map(d => d.round)).range([STYLE.margin.left + 100, STYLE.width - STYLE.margin.right - 100]);
const y = d3.scaleLinear().domain([70, 100]).range([STYLE.height - STYLE.margin.bottom, 150]);

const area = d3.area()
    .x(d => x(d.round))
    .y0(STYLE.height - STYLE.margin.bottom)
    .y1(d => y(d.align))
    .curve(d3.curveMonotoneX);

// Gradient
const defs = svg.append("defs");
const grad = defs.append("linearGradient").attr("id", "area-grad").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
grad.append("stop").attr("offset", "0%").attr("stop-color", "#8b5cf6").attr("stop-opacity", 0.4);
grad.append("stop").attr("offset", "100%").attr("stop-color", "#8b5cf6").attr("stop-opacity", 0);

svg.append("path")
    .datum(data)
    .attr("fill", "url(#area-grad)")
    .attr("d", area);

const line = d3.line().x(d => x(d.round)).y(d => y(d.align)).curve(d3.curveMonotoneX);
svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#7c3aed")
    .attr("stroke-width", 4)
    .attr("d", line);

svg.selectAll("circle")
    .data(data)
    .enter().append("circle")
    .attr("cx", d => x(d.round))
    .attr("cy", d => y(d.align))
    .attr("r", 8)
    .attr("fill", "#7c3aed")
    .attr("stroke", "white")
    .attr("stroke-width", 2);

svg.selectAll("text.val")
    .data(data)
    .enter().append("text")
    .attr("x", d => x(d.round))
    .attr("y", d => y(d.align) - 20)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .text(d => d.align + "%");

svg.append("text")
    .attr("x", STYLE.width / 2).attr("y", 120)
    .attr("text-anchor", "middle").attr("font-size", 20).attr("fill", "#4A148C")
    .text("Gap Closure: \u672c\u5730\u6a21\u578b\u8f93\u51fa\u9010\u6b65\u5411 Teacher \u5206\u5e03\u9760\u62e2");

saveSVG(dom, 'slide_09_alignment.svg');
