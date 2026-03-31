import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "Golden Examples 筛选与注入逻辑");

const treeData = {
    name: "Teacher Pool",
    children: [
        {
            name: "Score > 85",
            children: [
                {
                    name: "Semantic Match",
                    children: [
                        { name: "Format & Compress" },
                        { name: "Token Budget Fit" }
                    ]
                }
            ]
        },
        {
            name: "Recent Used",
            children: [{ name: "Diverse Sampling" }]
        }
    ]
};

const root = d3.hierarchy(treeData);
const treeLayout = d3.tree().size([STYLE.width - 200, 400]);
treeLayout(root);

const g = svg.append("g").attr("transform", "translate(100, 150)");

g.selectAll("line")
    .data(root.links())
    .enter().append("line")
    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x).attr("y2", d => d.target.y)
    .attr("stroke", "#BDBDBD").attr("stroke-width", 2);

const nodes = g.selectAll(".node")
    .data(root.descendants())
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`);

nodes.append("rect")
    .attr("x", -70).attr("y", -20)
    .attr("width", 140).attr("height", 40)
    .attr("rx", 4)
    .attr("fill", d => d.depth === 0 ? PALETTE.Data.bg : PALETTE.Neutral.bg)
    .attr("stroke", d => d.depth === 0 ? PALETTE.Data.border : "#9E9E9E");

nodes.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .attr("font-size", 12)
    .text(d => d.data.name);

saveSVG(dom, 'slide_03_quality_rules.svg');
