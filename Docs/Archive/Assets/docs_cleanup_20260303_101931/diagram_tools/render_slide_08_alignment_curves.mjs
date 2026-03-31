import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "Teacher 对齐度与稳定性 (Alignment & Stability)");

function normalPDF(x, mu, sigma) {
    return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
}

const x = d3.scaleLinear().domain([50, 105]).range([STYLE.margin.left, STYLE.width - STYLE.margin.right]);
const y = d3.scaleLinear().domain([0, 0.2]).range([STYLE.height - 150, 150]);

const curves = [
    { mu: 72, sigma: 8, label: "Baseline (R0)", color: "#9E9E9E", dash: "5,5" },
    { mu: 79.3, sigma: 4, label: "Few-shot (R1)", color: "#2196F3", dash: "0" },
    { mu: 82.3, sigma: 2.5, label: "Optimized (R3)", color: "#4CAF50", dash: "0" },
    { mu: 96, sigma: 1.5, label: "Teacher (Gemini)", color: "#FF9800", dash: "3,3" }
];

const line = d3.line().x(d => x(d.x)).y(d => y(d.y)).curve(d3.curveBasis);

curves.forEach(c => {
    const points = [];
    for (let i = 50; i <= 105; i += 0.5) {
        points.push({ x: i, y: normalPDF(i, c.mu, c.sigma) });
    }
    svg.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", c.color)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", c.dash)
        .attr("d", line);

    // Label at peak
    svg.append("text")
        .attr("x", x(c.mu)).attr("y", y(normalPDF(c.mu, c.mu, c.sigma)) - 10)
        .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", c.color).text(c.label);
});

saveSVG(dom, 'slide_08_alignment_curves.svg');
