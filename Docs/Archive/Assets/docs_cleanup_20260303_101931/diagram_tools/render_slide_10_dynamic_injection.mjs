import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "动态 Token 预算自动调节");

const g = svg.append("g").attr("transform", "translate(600, 450)");

// Gauge Arc
const arc = d3.arc().innerRadius(150).outerRadius(200).startAngle(-Math.PI/2).endAngle(Math.PI/2);
g.append("path").attr("d", arc).attr("fill", "#EEEEEE");

const filledArc = d3.arc().innerRadius(150).outerRadius(200).startAngle(-Math.PI/2).endAngle(0.2);
g.append("path").attr("d", filledArc).attr("fill", "#4CAF50");

// Needle
g.append("line")
    .attr("x1", 0).attr("y1", 0)
    .attr("x2", 180 * Math.cos(-Math.PI/2 + 1.2))
    .attr("y2", 180 * Math.sin(-Math.PI/2 + 1.2))
    .attr("stroke", "#212121").attr("stroke-width", 5);

g.append("circle").attr("r", 15).attr("fill", "#212121");

// Text
svg.append("text").attr("x", 600).attr("y", 520).attr("text-anchor", "middle").attr("font-size", 24).attr("font-weight", "bold").text("75% Budget Used");
svg.append("text").attr("x", 600).attr("y", 550).attr("text-anchor", "middle").attr("font-size", 14).attr("fill", "#757575").text("Dynamic Injection Level");

saveSVG(dom, 'slide_10_dynamic_injection.svg');
