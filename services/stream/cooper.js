/**
 * Stream Service — Cooper Projection
 *
 * Geometric field visualization computed from Dey signal samples.
 * Maps time-of-day to angle (polar) or x-axis (cartesian),
 * intensity to radius/y, with stability and fragmentation as modifiers.
 */

/**
 * @typedef {Object} CooperField
 * @property {string} projection - 'polar' | 'cartesian'
 * @property {Array<{angle: number, radius: number, stability: number, fragmentation: number, ts: number}>} points
 * @property {Object} bounds - {minR, maxR, minAngle, maxAngle}
 */

/**
 * Computes a polar projection from Dey samples.
 * Maps time-of-day to angle (0 to 2π), intensity to radius.
 * @param {Array<{ts: number, i: number, s: number, f: number}>} samples
 * @param {Object} params - {normalize?: boolean, series?: string}
 * @returns {CooperField}
 */
export function polarProject(samples, params = {}) {
  const { normalize = true, series = 'intensity' } = params;

  const points = samples.map(s => {
    const date = new Date(s.ts * 1000);
    const secondsInDay = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
    const angle = (secondsInDay / 86400) * 2 * Math.PI;
    const radius = series === 'stability' ? s.s : series === 'fragmentation' ? s.f : s.i;
    return { angle, radius, stability: s.s, fragmentation: s.f, ts: s.ts };
  });

  if (normalize && points.length > 0) {
    const maxR = Math.max(...points.map(p => p.radius), 0.001);
    for (const p of points) {
      p.radius /= maxR;
    }
  }

  return {
    projection: 'polar',
    points,
    bounds: { minR: 0, maxR: 1, minAngle: 0, maxAngle: 2 * Math.PI },
  };
}

/**
 * Computes a cartesian projection from Dey samples.
 * Maps timestamp to x, intensity to y.
 * @param {Array<{ts: number, i: number, s: number, f: number}>} samples
 * @param {Object} params - {normalize?: boolean, series?: string}
 * @returns {CooperField}
 */
export function cartesianProject(samples, params = {}) {
  const { normalize = true, series = 'intensity' } = params;

  const points = samples.map(s => {
    const y = series === 'stability' ? s.s : series === 'fragmentation' ? s.f : s.i;
    return { x: s.ts, y, stability: s.s, fragmentation: s.f, ts: s.ts };
  });

  if (normalize && points.length > 0) {
    const maxY = Math.max(...points.map(p => p.y), 0.001);
    for (const p of points) {
      p.y /= maxY;
    }
  }

  const minX = points.length > 0 ? points[0].x : 0;
  const maxX = points.length > 0 ? points[points.length - 1].x : 0;

  return {
    projection: 'cartesian',
    points,
    bounds: { minX, maxX, minY: 0, maxY: 1 },
  };
}

/**
 * Renders a CooperField to ASCII art.
 * @param {CooperField} field
 * @param {Object} opts - {width?: number, height?: number}
 * @returns {string} Multi-line ASCII representation
 */
export function renderAscii(field, opts = {}) {
  const { width = 40, height = 20 } = opts;

  if (field.projection === 'polar') {
    return renderPolarAscii(field, width, height);
  }
  return renderCartesianAscii(field, width, height);
}

// ── Polar ASCII rendering ────────────────────────────────────────────────────

const DENSITY_CHARS = ' ░▒▓█';

/**
 * Renders a polar Cooper field as an ASCII radial diagram.
 */
function renderPolarAscii(field, width, height) {
  const { points } = field;
  if (points.length === 0) return '(no data)';

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const maxRadius = Math.min(centerX, centerY) - 1;

  // Create grid
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));

  // Plot points
  for (const p of points) {
    const r = p.radius * maxRadius;
    const x = Math.round(centerX + r * Math.cos(p.angle - Math.PI / 2));
    const y = Math.round(centerY + r * Math.sin(p.angle - Math.PI / 2));

    if (x >= 0 && x < width && y >= 0 && y < height) {
      const charIdx = Math.min(Math.floor(p.radius * (DENSITY_CHARS.length - 1)), DENSITY_CHARS.length - 1);
      const char = DENSITY_CHARS[charIdx];
      // Only overwrite if denser
      if (DENSITY_CHARS.indexOf(grid[y][x]) < charIdx) {
        grid[y][x] = char;
      }
    }
  }

  // Draw center marker
  if (centerY >= 0 && centerY < height && centerX >= 0 && centerX < width) {
    grid[centerY][centerX] = '·';
  }

  // Add time labels
  const lines = grid.map(row => row.join(''));

  // Header with time markers
  const header = `${''.padStart(centerX - 2)}12:00`;
  const footer = `${''.padStart(centerX - 2)}00:00`;
  const left = '06:00';
  const right = '18:00';

  return [
    header,
    ...lines.map((line, idx) => {
      if (idx === centerY) return `${left} ${line} ${right}`;
      return `      ${line}`;
    }),
    `      ${footer}`,
  ].join('\n');
}

// ── Cartesian ASCII rendering ────────────────────────────────────────────────

/**
 * Renders a cartesian Cooper field as an ASCII waveform.
 */
function renderCartesianAscii(field, width, height) {
  const { points } = field;
  if (points.length === 0) return '(no data)';

  // Create grid
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));

  // Map points to grid positions
  const minX = points[0].x;
  const maxX = points[points.length - 1].x;
  const xRange = maxX - minX || 1;

  for (const p of points) {
    const col = Math.round(((p.x - minX) / xRange) * (width - 1));
    const row = height - 1 - Math.round(p.y * (height - 1));
    if (col >= 0 && col < width && row >= 0 && row < height) {
      const charIdx = Math.min(Math.floor(p.y * (DENSITY_CHARS.length - 1)), DENSITY_CHARS.length - 1);
      grid[row][col] = DENSITY_CHARS[Math.max(charIdx, 1)];
    }
  }

  // Y-axis labels
  const lines = grid.map((row, idx) => {
    const yVal = (1 - idx / (height - 1)).toFixed(1);
    return `${yVal} │${row.join('')}`;
  });

  // X-axis
  const xAxis = `     └${'─'.repeat(width)}`;

  return [...lines, xAxis].join('\n');
}
