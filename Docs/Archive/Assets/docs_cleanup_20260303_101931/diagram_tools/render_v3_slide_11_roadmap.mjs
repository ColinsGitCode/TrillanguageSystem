import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "优化方案：30/60/90 天执行计划");

const roadmap = [
    { 
        days: "30天：巩固地基", 
        tasks: ["扩充 Teacher 样本池", "优化预算参数 (Ratio)", "实现失败自动重试"], 
        kpi: "成功率 > 98%", 
        x: 100, 
        color: PALETTE.Client.border 
    },
    { 
        days: "60天：智能进化", 
        tasks: ["语义检索 (RAG) 替代随机", "动态示例长度裁剪策略", "Vector DB 接入"], 
        kpi: "ΔQuality > +10", 
        x: 450, 
        color: PALETTE.Model.border 
    },
    { 
        days: "90天：工业落地", 
        tasks: ["多 Teacher 策略融合", "自动化 Prompt 规则更新", "边缘端模型蒸馏辅助"], 
        kpi: "Teacher 对齐率 > 90%", 
        x: 800, 
        color: PALETTE.Data.border 
    }
];

const g = svg.append("g").attr("transform", "translate(0, 150)");

roadmap.forEach((item, i) => {
    const card = g.append("g").attr("transform", `translate(${item.x}, 0)`);
    card.append("rect").attr("width", 300).attr("height", 400).attr("rx", 12).attr("fill", "#F8F9FA").attr("stroke", item.color).attr("stroke-width", 2);
    
    card.append("text").attr("x", 150).attr("y", 40).attr("text-anchor", "middle").attr("font-weight", "bold").attr("fill", item.color).text(item.days);
    
    item.tasks.forEach((t, j) => {
        card.append("text").attr("x", 30).attr("y", 100 + j * 40).attr("font-size", 14).text("• " + t);
    });

    card.append("rect").attr("x", 30).attr("y", 320).attr("width", 240).attr("height", 50).attr("rx", 25).attr("fill", item.color);
    card.append("text").attr("x", 150).attr("y", 350).attr("text-anchor", "middle").attr("fill", "white").attr("font-weight", "bold").text("KPI: " + item.kpi);
});

saveSVG(dom, 'slide_11_v3_roadmap.svg');
