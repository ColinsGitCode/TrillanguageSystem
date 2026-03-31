import { setupSVG, saveSVG, PALETTE, STYLE, renderTitle } from './common_viz.mjs';
import * as d3 from 'd3';

const { dom, svg } = setupSVG();
renderTitle(svg, "\u5b9e\u9a8c\u8bbe\u8ba1\uff1aTeacher-Student \u6a21\u5f0f");

// Two main nodes
const teacher = { x: 300, y: 337, label: "Teacher (Gemini 3 Pro)", type: "Model" };
const student = { x: 900, y: 337, label: "Student (Qwen 2.5)", type: "Model" };

// Knowledge connection
const lineGenerator = d3.line().curve(d3.curveBasis);
const points = [
    [teacher.x + 100, teacher.y],
    [600, teacher.y - 100],
    [student.x - 100, student.y]
];

svg.append("path")
    .attr("d", lineGenerator(points))
    .attr("fill", "none")
    .attr("stroke", "#4CAF50")
    .attr("stroke-width", 4)
    .attr("stroke-dasharray", "10,5");

// Animated particles (static for SVG but styled)
for(let i=0; i<5; i++) {
    svg.append("circle")
        .attr("r", 6)
        .attr("fill", "#4CAF50")
        .attr("cx", points[0][0] + (student.x - teacher.x - 200) * (i/5))
        .attr("cy", teacher.y - Math.sin(Math.PI * (i/5)) * 100)
        .style("opacity", 0.6);
}

// Draw Nodes
[teacher, student].forEach(node => {
    const g = svg.append("g").attr("transform", `translate(${node.x},${node.y})`);
    g.append("rect")
        .attr("x", -150).attr("y", -50)
        .attr("width", 300).attr("height", 100)
        .attr("rx", 12)
        .attr("fill", PALETTE[node.type].bg)
        .attr("stroke", PALETTE[node.type].border)
        .attr("stroke-width", 3);
    g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", PALETTE[node.type].text)
        .text(node.label);
});

svg.append("text")
    .attr("x", 600).attr("y", 200)
    .attr("text-anchor", "middle")
    .attr("font-size", 16)
    .attr("fill", "#2E7D32")
    .attr("font-style", "italic")
    .text("Knowledge Transfer (Golden Examples)");

saveSVG(dom, 'slide_05_evolution.svg');
