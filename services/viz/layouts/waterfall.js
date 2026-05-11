/**
 * Waterfall Layout
 *
 * Arranges points as stacked rows showing accumulation over time.
 * - Horizontal: each row is a time bucket, bars grow left to right
 * - Vertical: each column is a time bucket, bars grow bottom to top
 *
 * Points are positioned in rows/columns with their primary value determining extent.
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

  // Group points by time bucket (ts)
  const bucketMap = new Map();
  for (const p of points) {
    if (!bucketMap.has(p.ts)) {
      bucketMap.set(p.ts, []);
    }
    bucketMap.get(p.ts).push(p);
  }
  const bucketKeys = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const numBuckets = bucketKeys.length;

  const padding = 10 * densityMultiplier;
  const result = [];

  if (orientation === 'horizontal') {
    // Rows = time buckets (top to bottom), bars grow left to right
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;
    const rowHeight = usableHeight / numBuckets;

    for (let rowIdx = 0; rowIdx < numBuckets; rowIdx++) {
      const bucketPoints = bucketMap.get(bucketKeys[rowIdx]);
      const y = padding + rowIdx * rowHeight + rowHeight / 2;

      // Accumulate positions left to right within the row
      let accumX = padding;
      const slotWidth = usableWidth / bucketPoints.length;

      for (let i = 0; i < bucketPoints.length; i++) {
        const p = bucketPoints[i];
        const x = accumX + p.primary * slotWidth;
        accumX += slotWidth * densityMultiplier;
        // Clamp x within bounds
        const clampedX = Math.min(Math.max(x, 0), bounds.width);
        result.push({ x: clampedX, y, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
      }
    }
  } else {
    // Vertical: columns = time buckets (left to right), bars grow bottom to top
    const usableWidth = bounds.width - padding * 2;
    const usableHeight = bounds.height - padding * 2;
    const colWidth = usableWidth / numBuckets;

    for (let colIdx = 0; colIdx < numBuckets; colIdx++) {
      const bucketPoints = bucketMap.get(bucketKeys[colIdx]);
      const x = padding + colIdx * colWidth + colWidth / 2;

      // Accumulate positions bottom to top within the column
      let accumY = bounds.height - padding;
      const slotHeight = usableHeight / bucketPoints.length;

      for (let i = 0; i < bucketPoints.length; i++) {
        const p = bucketPoints[i];
        const y = accumY - p.primary * slotHeight;
        accumY -= slotHeight * densityMultiplier;
        // Clamp y within bounds
        const clampedY = Math.min(Math.max(y, 0), bounds.height);
        result.push({ x, y: clampedY, primary: p.primary, texture: p.texture, color: p.color, raw: p.raw });
      }
    }
  }

  return { points: result, bounds };
}
