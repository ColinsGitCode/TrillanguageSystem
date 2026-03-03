import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "实验设计：双数据集、双目标对照");

const experiments = [
    { 
        id: "实验 A (local20plus)", 
        target: "规模化稳定提质", 
        samples: "21 真实样本", 
        structure: "Baseline vs 1-Shot", 
        color: PALETTE.Client.bg, 
        border: PALETTE.Client.border 
    },
    { 
        id: "实验 B (gemini3pro)", 
        target: "质量上限与 Teacher 对齐", 
        samples: "3 典型样本", 
        structure: "Teacher Seed + 1/2/3-Shot", 
        color: PALETTE.Data.bg, 
        border: PALETTE.Data.border 
    }
];

const g = svg.append("g").attr("transform", "translate(100, 150)");

experiments.forEach((exp, i) => {
    const card = g.append("g").attr("transform", `translate(${i * 550}, 0)`);
    card.append("rect")
        .attr("width", 500).attr("height", 300)
        .attr("rx", 16).attr("fill", exp.color).attr("stroke", exp.border).attr("stroke-width", 2);
    
    card.append("text").attr("x", 250).attr("y", 50).attr("text-anchor", "middle").attr("font-size", 20).attr("font-weight", "bold").text(exp.id);
    
    const details = [
        { label: "研究目标", val: exp.target },
        { label: "样本规模", val: exp.samples },
        { label: "迭代轮次", val: exp.structure }
    ];

    details.forEach((d, j) => {
        card.append("text").attr("x", 50).attr("y", 120 + j * 60).attr("font-size", 14).attr("fill", "#757575").text(d.label + ":");
        card.append("text").attr("x", 50).attr("y", 145 + j * 60).attr("font-size", 18).attr("font-weight", "600").text(d.val);
    });
});

saveSVG(dom, 'slide_07_v3_exp_design.svg');
