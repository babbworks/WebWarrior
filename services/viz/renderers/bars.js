/**
 * Bars Renderer
 *
 * Draws horizontal bars with length proportional to primary value.
 * Texture channel determines fill pattern:
 *   - solid: full solid bar (█)
 *   - hatched: alternating fill (▓)
 *   - dotted: sparse dots (░)
 *   - scattered: very sparse (·)
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
  const texture = channels.texture || 'solid';

  if (asciiMode) {
    drawAscii(data, texture, bounds, container);
  } else {
    drawDOM(data, texture, bounds, container);
  }
}

/**
 * ASCII mode: render bars as <pre> with block characters.
 */
function drawAscii(data, texture, bounds, container) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.lineHeight = '1.2';
  pre.style.fontFamily = 'monospace';

  const maxCols = Math.max(20, Math.floor(bounds.width / 8));
  const lines = [];

  for (const point of data.points) {
    const barLen = Math.max(1, Math.round(point.primary * maxCols));
    const char = getTextureChar(texture);
    lines.push(char.repeat(barLen));
  }

  pre.textContent = lines.join('\n');
  container.appendChild(pre);
}

/**
 * DOM mode: render bars as <div> elements with CSS backgrounds.
 */
function drawDOM(data, texture, bounds, container) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = bounds.width + 'px';
  wrapper.style.height = bounds.height + 'px';
  wrapper.style.overflow = 'hidden';

  const barHeight = 12;
  const gap = 2;
  const availableWidth = bounds.width;

  for (let i = 0; i < data.points.length; i++) {
    const point = data.points[i];
    const bar = document.createElement('div');
    bar.style.position = 'absolute';
    bar.style.left = '0';
    bar.style.top = (i * (barHeight + gap)) + 'px';
    bar.style.width = Math.max(1, point.primary * availableWidth) + 'px';
    bar.style.height = barHeight + 'px';
    bar.style.background = getTextureBackground(texture);
    bar.style.borderRadius = '2px';
    wrapper.appendChild(bar);
  }

  container.appendChild(wrapper);
}

/**
 * Returns the ASCII block character for a given texture.
 */
function getTextureChar(texture) {
  switch (texture) {
    case 'hatched': return '▓';
    case 'dotted': return '░';
    case 'scattered': return '·';
    case 'solid':
    default: return '█';
  }
}

/**
 * Returns a CSS background value for a given texture.
 */
function getTextureBackground(texture) {
  switch (texture) {
    case 'hatched':
      return 'repeating-linear-gradient(45deg, var(--text, #ccc), var(--text, #ccc) 2px, transparent 2px, transparent 4px)';
    case 'dotted':
      return 'radial-gradient(circle, var(--text, #ccc) 1px, transparent 1px) 0 0 / 6px 6px';
    case 'scattered':
      return 'radial-gradient(circle, var(--text, #ccc) 0.5px, transparent 0.5px) 0 0 / 10px 10px';
    case 'solid':
    default:
      return 'var(--text, #ccc)';
  }
}
