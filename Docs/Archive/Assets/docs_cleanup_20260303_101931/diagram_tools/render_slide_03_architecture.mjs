import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u7cfb\u7edf\u67b6\u6784\u5168\u666f");

const nodes = [
    { id: "Input", type: "Client", x: 100, y: 337 },
    { id: "OCR", type: "Gateway", x: 300, y: 337 },
    { id: "Prompt Engine", type: "Gateway", x: 550, y: 337 },
    { id: "LLM (Student)", type: "Model", x: 800, y: 337 },
    { id: "Teacher Pool", type: "Data", x: 550, y: 150 },
    { id: "Output", type: "Client", x: 1050, y: 337 }
];

const links = [
    { source: "Input", target: "OCR" },
    { source: "OCR", target: "Prompt Engine" },
    { source: "Prompt Engine", target: "LLM (Student)" },
    { source: "Teacher Pool", target: "Prompt Engine", dashed: true },
    { source: "LLM (Student)", target: "Output" }
];

// Draw Connections
const linkGroup = svg.append("g");
links.forEach(l => {
    const s = nodes.find(n => n.id === l.source);
    const t = nodes.find(n => n.id === l.target);
    linkGroup.append("line")
        .attr("x1", s.x).attr("y1", s.y)
        .attr("x2", t.x).attr("y2", t.y)
        .attr("stroke", "#9E9E9E")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", l.dashed ? "5,5" : "0");
});

// Draw Nodes
const nodeGroup = svg.selectAll("g.node")
    .data(nodes)
    .enter().append("g")
    .attr("transform", d => `translate(${d.x},${d.y})`);

nodeGroup.append("rect")
    .attr("x", -80).attr("y", -30)
    .attr("width", 160).attr("height", 60)
    .attr("rx", 8)
    .attr("fill", d => PALETTE[d.type].bg)
    .attr("stroke", d => PALETTE[d.type].border)
    .attr("stroke-width", 2);

nodeGroup.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .attr("fill", d => PALETTE[d.type].text)
    .attr("font-weight", "bold")
    .attr("font-size", 14)
    .text(d => d.id);

saveSVG(dom, 'slide_03_architecture.svg');
