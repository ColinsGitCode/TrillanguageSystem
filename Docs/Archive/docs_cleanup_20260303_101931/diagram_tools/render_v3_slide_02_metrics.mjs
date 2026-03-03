import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "成功标准：多维评估框架");

const metrics = [
    { key: "Quality Score", desc: "综合质量分 (0-100)", icon: "✨", color: PALETTE.Success.border },
    { key: "Success Rate", desc: "生成成功率", icon: "✅", color: PALETTE.Success.border },
    { key: "Avg Tokens", desc: "Token 消耗 (输入+输出)", icon: "🔢", color: PALETTE.Data.border },
    { key: "Avg Latency", desc: "响应延迟 (ms)", icon: "⏱️", color: PALETTE.Gateway.border },
    { key: "Quality CV%", desc: "质量稳定性 (越低越稳)", icon: "⚖️", color: PALETTE.Neutral.border }
];

// Draw Formula Box
const formulaBox = svg.append("g").attr("transform", "translate(300, 150)");
formulaBox.append("rect")
    .attr("width", 600).attr("height", 120)
    .attr("rx", 12).attr("fill", "#F8F9FA").attr("stroke", "#3b82f6").attr("stroke-width", 2);

formulaBox.append("text")
    .attr("x", 300).attr("y", 50).attr("text-anchor", "middle")
    .attr("font-size", 24).attr("font-weight", "bold").attr("fill", "#1565C0")
    .text("Gain per 1k Extra Tokens");

formulaBox.append("text")
    .attr("x", 300).attr("y", 90).attr("text-anchor", "middle")
    .attr("font-family", "JetBrains Mono").attr("font-size", 20).attr("fill", "#424242")
    .text("= \u0394Quality / (\u0394Tokens / 1000)");

// Draw Metric Cards
const g = svg.append("g").attr("transform", "translate(100, 320)");
metrics.forEach((m, i) => {
    const card = g.append("g").attr("transform", `translate(${i * 205}, 0)`);
    card.append("rect")
        .attr("width", 190).attr("height", 150)
        .attr("rx", 10).attr("fill", "white").attr("stroke", "#E0E0E0").attr("stroke-width", 1);
    
    card.append("text")
        .attr("x", 95).attr("y", 40).attr("text-anchor", "middle").attr("font-size", 30).text(m.icon);
    
    card.append("text")
        .attr("x", 95).attr("y", 80).attr("text-anchor", "middle")
        .attr("font-weight", "bold").attr("font-size", 14).attr("fill", m.color).text(m.key);
    
    card.append("text")
        .attr("x", 95).attr("y", 110).attr("text-anchor", "middle")
        .attr("font-size", 11).attr("fill", "#757575").text(m.desc);
});

saveSVG(dom, 'slide_02_v3_metrics.svg');
