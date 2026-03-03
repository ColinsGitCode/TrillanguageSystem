import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "多轮实验设计与执行 (Round Design)");

const events = [
    { date: "R0: Baseline", type: "Test", x: 150 },
    { date: "Teacher Generation", type: "Seed", x: 350 },
    { date: "R1: 1-Shot", type: "Test", x: 550 },
    { date: "R2: 2-Shot", type: "Test", x: 750 },
    { date: "R3: 3-Shot", type: "Test", x: 950 }
];

const y = 350;

svg.append("line")
    .attr("x1", 50).attr("y1", y)
    .attr("x2", 1150).attr("y2", y)
    .attr("stroke", "#E0E0E0").attr("stroke-width", 4);

const groups = svg.selectAll("g.event")
    .data(events)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${y})`);

groups.append("circle")
    .attr("r", 12)
    .attr("fill", d => d.type === "Test" ? PALETTE.Client.border : PALETTE.Model.border)
    .attr("stroke", "white")
    .attr("stroke-width", 3);

groups.append("text")
    .attr("y", 40)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .attr("font-size", 14)
    .text(d => d.date);

// Process arrows
groups.filter((d, i) => i < events.length - 1).append("path")
    .attr("d", "M 20 -10 Q 100 -50 180 -10")
    .attr("fill", "none")
    .attr("stroke", "#BDBDBD")
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

// Marker def
svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "-0 -5 10 10")
    .attr("refX", 5)
    .attr("refY", 0)
    .attr("orient", "auto")
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("xoverflow", "visible")
    .append("svg:path")
    .attr("d", "M 0,-5 L 10 ,0 L 0,5")
    .attr("fill", "#BDBDBD");

saveSVG(dom, 'slide_05_round_design.svg');
