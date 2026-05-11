/**
 * Blocks Renderer
 *
 * Draws solid rectangles.
 * Size = primary value (width and height scaled).
 * Texture channel determines fill:
 *   - solid: solid background
 *   - hatched: CSS repeating-linear-gradient diagonal stripes
 *   - dotted: CSS radial-gradient dots
 *   - scattered: very sparse dots
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

/** Maximum block size in pixels. */
const MAX_BLOCK_SIZE = 40;
/** Minimum block size in pixels. */
const MIN_BLOCK_SIZE = 4;

/**
 * ASCII mode: render blocks as <pre> with block characters of varying density.
 */
function drawAscii(data, texture, bounds, container) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.lineHeight = '1.2';
  pre.style.fontFamily = 'monospace';

  const lines = [];

  for (const point of data.points) {
    const size = Math.max(1, Math.ceil(point.primary * 5));
    const char = getDensityChar(texture, point.primary);
    const row = char.repeat(size);
    // Stack rows to form a square-ish block
    const height = Math.max(1, Math.ceil(point.primary * 3));
    for (let h = 0; h < height; h++) {
      lines.push(row);
    }
    lines.push(''); // gap between blocks
  }

  pre.textContent = lines.join('\n');
  container.appendChild(pre);
}

/**
 * DOM mode: render blocks as positioned <div> elements with CSS backgrounds.
 */
function drawDOM(data, texture, bounds, container) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = bounds.width + 'px';
  wrapper.style.height = bounds.height + 'px';
  wrapper.style.overflow = 'hidden';

  for (const point of data.points) {
    const size = MIN_BLOCK_SIZE + point.primary * (MAX_BLOCK_SIZE - MIN_BLOCK_SIZE);

    const block = document.createElement('div');
    block.style.position = 'absolute';
    block.style.left = (point.x - size / 2) + 'px';
    block.style.top = (point.y - size / 2) + 'px';
    block.style.width = size + 'px';
    block.style.height = size + 'px';
    block.style.background = getTextureBackground(texture);
    block.style.borderRadius = '2px';

    wrapper.appendChild(block);
  }

  container.appendChild(wrapper);
}

/**
 * Returns an ASCII character based on texture and density.
 */
function getDensityChar(texture, primary) {
  switch (texture) {
    case 'hatched': return '▓';
    case 'dotted': return '░';
    case 'scattered': return '·';
    case 'solid':
    default:
      // Vary density character by primary value
      if (primary > 0.75) return '█';
      if (primary > 0.5) return '▓';
      if (primary > 0.25) return '░';
      return '·';
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
      return 'radial-gradient(circle, var(--text, #ccc) 1.5px, transparent 1.5px) 0 0 / 6px 6px';
    case 'scattered':
      return 'radial-gradient(circle, var(--text, #ccc) 0.5px, transparent 0.5px) 0 0 / 12px 12px';
    case 'solid':
    default:
      return 'var(--text, #ccc)';
  }
}
