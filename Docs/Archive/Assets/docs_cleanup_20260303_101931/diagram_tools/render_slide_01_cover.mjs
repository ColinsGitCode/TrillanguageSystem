import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();

// Abstract Cover Flow
const nodes = [
    { id: "ZH", x: 300, y: 337, color: PALETTE.Data.border },
    { id: "EN", x: 600, y: 200, color: PALETTE.Client.border },
    { id: "JA", x: 900, y: 337, color: PALETTE.Gateway.border },
    { id: "AI", x: 600, y: 474, color: PALETTE.Model.border }
];

const links = [
    { source: nodes[0], target: nodes[3] },
    { source: nodes[1], target: nodes[3] },
    { source: nodes[2], target: nodes[3] },
    { source: nodes[0], target: nodes[1] },
    { source: nodes[1], target: nodes[2] }
];

// Gradient Definitions
const defs = svg.append("defs");
const gradient = defs.append("linearGradient")
    .attr("id", "cover-grad")
    .attr("x1", "0%").attr("y1", "0%")
    .attr("x2", "100%").attr("y2", "100%");
gradient.append("stop").attr("offset", "0%").attr("stop-color", "#3b82f6");
gradient.append("stop").attr("offset", "100%").attr("stop-color", "#8b5cf6");

// Draw Links
svg.selectAll("line")
    .data(links)
    .enter().append("line")
    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x).attr("y2", d => d.target.y)
    .attr("stroke", "#E0E0E0")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "5,5");

// Draw Nodes
const gNodes = svg.selectAll("g.node")
    .data(nodes)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`);

gNodes.append("circle")
    .attr("r", 40)
    .attr("fill", "white")
    .attr("stroke", d => d.color)
    .attr("stroke-width", 3)
    .style("filter", "drop-shadow(0 0 10px rgba(0,0,0,0.1))");

gNodes.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .attr("font-weight", "bold")
    .attr("fill", d => d.color)
    .text(d => d.id);

// Title & Subtitle
svg.append('text')
    .attr('x', STYLE.width / 2)
    .attr('y', 200)
    .attr('text-anchor', 'middle')
    .attr('font-size', 64)
    .attr('font-weight', '900')
    .attr('fill', 'url(#cover-grad)')
    .text("Trilingual Records");

svg.append('text')
    .attr('x', STYLE.width / 2)
    .attr('y', 580)
    .attr('text-anchor', 'middle')
    .attr('font-size', 24)
    .attr('fill', '#616161')
    .text("\u4ece\u201c\u53ef\u7528\u201d\u5230\u201c\u5353\u8d8a\u201d\uff1a\u672c\u5730\u5c0f\u6a21\u578b\u7684 Few-shot \u8fdb\u5316\u4e4b\u8def");

saveSVG(dom, 'slide_01_cover.svg');
