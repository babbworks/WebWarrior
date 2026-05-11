/**
 * Timeline Layout
 *
 * Arranges points along a time axis with magnitude on the perpendicular axis.
 * - Horizontal: X = time (left to right), Y = primary value (bottom to top)
 * - Vertical: Y = time (top to bottom), X = primary value (left to right)
 *
 * @param {{points: Array<{ts: number, primary: number, texture?: number, color?: number, raw: Object}>, normalization: string}} data
 * @param {{orientation?: string, density?: string, bounds: {width: number, height: number}}} opts
 * @returns {{points: Array<{x: number, y: number, primary: number, texture?: number, color?: number, raw: Object}>, bounds: {width: number, height: number}}}
 */
export function position(data, opts) {
  const { bounds } = opts;
  const orientation = opts.orientation || 'horizontal';
  const density = opts.density || 'normal';

  const densityMultiplier = density === 'compact' ? 0.6 : density === 'relaxed' ? 1.5 : 1;

  // Handle empty data
  if (!data.points || data.points.length === 0) {
    return { points: [], bounds };
  }

  const points = data.points;
  const count = points.length;

  // Single point — place at center
  if (count === 1) {
    const p = points[0];
    const x = bounds.width / 2;
    const y = bounds.height / 2;
    return {
      points: [{ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw }],
      bounds
    };
  }

  // Find time range for normalization
  let minTs = points[0].ts;
  let maxTs = points[0].ts;
  for (let i = 1; i < count; i++) {
    if (points[i].ts < minTs) minTs = points[i].ts;
    if (points[i].ts > maxTs) maxTs = points[i].ts;
  }
  const timeSpan = maxTs - minTs || 1;

  // Padding based on density
  const padding = 10 * densityMultiplier;

  const result = [];

  if (orientation === 'horizontal') {
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;

    for (const p of points) {
      const tNorm = (p.ts - minTs) / timeSpan;
      const x = padding + tNorm * usableWidth;
      // Y: primary value bottom-to-top (0 at bottom, 1 at top)
      const y = padding + (1 - p.primary) * usableHeight;
      result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
    }
  } else {
    // Vertical: Y = time (top to bottom), X = primary value (left to right)
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;

    for (const p of points) {
      const tNorm = (p.ts - minTs) / timeSpan;
      const y = padding + tNorm * usableHeight;
      const x = padding + p.primary * usableWidth;
      result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
    }
  }

  return { points: result, bounds };
}
