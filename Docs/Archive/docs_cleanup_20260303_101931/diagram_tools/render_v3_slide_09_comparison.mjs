import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "结果 B：跨实验对照与差距分析");

const rows = [
    { label: "fewshot_r1 质量增益", expA: "+7.33 (显著)", expB: "~0 (持平)", concl: "A实验早期爆发" },
    { label: "绝对质量上限", expA: "79.33", expB: "82.33", concl: "B实验上限更高" },
    { label: "单位 Token 效率", expA: "14.14 分/1k", expB: "6.70 分/1k", concl: "A实验投入产出比优" },
    { label: "Teacher 对齐潜力", expA: "N/A", expB: "84.4%", concl: "B实验证明可持续对齐" }
];

const startX = 100;
const startY = 150;
const w = [300, 250, 250, 250];
const h = 60;

const g = svg.append("g").attr("transform", `translate(${startX}, ${startY})`);

// Header
const headers = ["对比维度", "实验 A (21样本)", "实验 B (多轮)", "结论"];
headers.forEach((hd, i) => {
    let currentX = 0;
    for(let k=0; k<i; k++) currentX += w[k];
    g.append("rect").attr("x", currentX).attr("y", 0).attr("width", w[i]).attr("height", h).attr("fill", "#F5F5F5").attr("stroke", "#E0E0E0");
    g.append("text").attr("x", currentX + w[i]/2).attr("y", h/2).attr("text-anchor", "middle").attr("dy", ".35em").attr("font-weight", "bold").text(hd);
});

// Data Rows
rows.forEach((row, i) => {
    const y = (i + 1) * h;
    const values = [row.label, row.expA, row.expB, row.concl];
    values.forEach((v, j) => {
        let currentX = 0;
        for(let k=0; k<j; k++) currentX += w[k];
        g.append("rect").attr("x", currentX).attr("y", y).attr("width", w[j]).attr("height", h).attr("fill", "white").attr("stroke", "#E0E0E0");
        g.append("text").attr("x", currentX + w[j]/2).attr("y", y + h/2).attr("text-anchor", "middle").attr("dy", ".35em").attr("font-size", 12).text(v);
    });
});

// Insight Text
svg.append("text").attr("x", 600).attr("y", 550).attr("text-anchor", "middle").attr("font-size", 18).attr("font-weight", "bold").attr("fill", "#1565C0")
    .text("\u2192 \u672c\u8f6e\u4f18\u52bf\u5728\u4e8e\u201c\u65e9\u671f\u589e\u76ca\u4e0e\u6548\u7387\u201d\uff0c\u800c\u975e\u7edd\u5bf9\u4e0a\u9650");

saveSVG(dom, 'slide_09_v3_comparison.svg');
