/**
 * Glyphs Renderer
 *
 * Draws Unicode symbols based on primary binding value (op-code categories):
 *   T (tasks) → ⚙ (gear)
 *   F (frick) → ⚡ (bolt)
 *   B (bundy) → ❇ (burst/sparkle)
 *   D (dey) → ◐ (half circle)
 *   S (system) → ◌ (dotted circle)
 *   M (mutation) → ✉ (envelope)
 *   A (annotation) → ✦ (star)
 *   Default → •
 *
 * Size scaled by primary value (font-size: 10px + primary * 14px).
 * Color channel drives hue if colorBind is set.
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

/**
 * ASCII mode: render glyphs in a <pre> block.
 */
function drawAscii(data, channels, bounds, container) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.lineHeight = '1.4';
  pre.style.fontFamily = 'monospace';

  const glyphs = data.points.map(point => {
    const op = getOpCode(point);
    return getGlyph(op);
  });

  pre.textContent = glyphs.join(' ');
  container.appendChild(pre);
}

/**
 * DOM mode: render glyphs as positioned <span> elements.
 */
function drawDOM(data, channels, bounds, container) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = bounds.width + 'px';
  wrapper.style.height = bounds.height + 'px';
  wrapper.style.overflow = 'hidden';

  for (const point of data.points) {
    const op = getOpCode(point);
    const glyph = getGlyph(op);
    const fontSize = 10 + point.primary * 14;

    const span = document.createElement('span');
    span.textContent = glyph;
    span.style.position = 'absolute';
    span.style.left = point.x + 'px';
    span.style.top = point.y + 'px';
    span.style.fontSize = fontSize + 'px';
    span.style.lineHeight = '1';

    if (channels.colorBind && point.color != null) {
      const hue = Math.round(point.color * 300);
      span.style.color = `hsl(${hue}, 70%, 60%)`;
    } else {
      span.style.color = 'var(--text, #ccc)';
    }

    wrapper.appendChild(span);
  }

  container.appendChild(wrapper);
}

/**
 * Extract op-code letter from a point's raw data.
 */
function getOpCode(point) {
  if (point.raw && point.raw.opMode) return point.raw.opMode.charAt(0).toUpperCase();
  if (point.raw && point.raw.op) return point.raw.op.charAt(0).toUpperCase();
  return '';
}

/**
 * Map op-code letter to Unicode glyph.
 */
function getGlyph(op) {
  switch (op) {
    case 'T': return '⚙';
    case 'F': return '⚡';
    case 'B': return '❇';
    case 'D': return '◐';
    case 'S': return '◌';
    case 'M': return '✉';
    case 'A': return '✦';
    default: return '•';
  }
}
