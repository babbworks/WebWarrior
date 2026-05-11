/**
 * Sparkline Renderer
 *
 * Draws a continuous line/area chart.
 * Amplitude = primary value.
 * Color channel drives stroke color:
 *   - monochrome: var(--text) or white
 *   - intensity-gradient: gradient from cool to warm based on value
 *   - op-coded / project-coded: not applicable for continuous line, falls back to monochrome
 *
 * @param {{points: Array<{x: number, y: number, primary: number, texture?: number, color?: number, raw: Object}>, bounds: {width: number, height: number}}} data
 * @param {{primary: string, texture: string, textureBind: string|null, color: string, colorBind: string|null}} channels
 * @param {HTMLElement} container
 * @param {boolean} asciiMode
 */
export function draw(data, channels, container, asciiMode) {
  container.innerHTML = '';

  if (!data.points || data.points.length === 0) return;

  const { bounds } = data;

  if (asciiMode) {
    drawAscii(data, channels, bounds, container);
  } else {
    drawDOM(data, channels, bounds, container);
  }
}

/** Sparkline block characters ordered by height (⅛ increments). */
const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * ASCII mode: render as <pre> using sparkline characters (▁▂▃▄▅▆▇█).
 */
function drawAscii(data, channels, bounds, container) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.lineHeight = '1';
  pre.style.fontFamily = 'monospace';

  const line = data.points.map(point => {
    const idx = Math.min(SPARK_CHARS.length - 1, Math.max(0, Math.floor(point.primary * SPARK_CHARS.length)));
    return SPARK_CHARS[idx];
  });

  pre.textContent = line.join('');
  container.appendChild(pre);
}

/**
 * DOM mode: render as SVG <polyline>.
 */
function drawDOM(data, channels, bounds, container) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', bounds.width);
  svg.setAttribute('height', bounds.height);
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  svg.style.display = 'block';
  svg.style.overflow = 'hidden';

  const padding = 4;
  const usableHeight = bounds.height - padding * 2;

  // Build polyline points from positioned data
  const polyPoints = data.points.map(point => {
    const x = point.x;
    const y = padding + (1 - point.primary) * usableHeight;
    return `${x},${y}`;
  }).join(' ');

  // Draw filled area
  if (data.points.length > 1) {
    const firstX = data.points[0].x;
    const lastX = data.points[data.points.length - 1].x;
    const areaPoints = `${firstX},${bounds.height} ${polyPoints} ${lastX},${bounds.height}`;

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('points', areaPoints);
    area.setAttribute('fill', getAreaFill(channels));
    area.setAttribute('opacity', '0.2');
    svg.appendChild(area);
  }

  // Draw line
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', polyPoints);
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', getStrokeColor(channels));
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('stroke-linecap', 'round');
  svg.appendChild(polyline);

  // For intensity-gradient, add colored dots at each point
  if (channels.color === 'intensity-gradient') {
    for (const point of data.points) {
      const x = point.x;
      const y = padding + (1 - point.primary) * usableHeight;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', '2');
      circle.setAttribute('fill', getGradientColor(point.primary));
      svg.appendChild(circle);
    }
  }

  container.appendChild(svg);
}

/**
 * Returns stroke color based on color channel setting.
 */
function getStrokeColor(channels) {
  switch (channels.color) {
    case 'intensity-gradient':
      return '#61afef';
    case 'monochrome':
    default:
      return 'var(--text, #ccc)';
  }
}

/**
 * Returns area fill color based on color channel setting.
 */
function getAreaFill(channels) {
  switch (channels.color) {
    case 'intensity-gradient':
      return '#61afef';
    case 'monochrome':
    default:
      return 'var(--text, #ccc)';
  }
}

/**
 * Returns a color on a cool-to-warm gradient based on value (0 = cool blue, 1 = warm red).
 */
function getGradientColor(value) {
  const hue = (1 - value) * 240; // 240 (blue) → 0 (red)
  return `hsl(${hue}, 70%, 55%)`;
}
