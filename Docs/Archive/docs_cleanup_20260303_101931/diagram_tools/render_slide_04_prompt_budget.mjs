import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "Few-shot \u6ce8\u5165\u673a\u5236\uff1aToken \u9884\u7b97\u5206\u914d");

const data = [
    { label: "System Role", value: 10, color: "#90CAF9" },
    { label: "Few-shot Examples", value: 25, color: "#81C784" },
    { label: "Current Task", value: 60, color: "#BA68C8" },
    { label: "Buffer", value: 5, color: "#E0E0E0" }
];

const radius = 200;
const arc = d3.arc().innerRadius(radius * 0.6).outerRadius(radius);
const pie = d3.pie().value(d => d.value).sort(null);

const g = svg.append("g").attr("transform", `translate(${STYLE.width / 2},${STYLE.height / 2 + 20})`);

const arcs = g.selectAll(".arc")
    .data(pie(data))
    .enter().append("g").attr("class", "arc");

arcs.append("path")
    .attr("d", arc)
    .attr("fill", d => d.data.color)
    .attr("stroke", "white")
    .attr("stroke-width", 2);

// Center Text
g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "-0.5em")
    .attr("font-size", 24)
    .attr("font-weight", "bold")
    .text("2048 Tokens");
g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "1em")
    .attr("font-size", 14)
    .attr("fill", "#757575")
    .text("Context Window");

// Legend
const legend = svg.append("g").attr("transform", `translate(${STYLE.width - 250}, 200)`);
data.forEach((d, i) => {
    const lg = legend.append("g").attr("transform", `translate(0, ${i * 30})`);
    lg.append("rect").attr("width", 18).attr("height", 18).attr("fill", d.color);
    lg.append("text").attr("x", 25).attr("y", 14).attr("font-size", 14).text(`${d.label} (${d.value}%)`);
});

saveSVG(dom, 'slide_04_prompt_budget.svg');
