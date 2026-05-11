/**
 * Viz Gallery — Rendering Pipeline
 *
 * Implements the staged rendering pipeline for gallery compositions.
 * Stages: fetch → bucket → aggregate → normalize → layout → render → annotate
 *
 * This module currently exports bucketing and aggregation stages.
 * Normalization, layout delegation, renderer delegation, and the full
 * pipeline orchestrator will be added in subsequent tasks.
 */

import { GRANULARITY_SECONDS, resolveAutoGranularity } from './registry.js';

// --- Static module imports for layouts and renderers ---
// (Dynamic imports with template literals don't work in bundler-free ES module environments)
import { position as timelinePosition } from './layouts/timeline.js';
import { position as gridPosition } from './layouts/grid.js';
import { position as radialPosition } from './layouts/radial.js';
import { position as waterfallPosition } from './layouts/waterfall.js';
import { position as swimLanesPosition } from './layouts/swim-lanes.js';
import { position as fieldPosition } from './layouts/field.js';

import { draw as barsDraw } from './renderers/bars.js';
import { draw as glyphsDraw } from './renderers/glyphs.js';
import { draw as charactersDraw } from './renderers/characters.js';
import { draw as blocksDraw } from './renderers/blocks.js';
import { draw as sparklineDraw } from './renderers/sparkline.js';

import { overlayAnnotations } from './annotations.js';

const LAYOUT_MODULES = {
  'timeline': { position: timelinePosition },
  'grid': { position: gridPosition },
  'radial': { position: radialPosition },
  'waterfall': { position: waterfallPosition },
  'swim-lanes': { position: swimLanesPosition },
  'field': { position: fieldPosition },
};

const RENDERER_MODULES = {
  'bars': { draw: barsDraw },
  'glyphs': { draw: glyphsDraw },
  'characters': { draw: charactersDraw },
  'blocks': { draw: blocksDraw },
  'sparkline': { draw: sparklineDraw },
};

// --- Bucketing Stage ---

/**
 * Groups stream events into time-slice buckets of the specified granularity.
 *
 * @param {import('../stream/format.js').StreamEvent[]} events - Array of stream events
 * @param {string} granularity - Granularity key ('1min','5min','15min','1hr','4hr','1day','auto')
 * @param {number} timeRangeSeconds - Duration of the active time range in seconds
 * @returns {{buckets: Array<{ts: number, events: import('../stream/format.js').StreamEvent[]}>, bucketSize: number}}
 */
export function bucketEvents(events, granularity, timeRangeSeconds) {
  // Resolve auto granularity if needed
  const resolvedGranularity = granularity === 'auto'
    ? resolveAutoGranularity(timeRangeSeconds)
    : granularity;

  const bucketSize = GRANULARITY_SECONDS[resolvedGranularity];

  // Handle empty events
  if (!events || events.length === 0) {
    return { buckets: [], bucketSize };
  }

  // Find min and max timestamps
  let minTs = events[0].ts;
  let maxTs = events[0].ts;
  for (let i = 1; i < events.length; i++) {
    if (events[i].ts < minTs) minTs = events[i].ts;
    if (events[i].ts > maxTs) maxTs = events[i].ts;
  }

  // Create buckets from min to max
  const buckets = [];
  const bucketStart = Math.floor(minTs / bucketSize) * bucketSize;
  const bucketEnd = Math.floor(maxTs / bucketSize) * bucketSize;

  for (let ts = bucketStart; ts <= bucketEnd; ts += bucketSize) {
    buckets.push({ ts, events: [] });
  }

  // Assign events to buckets
  for (const event of events) {
    const bucketIndex = Math.floor((event.ts - bucketStart) / bucketSize);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].events.push(event);
    }
  }

  return { buckets, bucketSize };
}

// --- Aggregation Stage ---

/**
 * Computes Shannon entropy of op-code distribution, normalized to [0, 1].
 * Uses log2(numUniqueOps) as the maximum possible entropy for normalization.
 *
 * @param {import('../stream/format.js').StreamEvent[]} events
 * @returns {number} Normalized entropy in [0, 1]
 */
function shannonEntropy(events) {
  if (events.length === 0) return 0;

  const counts = {};
  for (const e of events) {
    counts[e.op] = (counts[e.op] || 0) + 1;
  }

  const total = events.length;
  const uniqueOps = Object.keys(counts).length;
  if (uniqueOps <= 1) return 0;

  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  // Normalize to [0, 1]
  return entropy / Math.log2(uniqueOps);
}

/**
 * Aggregates bucketed data using the specified aggregation function.
 * Produces a single numeric value per bucket.
 *
 * @param {{buckets: Array<{ts: number, events: import('../stream/format.js').StreamEvent[]}>, bucketSize: number}} bucketedData
 * @param {string} aggregation - 'count'|'max'|'mean'|'mode'|'entropy'
 * @returns {{points: Array<{ts: number, value: number, opMode?: string, entropy?: number}>, aggregation: string}}
 */
export function aggregate(bucketedData, aggregation) {
  const { buckets } = bucketedData;
  const points = [];

  for (const bucket of buckets) {
    const { ts, events } = bucket;
    let value = 0;
    let opMode;
    let entropy;

    switch (aggregation) {
      case 'count':
        value = events.length;
        break;

      case 'max': {
        // Maximum of Dey intensity values (from ctx.intensity), or event count if no Dey data
        const intensities = events
          .filter(e => e.ctx && typeof e.ctx.intensity === 'number')
          .map(e => e.ctx.intensity);
        value = intensities.length > 0 ? Math.max(...intensities) : events.length;
        break;
      }

      case 'mean': {
        // Average of Dey intensity values, or event count / bucket capacity
        const intensities = events
          .filter(e => e.ctx && typeof e.ctx.intensity === 'number')
          .map(e => e.ctx.intensity);
        if (intensities.length > 0) {
          value = intensities.reduce((sum, v) => sum + v, 0) / intensities.length;
        } else {
          value = events.length;
        }
        break;
      }

      case 'mode': {
        // Most frequent op-code in the bucket
        if (events.length === 0) {
          value = 0;
          opMode = undefined;
        } else {
          const counts = {};
          for (const e of events) {
            counts[e.op] = (counts[e.op] || 0) + 1;
          }
          let maxCount = 0;
          let modeOp = '';
          for (const [op, count] of Object.entries(counts)) {
            if (count > maxCount) {
              maxCount = count;
              modeOp = op;
            }
          }
          value = maxCount;
          opMode = modeOp;
        }
        break;
      }

      case 'entropy': {
        // Shannon entropy of op-code distribution, normalized to [0, 1]
        entropy = shannonEntropy(events);
        value = entropy;
        break;
      }

      default:
        value = events.length;
        break;
    }

    const point = { ts, value };
    if (opMode !== undefined) point.opMode = opMode;
    if (entropy !== undefined) point.entropy = entropy;
    points.push(point);
  }

  return { points, aggregation };
}

// --- Normalization Stage ---

/**
 * Categorical dimensions that map to evenly-spaced [0,1] values
 * rather than continuous min/max normalization.
 */
const CATEGORICAL_DIMENSIONS = ['op-code', 'project'];

/**
 * Computes the arithmetic mean of numeric values extracted from events.
 * Returns 0 if no valid values are found.
 *
 * @param {Array} events - Array of stream events
 * @param {function} accessor - Function to extract a numeric value from an event
 * @returns {number}
 */
function meanOf(events, accessor) {
  let sum = 0;
  let count = 0;
  for (const e of events) {
    const v = accessor(e);
    if (typeof v === 'number' && !Number.isNaN(v)) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Returns the most frequent value (mode) extracted from events.
 * Returns null if no valid values are found.
 *
 * @param {Array} events - Array of stream events
 * @param {function} accessor - Function to extract a categorical value from an event
 * @returns {string|null}
 */
function modeOf(events, accessor) {
  const counts = {};
  for (const e of events) {
    const v = accessor(e);
    if (v != null) {
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  let maxCount = 0;
  let modeVal = null;
  for (const [val, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      modeVal = val;
    }
  }
  return modeVal;
}

/**
 * Extracts a single representative value for a given dimension from a set of events.
 * For continuous dimensions, returns the mean. For categorical dimensions, returns the mode string.
 *
 * @param {Array} events - Array of stream events in a bucket
 * @param {string} dimension - Binding dimension name
 * @returns {number|string|null}
 */
function extractDimensionValue(events, dimension) {
  if (!events || events.length === 0) return null;

  switch (dimension) {
    case 'intensity':
      return meanOf(events, e => e.ctx?.intensity);
    case 'stability':
      return meanOf(events, e => e.ctx?.stability);
    case 'fragmentation':
      return meanOf(events, e => e.ctx?.fragmentation);
    case 'duration':
      return meanOf(events, e => e.ctx?.duration);
    case 'op-code':
      return modeOf(events, e => e.op);
    case 'project':
      return modeOf(events, e => e.ctx?.proj);
    default:
      return null;
  }
}

/**
 * Normalizes an array of continuous numeric values to [0, 1].
 *
 * @param {number[]} values - Raw numeric values
 * @param {string} mode - 'relative' or 'absolute'
 * @param {number} allTimeMax - The all-time maximum value (used for absolute mode)
 * @returns {number[]} Normalized values in [0, 1]
 */
function normalizeContinuous(values, mode, allTimeMax) {
  if (values.length === 0) return [];

  let min, max;
  if (mode === 'absolute') {
    min = 0;
    max = allTimeMax;
  } else {
    // Relative: use visible data range
    min = values[0];
    max = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
  }

  const range = max - min;
  if (range === 0) {
    // All values are the same — map to 0.5 for relative, or compute ratio for absolute
    if (mode === 'absolute' && max > 0) {
      const ratio = min / max;
      return values.map(() => Math.min(1, Math.max(0, ratio)));
    }
    return values.map(() => 0);
  }

  return values.map(v => Math.min(1, Math.max(0, (v - min) / range)));
}

/**
 * Normalizes an array of categorical values to evenly-spaced [0, 1] positions.
 * Each unique category gets a fixed position: for N categories, positions are
 * 0, 1/(N-1), 2/(N-1), ..., 1. If only one category exists, maps to 0.
 *
 * @param {Array<string|null>} values - Categorical values
 * @returns {number[]} Normalized values in [0, 1]
 */
function normalizeCategorical(values) {
  if (values.length === 0) return [];

  // Collect unique categories in order of first appearance
  const seen = new Map();
  for (const v of values) {
    const key = v ?? '__null__';
    if (!seen.has(key)) {
      seen.set(key, seen.size);
    }
  }

  const numCategories = seen.size;
  if (numCategories <= 1) {
    return values.map(() => 0);
  }

  const step = 1 / (numCategories - 1);
  return values.map(v => {
    const key = v ?? '__null__';
    return seen.get(key) * step;
  });
}

/**
 * Normalizes aggregated data producing [0,1] values for primary, texture, and color channels.
 * Supports both relative (visible range) and absolute (allTimeMax) normalization modes.
 * Handles multi-bind by computing independent normalized arrays for each active binding dimension.
 *
 * For continuous dimensions (intensity, stability, fragmentation, duration):
 *   - relative mode: normalize to [0,1] using min/max of the visible data
 *   - absolute mode: normalize using 0 as min and allTimeMax as max
 *
 * For categorical dimensions (op-code, project):
 *   - Map each unique category to an evenly-spaced value in [0,1]
 *
 * @param {Object} aggregatedData - Output from aggregate(): {points: [{ts, value, opMode?, entropy?}], aggregation}
 * @param {Object} bucketedData - Output from bucketEvents(): {buckets: [{ts, events[]}], bucketSize}
 * @param {Object} composition - Composition object with binding, textureBind, colorBind, normalization
 * @param {number} allTimeMax - The all-time maximum value for absolute normalization
 * @returns {{points: Array<{ts: number, primary: number, texture?: number, color?: number, raw: Object}>, normalization: string}}
 */
export function normalizeBindings(aggregatedData, bucketedData, composition, allTimeMax) {
  const { points } = aggregatedData;
  const { buckets } = bucketedData;
  const normMode = composition.normalization || 'relative';
  const primaryDimension = composition.binding;
  const textureDimension = composition.textureBind || null;
  const colorDimension = composition.colorBind || null;

  // Handle empty data
  if (!points || points.length === 0) {
    return { points: [], normalization: normMode };
  }

  // Extract raw values for each channel
  const primaryRaw = [];
  const textureRaw = textureDimension ? [] : null;
  const colorRaw = colorDimension ? [] : null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const bucket = buckets[i] || { events: [] };
    const events = bucket.events || [];

    // Primary channel: use the aggregated value for continuous primary bindings,
    // or extract from events for categorical
    if (CATEGORICAL_DIMENSIONS.includes(primaryDimension)) {
      // For categorical primary, extract from events
      primaryRaw.push(extractDimensionValue(events, primaryDimension));
    } else {
      // For continuous primary, use the pre-aggregated value
      primaryRaw.push(point.value);
    }

    // Texture channel: extract from bucket events
    if (textureDimension) {
      textureRaw.push(extractDimensionValue(events, textureDimension));
    }

    // Color channel: extract from bucket events
    if (colorDimension) {
      colorRaw.push(extractDimensionValue(events, colorDimension));
    }
  }

  // Normalize each channel independently
  const primaryNorm = CATEGORICAL_DIMENSIONS.includes(primaryDimension)
    ? normalizeCategorical(primaryRaw)
    : normalizeContinuous(primaryRaw, normMode, allTimeMax);

  const textureNorm = textureDimension
    ? (CATEGORICAL_DIMENSIONS.includes(textureDimension)
        ? normalizeCategorical(textureRaw)
        : normalizeContinuous(textureRaw, normMode, allTimeMax))
    : null;

  const colorNorm = colorDimension
    ? (CATEGORICAL_DIMENSIONS.includes(colorDimension)
        ? normalizeCategorical(colorRaw)
        : normalizeContinuous(colorRaw, normMode, allTimeMax))
    : null;

  // Build output points
  const normalizedPoints = [];
  for (let i = 0; i < points.length; i++) {
    const out = {
      ts: points[i].ts,
      primary: primaryNorm[i],
      raw: { ...points[i] },
    };
    if (textureNorm) out.texture = textureNorm[i];
    if (colorNorm) out.color = colorNorm[i];
    normalizedPoints.push(out);
  }

  return { points: normalizedPoints, normalization: normMode };
}

// --- Pipeline Orchestrator ---

/**
 * @typedef {Object} PipelineInput
 * @property {import('./registry.js').Composition} composition
 * @property {import('../stream/format.js').StreamEvent[]} events
 * @property {number} timeRangeSeconds - Duration of active time range
 * @property {boolean} asciiMode
 * @property {number} [allTimeMax] - All-time maximum for absolute normalization (optional, defaults to 1)
 */

/**
 * Executes the full rendering pipeline for a composition.
 * Stages: bucket → aggregate → normalize → layout → render → annotate
 *
 * @param {PipelineInput} input - {composition, events, timeRangeSeconds, asciiMode, allTimeMax?}
 * @param {HTMLElement} container - Target element for rendering
 * @returns {Promise<void>}
 */
export async function render(input, container) {
  const { composition, events, timeRangeSeconds, asciiMode, allTimeMax = 1 } = input;

  if (!container) return;

  try {
    // Stage 1: Bucket events
    const bucketedData = bucketEvents(events, composition.granularity, timeRangeSeconds);

    // Stage 2: Aggregate
    const aggregatedData = aggregate(bucketedData, composition.aggregation);

    // Stage 3: Normalize
    const normalizedData = normalizeBindings(aggregatedData, bucketedData, composition, allTimeMax);

    // Stage 4: Layout positioning
    let positionedData;
    try {
      const layoutModule = LAYOUT_MODULES[composition.layout];
      if (!layoutModule) throw new Error(`Unknown layout: ${composition.layout}`);
      const bounds = { width: container.clientWidth || 400, height: container.clientHeight || 300 };
      positionedData = layoutModule.position(normalizedData, {
        orientation: composition.orientation,
        density: composition.density,
        bounds,
      });
    } catch (err) {
      container.innerHTML = `<div class="viz-pipeline-error">Layout "${composition.layout}" not available: ${err.message}</div>`;
      return;
    }

    // Stage 5: Renderer drawing
    try {
      const rendererModule = RENDERER_MODULES[composition.renderer];
      if (!rendererModule) throw new Error(`Unknown renderer: ${composition.renderer}`);
      const channels = {
        primary: composition.binding,
        texture: composition.texture,
        textureBind: composition.textureBind,
        color: composition.color,
        colorBind: composition.colorBind,
      };
      rendererModule.draw(positionedData, channels, container, asciiMode);
    } catch (err) {
      container.innerHTML = `<div class="viz-pipeline-error">Renderer "${composition.renderer}" not available: ${err.message}</div>`;
      return;
    }

    // Stage 6: Annotation overlay
    if (composition.annotation && composition.annotation !== 'none') {
      try {
        overlayAnnotations(container, positionedData, normalizedData, composition.annotation, composition);
      } catch (err) {
        // Annotations are non-critical — log but don't fail the render
        console.warn('[Viz Pipeline] Annotations skipped:', err.message);
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="viz-pipeline-error">Pipeline error: ${err.message}</div>`;
  }
}
