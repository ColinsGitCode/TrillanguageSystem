import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "后端 10 阶段生成链路 (The Pipeline)");

const steps = [
    { label: "1. API Request", type: "I/O" },
    { label: "2. Prompt Build", type: "Compute" },
    { label: "3. LLM Generation", type: "Model" },
    { label: "4. JSON Valid", type: "Compute" },
    { label: "5. Post Processor", type: "Compute" },
    { label: "6. Card Prep", type: "Compute" },
    { label: "7. HTML Render", type: "Compute" },
    { label: "8. File Save", type: "I/O" },
    { label: "9. TTS Batch", type: "Model" },
    { label: "10. DB Commit", type: "I/O" }
];

const startX = 100;
const startY = 300;
const gapX = 100;

const g = svg.append("g");

steps.forEach((s, i) => {
    const x = startX + i * gapX;
    const y = startY + (i % 2 === 0 ? -40 : 40);
    const color = s.type === "Model" ? PALETTE.Model.border : s.type === "I/O" ? PALETTE.Client.border : PALETTE.Gateway.border;

    if (i < steps.length - 1) {
        const nextX = startX + (i + 1) * gapX;
        const nextY = startY + ((i + 1) % 2 === 0 ? -40 : 40);
        g.append("line")
            .attr("x1", x).attr("y1", y)
            .attr("x2", nextX).attr("y2", nextY)
            .attr("stroke", "#E0E0E0").attr("stroke-width", 2);
    }

    const node = g.append("g").attr("transform", `translate(${x},${y})`);
    node.append("circle").attr("r", 15).attr("fill", color);
    node.append("text")
        .attr("transform", "rotate(-45)")
        .attr("x", 20).attr("y", -10)
        .attr("font-size", 11)
        .attr("fill", "#424242")
        .attr("font-weight", "bold")
        .text(s.label);
});

saveSVG(dom, 'slide_02_pipeline_flow.svg');
