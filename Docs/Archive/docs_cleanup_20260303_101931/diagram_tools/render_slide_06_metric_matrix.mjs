import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "核心指标对照矩阵 (Cross-Round Matrix)");

const rounds = ["Baseline", "R1 (1-Shot)", "R2 (2-Shot)", "R3 (3-Shot)"];
const metrics = ["Quality", "Tokens", "Latency", "Success"];
const data = [
    [72.0, 980, 57.6, 90.5],
    [79.3, 1498, 59.2, 100.0],
    [80.0, 1550, 58.5, 100.0],
    [82.3, 1749, 56.6, 100.0]
];

const cellW = 180;
const cellH = 80;
const startX = 250;
const startY = 150;

const g = svg.append("g");

// Labels
metrics.forEach((m, i) => {
    g.append("text").attr("x", startX + i * cellW + cellW/2).attr("y", startY - 20)
        .attr("text-anchor", "middle").attr("font-weight", "bold").text(m);
});

rounds.forEach((r, i) => {
    g.append("text").attr("x", startX - 20).attr("y", startY + i * cellH + cellH/2)
        .attr("text-anchor", "end").attr("font-weight", "bold").text(r);
});

// Heatmap cells
data.forEach((row, i) => {
    row.forEach((val, j) => {
        let color = "#FFFFFF";
        if (j === 0) color = d3.interpolateGreens((val - 70) / 15); // Quality
        if (j === 1) color = d3.interpolatePurples((val - 900) / 1000); // Tokens
        if (j === 3) color = val === 100 ? "#E8F5E9" : "#FFEBEE";

        g.append("rect")
            .attr("x", startX + j * cellW).attr("y", startY + i * cellH)
            .attr("width", cellW).attr("height", cellH)
            .attr("fill", color).attr("stroke", "#E0E0E0");

        g.append("text")
            .attr("x", startX + j * cellW + cellW/2).attr("y", startY + i * cellH + cellH/2)
            .attr("text-anchor", "middle").attr("dy", ".35em").text(val + (j===3 ? "%" : ""));
    });
});

saveSVG(dom, 'slide_06_metric_matrix.svg');
