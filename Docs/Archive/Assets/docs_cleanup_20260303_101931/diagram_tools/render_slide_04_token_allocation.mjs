import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "动态 Token 预算与 Fallback 机制");

const data = [
    { label: "Baseline Prompt", system: 200, examples: 0, task: 800, buffer: 1048 },
    { label: "Few-shot (Enhanced)", system: 200, examples: 600, task: 800, buffer: 448 }
];

const subgroups = ["system", "examples", "task", "buffer"];
const stackedData = d3.stack().keys(subgroups)(data);

const x = d3.scaleBand().domain(data.map(d => d.label)).range([200, 1000]).padding(0.4);
const y = d3.scaleLinear().domain([0, 2048]).range([STYLE.height - 150, 150]);
const color = d3.scaleOrdinal().domain(subgroups).range(["#90CAF9", "#81C784", "#BA68C8", "#EEEEEE"]);

const g = svg.append("g");

g.selectAll("g.layer")
    .data(stackedData)
    .enter().append("g")
    .attr("fill", d => color(d.key))
    .selectAll("rect")
    .data(d => d)
    .enter().append("rect")
    .attr("x", d => x(d.data.label))
    .attr("y", d => y(d[1]))
    .attr("height", d => y(d[0]) - y(d[1]))
    .attr("width", x.bandwidth());

// Legend
const legend = svg.append("g").attr("transform", "translate(1050, 200)");
subgroups.reverse().forEach((key, i) => {
    const lg = legend.append("g").attr("transform", `translate(0, ${i * 30})`);
    lg.append("rect").attr("width", 18).attr("height", 18).attr("fill", color(key));
    lg.append("text").attr("x", 25).attr("y", 14).attr("font-size", 12).text(key.toUpperCase());
});

saveSVG(dom, 'slide_04_token_allocation.svg');
