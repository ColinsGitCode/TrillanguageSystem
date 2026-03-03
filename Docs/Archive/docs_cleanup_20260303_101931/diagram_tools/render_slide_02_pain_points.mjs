import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u75db\u70b9\u4e0e\u80cc\u666f\uff1a\u672c\u5730\u6a21\u578b\u7684\u201c\u91ce\u86ee\u751f\u957f\u201d");

const data = [
    { label: "\u683c\u5f0f\u9519\u8bef (Format)", value: 40 },
    { label: "\u8bed\u4e49\u504f\u5dee (Semantic)", value: 35 },
    { label: "\u7f3a\u5931\u5b57\u6bb5 (Missing)", value: 25 }
];

const x = d3.scaleLinear().domain([0, 100]).range([STYLE.margin.left, STYLE.width - STYLE.margin.right]);
const y = d3.scaleBand().domain(data.map(d => d.label)).range([STYLE.margin.top + 100, STYLE.height - STYLE.margin.bottom]).padding(0.3);

svg.selectAll("rect")
    .data(data)
    .enter().append("rect")
    .attr("x", STYLE.margin.left)
    .attr("y", d => y(d.label))
    .attr("width", d => x(d.value) - STYLE.margin.left)
    .attr("height", y.bandwidth())
    .attr("fill", PALETTE.Error.border)
    .attr("rx", 4);

svg.selectAll("text.label")
    .data(data)
    .enter().append("text")
    .attr("x", STYLE.margin.left + 10)
    .attr("y", d => y(d.label) + y.bandwidth() / 2 + 6)
    .attr("fill", "white")
    .attr("font-weight", "bold")
    .text(d => d.label);

svg.selectAll("text.value")
    .data(data)
    .enter().append("text")
    .attr("x", d => x(d.value) + 10)
    .attr("y", d => y(d.label) + y.bandwidth() / 2 + 6)
    .attr("fill", PALETTE.Error.text)
    .attr("font-weight", "bold")
    .text(d => d.value + "%");

saveSVG(dom, 'slide_02_pain_points.svg');
