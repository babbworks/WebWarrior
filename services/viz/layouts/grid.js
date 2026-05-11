/**
 * Grid Layout
 *
 * Arranges points in a time × category matrix.
 * - Rows = time buckets (Y axis, top to bottom)
 * - Columns = categories derived from raw.opMode or raw.op (X axis, left to right)
 * - Each cell gets a position at the intersection
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

  // Extract categories from raw.opMode or raw.op
  const categorySet = new Set();
  for (const p of points) {
    const cat = (p.raw && (p.raw.opMode || p.raw.op)) || 'unknown';
    categorySet.add(cat);
  }
  const categories = Array.from(categorySet).sort();
  const catIndex = new Map();
  categories.forEach((c, i) => catIndex.set(c, i));

  // Extract unique time buckets (sorted)
  const timeSet = new Set();
  for (const p of points) {
    timeSet.add(p.ts);
  }
  const timeBuckets = Array.from(timeSet).sort((a, b) => a - b);
  const timeIndex = new Map();
  timeBuckets.forEach((t, i) => timeIndex.set(t, i));

  const numCols = categories.length;
  const numRows = timeBuckets.length;

  // Padding based on density
  const padding = 10 * densityMultiplier;

  const usableWidth = bounds.width - padding * 2;
  const usableHeight = bounds.height - padding * 2;

  // Cell spacing
  const cellWidth = numCols > 1 ? usableWidth / (numCols - 1) : usableWidth;
  const cellHeight = numRows > 1 ? usableHeight / (numRows - 1) : usableHeight;

  const result = [];

  for (const p of points) {
    const cat = (p.raw && (p.raw.opMode || p.raw.op)) || 'unknown';
    const col = catIndex.get(cat);
    const row = timeIndex.get(p.ts);

    const x = numCols > 1 ? padding + col * cellWidth : padding + usableWidth / 2;
    const y = numRows > 1 ? padding + row * cellHeight : padding + usableHeight / 2;

    result.push({ x, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
  }

  return { points: result, bounds };
}
