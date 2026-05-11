/**
 * Field Layout
 *
 * Arranges points as a 2D spatial field.
 * - X = time (normalized to bounds width)
 * - Y = secondary dimension value (texture or color channel if available, otherwise primary)
 *
 * No orientation sub-property.
 *
 * @param {{points: Array<{ts: number, primary: number, texture?: number, color?: number, raw: Object}>, normalization: string}} data
 * @param {{orientation?: string, density?: string, bounds: {width: number, height: number}}} opts
 * @returns {{points: Array<{x: number, y: number, primary: number, texture?: number, color?: number, raw: Object}>, bounds: {width: number, height: number}}}
 */
export function position(data, opts) {
  const { bounds } = opts;
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
    return {
      points: [{ x: bounds.width / 2, y: bounds.height / 2, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw }],
      bounds
    };
  }

  // Find time range
  let minTs = points[0].ts;
  let maxTs = points[0].ts;
  for (let i = 1; i < count; i++) {
    if (points[i].ts < minTs) minTs = points[i].ts;
    if (points[i].ts > maxTs) maxTs = points[i].ts;
  }
  const timeSpan = maxTs - minTs || 1;

  const padding = 10 * densityMultiplier;
  const usableWidth = bounds.width - padding * 2;
  const usableHeight = bounds.height - padding * 2;

  const result = [];

  for (const p of points) {
    // X = time normalized to bounds
    const tNorm = (p.ts - minTs) / timeSpan;
    const x = padding + tNorm * usableWidth;

    // Y = secondary dimension (texture > color > primary), mapped bottom-to-top
    const secondaryValue = (p.texture != null) ? p.texture
      : (p.color != null) ? p.color
      : p.primary;
    const y = padding + (1 - secondaryValue) * usableHeight;

    result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
  }

  return { points: result, bounds };
}
