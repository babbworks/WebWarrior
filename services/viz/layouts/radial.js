/**
 * Radial Layout
 *
 * Arranges points on a polar clock face.
 * - Map time-of-day to angle: (secondsInDay / 86400) * 2π
 * - Map primary value to radius (0 = center, 1 = edge)
 * - Convert polar to cartesian: x = cx + r*cos(angle), y = cy + r*sin(angle)
 * - Center at (width/2, height/2), max radius = min(width, height)/2 - padding
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

  // Center and radius
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const padding = 10 * densityMultiplier;
  const maxRadius = Math.min(bounds.width, bounds.height) / 2 - padding;

  const result = [];

  for (const p of points) {
    // Seconds into the day from timestamp
    const secondsInDay = p.ts % 86400;
    const angle = (secondsInDay / 86400) * 2 * Math.PI;

    // Radius from primary value (0 = center, 1 = edge)
    const r = p.primary * maxRadius;

    // Convert polar to cartesian
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);

    result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
  }

  return { points: result, bounds };
}
