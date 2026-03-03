import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "后续优化：基于语义相似度的精准取样");

const data = [
    { x: 300, y: 250, label: "Tech", color: "#2196F3" },
    { x: 320, y: 280, label: "Tech", color: "#2196F3" },
    { x: 280, y: 300, label: "Tech", color: "#2196F3" },
    { x: 800, y: 450, label: "Daily", color: "#4CAF50" },
    { x: 830, y: 420, label: "Daily", color: "#4CAF50" },
    { x: 780, y: 400, label: "Daily", color: "#4CAF50" },
    { x: 550, y: 200, label: "Medical", color: "#E91E63" },
    { x: 580, y: 180, label: "Medical", color: "#E91E63" }
];

svg.selectAll("circle")
    .data(data)
    .enter().append("circle")
    .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", 15)
    .attr("fill", d => d.color).attr("opacity", 0.6);

// New Request
svg.append("circle")
    .attr("cx", 350).attr("cy", 220).attr("r", 20)
    .attr("fill", "none").attr("stroke", "black").attr("stroke-width", 2).attr("stroke-dasharray", "4,4");

svg.append("line")
    .attr("x1", 350).attr("y1", 220).attr("x2", 310).attr("y2", 260)
    .attr("stroke", "black").attr("marker-end", "url(#arrowhead)");

svg.append("text")
    .attr("x", 380).attr("y", 215).attr("font-weight", "bold").text("New Input: 'Quantum'");

svg.append("text")
    .attr("x", 600).attr("y", 550)
    .attr("text-anchor", "middle").attr("font-size", 18).attr("fill", "#1565C0")
    .text("Future: Vector Database (RAG for Few-shot)");

saveSVG(dom, 'slide_09_vector_sampling.svg');
