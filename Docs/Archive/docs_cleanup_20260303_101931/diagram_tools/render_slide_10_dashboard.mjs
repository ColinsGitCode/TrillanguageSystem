import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u5168\u65b9\u4f4d\u53ef\u89c2\u6d4b\u6027\uff1aMission Control");

const bentoData = [
    { x: 100, y: 150, w: 400, h: 200, title: "Token Flux", color: PALETTE.Data.bg },
    { x: 520, y: 150, w: 580, h: 200, title: "Chrono sequence", color: PALETTE.Client.bg },
    { x: 100, y: 370, w: 280, h: 200, title: "Quality Scan", color: PALETTE.Success.bg },
    { x: 400, y: 370, w: 280, h: 200, title: "Model Arena", color: PALETTE.Gateway.bg },
    { x: 700, y: 370, w: 400, h: 200, title: "Live Feed", color: PALETTE.Neutral.bg }
];

svg.selectAll("rect.bento")
    .data(bentoData)
    .enter().append("rect")
    .attr("x", d => d.x).attr("y", d => d.y)
    .attr("width", d => d.w).attr("height", d => d.h)
    .attr("rx", 12)
    .attr("fill", d => d.color)
    .attr("stroke", "rgba(0,0,0,0.05)")
    .attr("stroke-width", 1);

svg.selectAll("text.bento-title")
    .data(bentoData)
    .enter().append("text")
    .attr("x", d => d.x + 15).attr("y", d => d.y + 25)
    .attr("font-size", 14).attr("font-weight", "bold").attr("fill", "#424242")
    .text(d => d.title);

// Add some abstract icons inside boxes
svg.append("circle").attr("cx", 300).attr("cy", 250).attr("r", 30).attr("fill", "none").attr("stroke", PALETTE.Data.border).attr("stroke-width", 2);
svg.append("line").attr("x1", 550).attr("y1", 250).attr("x2", 1000).attr("y2", 250).attr("stroke", PALETTE.Client.border).attr("stroke-width", 4);
svg.append("path").attr("d", "M200,500 L240,450 L280,520").attr("fill", "none").attr("stroke", PALETTE.Success.border).attr("stroke-width", 2);

saveSVG(dom, 'slide_10_dashboard.svg');
