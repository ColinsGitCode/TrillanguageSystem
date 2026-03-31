import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u7a33\u5b9a\u6027\uff1a\u4ece\u6ce2\u52a8\u5230\u786e\u5b9a");

// Function to generate normal distribution data
function normalPDF(x, mu, sigma) {
    return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
}

const x = d3.scaleLinear().domain([40, 100]).range([STYLE.margin.left, STYLE.width - STYLE.margin.right]);
const y = d3.scaleLinear().domain([0, 0.15]).range([STYLE.height - STYLE.margin.bottom, 150]);

const baselineMu = 72, baselineSigma = 8;
const fewshotMu = 79.3, fewshotSigma = 3;

const line = d3.line().x(d => x(d.x)).y(d => y(d.y)).curve(d3.curveBasis);

const generatePoints = (mu, sigma) => {
    const points = [];
    for (let i = 40; i <= 100; i += 1) {
        points.push({ x: i, y: normalPDF(i, mu, sigma) });
    }
    return points;
};

// Draw Baseline
svg.append("path")
    .datum(generatePoints(baselineMu, baselineSigma))
    .attr("fill", "none")
    .attr("stroke", "#9E9E9E")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "5,5")
    .attr("d", line);

// Draw Few-shot
svg.append("path")
    .datum(generatePoints(fewshotMu, fewshotSigma))
    .attr("fill", "rgba(76, 175, 80, 0.1)")
    .attr("stroke", "#4CAF50")
    .attr("stroke-width", 4)
    .attr("d", line);

// Highlight Mean Change
svg.append("text")
    .attr("x", x(baselineMu)).attr("y", y(0.02) + 20)
    .attr("text-anchor", "middle").attr("fill", "#757575").attr("font-size", 12)
    .text("Baseline (CV: 3.67%)");

svg.append("text")
    .attr("x", x(fewshotMu)).attr("y", y(0.13) - 10)
    .attr("text-anchor", "middle").attr("fill", "#2E7D32").attr("font-weight", "bold").attr("font-size", 14)
    .text("Few-shot (CV: 3.40%)");

svg.append("text")
    .attr("x", STYLE.width / 2).attr("y", 120)
    .attr("text-anchor", "middle").attr("font-size", 20).attr("fill", "#212121")
    .text("\u6210\u529f\u7387 90.5% \u2192 100% | \u8d28\u91cf\u5206\u5e03\u9ad8\u5ea6\u96c6\u4e2d");

saveSVG(dom, 'slide_08_stability.svg');
