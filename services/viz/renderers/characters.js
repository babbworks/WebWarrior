/**
 * Characters Renderer
 *
 * Draws op-code letters (B, D, E, F, M, P, R, S, T) as spatial text.
 * Primary binding controls density: higher primary = more characters at that position.
 * For each positioned point, repeat the character Math.ceil(primary * 3) times.
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

/** Op-code specific colors for 'op-coded' color mode. */
const OP_COLORS = {
  B: '#e06c75',
  D: '#61afef',
  E: '#c678dd',
  F: '#e5c07b',
  M: '#56b6c2',
  P: '#98c379',
  R: '#d19a66',
  S: '#abb2bf',
  T: '#be5046'
};

/**
 * ASCII mode: render characters in a <pre> block at grid positions.
 */
function drawAscii(data, channels, bounds, container) {
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.lineHeight = '1.2';
  pre.style.fontFamily = 'monospace';

  const cols = Math.max(20, Math.floor(bounds.width / 8));
  const rows = Math.max(5, Math.floor(bounds.height / 14));

  // Build a character grid
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));

  for (const point of data.points) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((point.x / bounds.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((point.y / bounds.height) * rows)));
    const ch = getCharacter(point);
    const repeat = Math.ceil(point.primary * 3);

    for (let r = 0; r < repeat && col + r < cols; r++) {
      grid[row][col + r] = ch;
    }
  }

  pre.textContent = grid.map(row => row.join('')).join('\n');
  container.appendChild(pre);
}

/**
 * DOM mode: render characters as positioned <span> elements with monospace font.
 */
function drawDOM(data, channels, bounds, container) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = bounds.width + 'px';
  wrapper.style.height = bounds.height + 'px';
  wrapper.style.overflow = 'hidden';
  wrapper.style.fontFamily = 'monospace';

  for (const point of data.points) {
    const ch = getCharacter(point);
    const repeat = Math.ceil(point.primary * 3);
    const text = ch.repeat(repeat);

    const span = document.createElement('span');
    span.textContent = text;
    span.style.position = 'absolute';
    span.style.left = point.x + 'px';
    span.style.top = point.y + 'px';
    span.style.fontSize = '12px';
    span.style.lineHeight = '1';
    span.style.whiteSpace = 'nowrap';

    if (channels.color === 'op-coded') {
      span.style.color = OP_COLORS[ch] || 'var(--text, #ccc)';
    } else {
      span.style.color = 'var(--text, #ccc)';
    }

    wrapper.appendChild(span);
  }

  container.appendChild(wrapper);
}

/**
 * Extract the op-code character from a point's raw data.
 */
function getCharacter(point) {
  if (point.raw && point.raw.opMode) return point.raw.opMode.charAt(0).toUpperCase();
  if (point.raw && point.raw.op) return point.raw.op.charAt(0).toUpperCase();
  return '•';
}
