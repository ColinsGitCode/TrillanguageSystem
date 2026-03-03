import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "三语学习卡片生态 (Feature Architecture)");

const center = { x: 600, y: 350, r: 80 };
const features = [
    { label: "OCR 图像文字识别", angle: -90, color: PALETTE.Gateway.border },
    { label: "汉字注音 (Furigana)", angle: -30, color: PALETTE.Data.border },
    { label: "Kokoro/VOICEVOX TTS", angle: 30, color: PALETTE.Client.border },
    { label: "SQLite 历史归档", angle: 90, color: PALETTE.Data.border },
    { label: "可观测性监控 (Mission Control)", angle: 150, color: PALETTE.Model.border },
    { label: "多模型对比 (Dual-Model)", angle: 210, color: PALETTE.Gateway.border }
];

const g = svg.append("g");

// Draw Pedals
features.forEach(f => {
    const angleRad = (f.angle * Math.PI) / 180;
    const x = center.x + 220 * Math.cos(angleRad);
    const y = center.y + 220 * Math.sin(angleRad);

    // Line to center
    g.append("line")
        .attr("x1", center.x).attr("y1", center.y)
        .attr("x2", x).attr("y2", y)
        .attr("stroke", "#E0E0E0").attr("stroke-width", 2);

    const bg = g.append("g").attr("transform", `translate(${x},${y})`);
    
    bg.append("rect")
        .attr("x", -90).attr("y", -25)
        .attr("width", 180).attr("height", 50)
        .attr("rx", 25)
        .attr("fill", "white")
        .attr("stroke", f.color)
        .attr("stroke-width", 2);

    bg.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .attr("font-size", 13)
        .attr("fill", f.color)
        .attr("font-weight", "600")
        .text(f.label);
});

// Center
g.append("circle")
    .attr("cx", center.x).attr("cy", center.y).attr("r", center.r)
    .attr("fill", "#3b82f6")
    .style("filter", "drop-shadow(0 0 15px rgba(59, 130, 246, 0.5))");

g.append("text")
    .attr("x", center.x).attr("y", center.y)
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .attr("fill", "white")
    .attr("font-weight", "bold")
    .attr("font-size", 20)
    .text("TRILINGUAL");

saveSVG(dom, 'slide_01_feature_map.svg');
