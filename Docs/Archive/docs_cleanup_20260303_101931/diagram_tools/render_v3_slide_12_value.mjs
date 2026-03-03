import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "工程价值：大幅提升研发效能");

const data = [
    { process: "人工实验 (构建+跑样+统计)", manual: 180, auto: 15, unit: "min" },
    { process: "指标分析与绘图", manual: 60, auto: 2, unit: "min" },
    { process: "多模型交叉验证", manual: 120, auto: 10, unit: "min" }
];

const x = d3.scaleLinear().domain([0, 200]).range([STYLE.margin.left + 200, STYLE.width - STYLE.margin.right]);
const y = d3.scaleBand().domain(data.map(d => d.process)).range([150, 450]).padding(0.4);

const g = svg.append("g");

data.forEach(d => {
    // Manual Bar
    g.append("rect")
        .attr("x", STYLE.margin.left + 200).attr("y", y(d.process))
        .attr("width", x(d.manual) - (STYLE.margin.left + 200)).attr("height", y.bandwidth() / 2)
        .attr("fill", "#9E9E9E").attr("opacity", 0.3);
    
    // Auto Bar
    g.append("rect")
        .attr("x", STYLE.margin.left + 200).attr("y", y(d.process) + y.bandwidth() / 2)
        .attr("width", x(d.auto) - (STYLE.margin.left + 200)).attr("height", y.bandwidth() / 2)
        .attr("fill", PALETTE.Success.border);

    g.append("text")
        .attr("x", STYLE.margin.left + 190).attr("y", y(d.process) + y.bandwidth()/2)
        .attr("text-anchor", "end").attr("dy", ".35em").attr("font-weight", "bold").text(d.process);
    
    g.append("text").attr("x", x(d.manual) + 5).attr("y", y(d.process) + y.bandwidth()/4 + 5).attr("font-size", 10).text(d.manual + "m (Manual)");
    g.append("text").attr("x", x(d.auto) + 5).attr("y", y(d.process) + 3*y.bandwidth()/4 + 5).attr("font-size", 10).attr("font-weight", "bold").attr("fill", PALETTE.Success.border).text(d.auto + "m (Auto)");
});

svg.append("text").attr("x", 600).attr("y", 550).attr("text-anchor", "middle").attr("font-size", 24).attr("font-weight", "bold").attr("fill", "#2E7D32")
    .text("\u2192 \u7814\u53d1效能提升 ~10x | \u5b9e\u9a8c\u53ef\u91cd\u590d\uff0c\u6570\u636e\u53ef\u5ba1\u8ba1");

saveSVG(dom, 'slide_12_v3_value.svg');
