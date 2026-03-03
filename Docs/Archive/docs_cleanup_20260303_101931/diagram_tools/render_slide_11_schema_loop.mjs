import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "多 Teacher 融合与 Schema 迭代");

const g = svg.append("g").attr("transform", "translate(600, 350)");

const loopData = [
    { label: "Gemini 3 Pro", color: "#3b82f6" },
    { label: "Claude 3.5 Sonnet", color: "#BA68C8" },
    { label: "Local Bad Cases", color: "#ef4444" }
];

loopData.forEach((d, i) => {
    const angle = i * (Math.PI * 2 / 3);
    const x = 200 * Math.cos(angle);
    const y = 200 * Math.sin(angle);

    g.append("circle").attr("cx", x).attr("cy", y).attr("r", 60).attr("fill", "white").attr("stroke", d.color).attr("stroke-width", 3);
    g.append("text").attr("x", x).attr("y", y).attr("text-anchor", "middle").attr("dy", ".35em").attr("font-size", 12).attr("font-weight", "bold").text(d.label);
});

// Center Merge
g.append("circle").attr("r", 40).attr("fill", "#4CAF50").style("filter", "drop-shadow(0 0 10px #4CAF50)");
g.append("text").attr("text-anchor", "middle").attr("dy", ".35em").attr("fill", "white").attr("font-weight", "bold").text("SCHEMA");

saveSVG(dom, 'slide_11_schema_loop.svg');
