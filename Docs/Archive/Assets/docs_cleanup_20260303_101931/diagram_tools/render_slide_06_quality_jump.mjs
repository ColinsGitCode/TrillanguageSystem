import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u6838\u5fc3\u6210\u6548\uff1a\u8d28\u91cf\u5206\u7684\u8de8\u8d8a");

const data = [
    { name: "Sample 1", baseline: 72, fewshot: 85 },
    { name: "Sample 2", baseline: 68, fewshot: 82 },
    { name: "Sample 3", baseline: 75, fewshot: 88 },
    { name: "Sample 4", baseline: 70, fewshot: 84 },
    { name: "Sample 5", baseline: 74, fewshot: 86 }
];

const x0 = d3.scaleBand().domain(data.map(d => d.name)).range([STYLE.margin.left, STYLE.width - STYLE.margin.right]).padding(0.2);
const x1 = d3.scaleBand().domain(["baseline", "fewshot"]).range([0, x0.bandwidth()]).padding(0.1);
const y = d3.scaleLinear().domain([0, 100]).range([STYLE.height - STYLE.margin.bottom, 150]);

const g = svg.append("g");

const groups = g.selectAll(".sample")
    .data(data)
    .enter().append("g")
    .attr("transform", d => `translate(${x0(d.name)},0)`);

groups.append("rect")
    .attr("x", x1("baseline"))
    .attr("y", d => y(d.baseline))
    .attr("width", x1.bandwidth())
    .attr("height", d => (STYLE.height - STYLE.margin.bottom) - y(d.baseline))
    .attr("fill", "#BDBDBD")
    .attr("opacity", 0.6);

groups.append("rect")
    .attr("x", x1("fewshot"))
    .attr("y", d => y(d.fewshot))
    .attr("width", x1.bandwidth())
    .attr("height", d => (STYLE.height - STYLE.margin.bottom) - y(d.fewshot))
    .attr("fill", PALETTE.Success.border)
    .attr("rx", 2)
    .style("filter", "drop-shadow(0 0 8px rgba(76, 175, 80, 0.4))");

// Average Line
svg.append("line")
    .attr("x1", STYLE.margin.left).attr("y1", y(72))
    .attr("x2", STYLE.width - STYLE.margin.right).attr("y2", y(72))
    .attr("stroke", "#757575").attr("stroke-dasharray", "4,4");

svg.append("text")
    .attr("x", STYLE.width - STYLE.margin.right + 5).attr("y", y(72))
    .attr("font-size", 12).attr("fill", "#757575").text("Avg Baseline: 72.0");

svg.append("text")
    .attr("x", STYLE.width / 2).attr("y", 120)
    .attr("text-anchor", "middle").attr("font-size", 24).attr("font-weight", "bold").attr("fill", "#2E7D32")
    .text("\u5e73\u5747\u8d28\u91cf\u5206 +10.2% (72.0 \u2192 79.3)");

saveSVG(dom, 'slide_06_quality_jump.svg');
