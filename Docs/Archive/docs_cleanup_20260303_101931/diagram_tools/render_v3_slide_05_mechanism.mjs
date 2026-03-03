import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "Few-shot 注入机制：检索与筛选策略");

const workflow = [
    { id: "S1", label: "检索 (Retrieve)", desc: "Teacher Refs / History", icon: "🔍", color: PALETTE.Data.border },
    { id: "S2", label: "过滤 (Filter)", desc: "minScore > 85 & Semantic", icon: "🛡️", color: PALETTE.Gateway.border },
    { id: "S3", label: "注入 (Inject)", desc: "Target + Examples", icon: "💉", color: PALETTE.Model.border },
    { id: "S4", label: "记录 (Log)", desc: "Tracking experiment_runs", icon: "📝", color: PALETTE.Success.border }
];

const g = svg.append("g").attr("transform", "translate(100, 250)");

workflow.forEach((step, i) => {
    const x = i * 260;
    const y = 0;

    // Arrow
    if (i < workflow.length - 1) {
        svg.append("line")
            .attr("x1", 100 + x + 180).attr("y1", 300)
            .attr("x2", 100 + x + 260).attr("y2", 300)
            .attr("stroke", "#BDBDBD").attr("stroke-width", 3);
    }

    const node = g.append("g").attr("transform", `translate(${x}, 0)`);
    node.append("rect")
        .attr("width", 200).attr("height", 120)
        .attr("rx", 12).attr("fill", "white").attr("stroke", step.color).attr("stroke-width", 2);

    node.append("text")
        .attr("x", 100).attr("y", 40).attr("text-anchor", "middle").attr("font-size", 24).text(step.icon);
    
    node.append("text")
        .attr("x", 100).attr("y", 75).attr("text-anchor", "middle")
        .attr("font-weight", "bold").attr("fill", step.color).text(step.label);
    
    node.append("text")
        .attr("x", 100).attr("y", 100).attr("text-anchor", "middle")
        .attr("font-size", 11).attr("fill", "#757575").text(step.desc);
});

saveSVG(dom, 'slide_05_v3_mechanism.svg');
