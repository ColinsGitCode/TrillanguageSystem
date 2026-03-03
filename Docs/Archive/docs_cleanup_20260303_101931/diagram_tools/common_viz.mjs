import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import fs from 'fs';
import path from 'path';

/**
 * Standard Enterprise Palette
 */
export const PALETTE = {
    Client: { bg: "#E3F2FD", border: "#1565C0", text: "#0D47A1" }, // Blue
    Gateway: { bg: "#FFF3E0", border: "#EF6C00", text: "#E65100" }, // Orange
    Model: { bg: "#E8F5E9", border: "#2E7D32", text: "#1B5E20" },   // Green
    Data: { bg: "#F3E5F5", border: "#7B1FA2", text: "#4A148C" },    // Purple
    Error: { bg: "#FFEBEE", border: "#C62828", text: "#B71C1C" },   // Red
    Neutral: { bg: "#F5F5F5", border: "#757575", text: "#212121" }, // Gray
    Success: { bg: "#E8F5E9", border: "#4CAF50", text: "#2E7D32" }, // Green
    Accent: { bg: "#E3F2FD", border: "#2196F3", text: "#1565C0" }   // Blue
};

/**
 * Enterprise Style Constants
 */
export const STYLE = {
    width: 1200,
    height: 675,
    margin: { top: 60, right: 60, bottom: 80, left: 80 },
    borderRadius: 8,
    fontSize: {
        title: 28,
        label: 16,
        small: 12
    }
};

/**
 * Smart Text Width Measurement
 * CN: 0.95 * fs, EN: 0.6 * fs
 */
export function measureTextWidth(text, fontSize = 16) {
    let width = 0;
    for (let char of text) {
        if (char.match(/[^\x00-\xff]/)) {
            width += 0.95 * fontSize;
        } else if (char === ' ') {
            width += 0.35 * fontSize;
        } else {
            width += 0.6 * fontSize;
        }
    }
    return width;
}

/**
 * Initialize SVG environment using JSDOM
 */
export function setupSVG(width = STYLE.width, height = STYLE.height) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const body = d3.select(dom.window.document).select('body');
    const svg = body.append('svg')
        .attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('width', width)
        .attr('height', height)
        .style('background-color', '#FFFFFF')
        .style('font-family', 'system-ui, -apple-system, sans-serif');
    
    return { dom, svg };
}

/**
 * Save SVG to file
 */
export function saveSVG(dom, fileName) {
    const svgContent = dom.window.document.querySelector('svg').outerHTML;
    const filePath = path.join('docs/assets/svgs', fileName);
    fs.writeFileSync(filePath, svgContent);
    console.log(`Saved SVG to ${filePath}`);
}

/**
 * Render standard title
 */
export function renderTitle(svg, title) {
    svg.append('text')
        .attr('x', STYLE.width / 2)
        .attr('y', 40)
        .attr('text-anchor', 'middle')
        .attr('font-size', STYLE.fontSize.title)
        .attr('font-weight', 'bold')
        .attr('fill', '#212121')
        .text(title);
}
