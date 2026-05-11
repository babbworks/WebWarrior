/**
 * Swim-Lanes Layout
 *
 * Arranges points in parallel lanes grouped by category.
 * Categories derived from raw.opMode, raw.op, or raw.proj.
 * - Horizontal: lanes are horizontal rows, time flows left to right within each lane
 * - Vertical: lanes are vertical columns, time flows top to bottom within each lane
 *
 * All points sharing the same category get the same lane coordinate.
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
    return {
      points: [{ x: bounds.width / 2, y: bounds.height / 2, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw }],
      bounds
    };
  }

  // Extract categories from raw.opMode, raw.op, or raw.proj
  function getCategory(p) {
    if (!p.raw) return 'unknown';
    return p.raw.opMode || p.raw.op || p.raw.proj || 'unknown';
  }

  const categorySet = new Set();
  for (const p of points) {
    categorySet.add(getCategory(p));
  }
  const categories = Array.from(categorySet).sort();
  const catIndex = new Map();
  categories.forEach((c, i) => catIndex.set(c, i));
  const numLanes = categories.length;

  // Find time range
  let minTs = points[0].ts;
  let maxTs = points[0].ts;
  for (let i = 1; i < count; i++) {
    if (points[i].ts < minTs) minTs = points[i].ts;
    if (points[i].ts > maxTs) maxTs = points[i].ts;
  }
  const timeSpan = maxTs - minTs || 1;

  const padding = 10 * densityMultiplier;
  const result = [];

  if (orientation === 'horizontal') {
    // Lanes are horizontal rows, time flows left to right
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;
    const laneHeight = usableHeight / numLanes;

    for (const p of points) {
      const cat = getCategory(p);
      const laneIdx = catIndex.get(cat);
      const tNorm = (p.ts - minTs) / timeSpan;

      const x = padding + tNorm * usableWidth;
      const y = padding + laneIdx * laneHeight + laneHeight / 2;

      result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
    }
  } else {
    // Lanes are vertical columns, time flows top to bottom
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;
    const laneWidth = usableWidth / numLanes;

    for (const p of points) {
      const cat = getCategory(p);
      const laneIdx = catIndex.get(cat);
      const tNorm = (p.ts - minTs) / timeSpan;

      const x = padding + laneIdx * laneWidth + laneWidth / 2;
      const y = padding + tNorm * usableHeight;

      result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
    }
  }

  return { points: result, bounds };
}
