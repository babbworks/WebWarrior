/**
 * Stream Service — Lens Framework
 *
 * Each lens is a pure function: (events, params) → LensOutput
 * Lenses are deterministic read-only projections of stream data.
 */

import { ema } from './dey.js';

/**
 * @typedef {Object} LensOutput
 * @property {string} lens - Lens name
 * @property {Object} data - Lens-specific output data
 * @property {Object} meta - Metadata (event count, time range, etc.)
 */

/**
 * Registry of lens computation functions.
 */
export const LENSES = Object.freeze({
  burroughs: computeBurroughs,
  bundy:     computeBundy,
  frick:     computeFrick,
  felt:      computeFelt,
  dey:       computeDeyLens,
  cooper:    computeCooperLens,
});

// ── Burroughs: Raw chronological event table ─────────────────────────────────

/**
 * Burroughs: Raw event log — one row per event, chronological order.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params - {limit?: number, offset?: number}
 * @returns {LensOutput}
 */
function computeBurroughs(events, params = {}) {
  const { limit = 500, offset = 0 } = params;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const rows = sorted.slice(offset, offset + limit);

  return {
    lens: 'burroughs',
    data: { rows, total: sorted.length },
    meta: {
      eventCount: sorted.length,
      fromTs: sorted.length > 0 ? sorted[0].ts : null,
      toTs: sorted.length > 0 ? sorted[sorted.length - 1].ts : null,
      offset,
      limit,
    },
  };
}

// ── Bundy: Interval accumulation ─────────────────────────────────────────────

/**
 * Bundy: Pairs B start/stop events per object, computes accumulated duration.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params
 * @returns {LensOutput}
 */
function computeBundy(events, params = {}) {
  const bEvents = events
    .filter(e => e.op === 'B')
    .sort((a, b) => a.ts - b.ts);

  // Pair start/stop per object
  const openIntervals = new Map(); // object → start_ts
  const intervals = []; // {object, start, end, duration, proj, tags}

  for (const e of bEvents) {
    if (e.action === 'start') {
      openIntervals.set(e.object, e);
    } else if (e.action === 'stop') {
      const startEvent = openIntervals.get(e.object);
      if (startEvent) {
        intervals.push({
          object: e.object,
          start: startEvent.ts,
          end: e.ts,
          duration: e.ts - startEvent.ts,
          proj: startEvent.ctx?.proj || e.ctx?.proj || null,
          tags: startEvent.ctx?.tags || e.ctx?.tags || [],
        });
        openIntervals.delete(e.object);
      }
    }
  }

  // Include open intervals (no stop yet)
  const now = Math.floor(Date.now() / 1000);
  for (const [object, startEvent] of openIntervals) {
    intervals.push({
      object,
      start: startEvent.ts,
      end: null,
      duration: now - startEvent.ts,
      proj: startEvent.ctx?.proj || null,
      tags: startEvent.ctx?.tags || [],
      open: true,
    });
  }

  // Accumulate per object
  const accumulated = new Map();
  for (const iv of intervals) {
    if (!accumulated.has(iv.object)) {
      accumulated.set(iv.object, { object: iv.object, totalDuration: 0, segments: [], proj: iv.proj, tags: iv.tags });
    }
    const acc = accumulated.get(iv.object);
    acc.totalDuration += iv.duration;
    acc.segments.push(iv);
  }

  const result = [...accumulated.values()].sort((a, b) => b.totalDuration - a.totalDuration);

  return {
    lens: 'bundy',
    data: { intervals: result, raw: intervals },
    meta: {
      eventCount: bEvents.length,
      intervalCount: intervals.length,
      openCount: [...openIntervals.keys()].length,
    },
  };
}

// ── Frick: Discrete state transition timeline ────────────────────────────────

/**
 * Frick: Extracts F op code events as a transition timeline.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params
 * @returns {LensOutput}
 */
function computeFrick(events, params = {}) {
  const fEvents = events
    .filter(e => e.op === 'F')
    .sort((a, b) => a.ts - b.ts);

  const transitions = fEvents.map(e => ({
    ts: e.ts,
    action: e.action,
    object: e.object,
    proj: e.ctx?.proj || null,
    tags: e.ctx?.tags || [],
  }));

  // Compute transition graph (object → sequence of states)
  const graphs = new Map();
  for (const t of transitions) {
    if (!graphs.has(t.object)) graphs.set(t.object, []);
    graphs.get(t.object).push(t);
  }

  return {
    lens: 'frick',
    data: { transitions, graphs: Object.fromEntries(graphs) },
    meta: {
      eventCount: fEvents.length,
      objectCount: graphs.size,
      fromTs: fEvents.length > 0 ? fEvents[0].ts : null,
      toTs: fEvents.length > 0 ? fEvents[fEvents.length - 1].ts : null,
    },
  };
}

// ── Felt: Activity density heat map ──────────────────────────────────────────

/**
 * Felt: Divides time range into buckets, normalizes event counts.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params - {bucketSize?: number} in seconds (default 3600 = 1 hour)
 * @returns {LensOutput}
 */
function computeFelt(events, params = {}) {
  const { bucketSize = 3600 } = params;
  if (events.length === 0) {
    return { lens: 'felt', data: { buckets: [] }, meta: { eventCount: 0, maxCount: 0 } };
  }

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const startTs = sorted[0].ts;
  const endTs = sorted[sorted.length - 1].ts;

  // Create buckets
  const buckets = [];
  for (let t = startTs; t <= endTs; t += bucketSize) {
    const count = sorted.filter(e => e.ts >= t && e.ts < t + bucketSize).length;
    buckets.push({ ts: t, count, normalized: 0 });
  }

  // Normalize: max bucket = 1.0
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  for (const b of buckets) {
    b.normalized = b.count / maxCount;
  }

  return {
    lens: 'felt',
    data: { buckets, bucketSize },
    meta: {
      eventCount: sorted.length,
      maxCount,
      bucketCount: buckets.length,
      fromTs: startTs,
      toTs: endTs,
    },
  };
}

// ── Dey Lens: Time-series signal chart ───────────────────────────────────────

/**
 * Dey Lens: Extracts D op code samples, provides raw + smoothed series.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params - {alpha?: number} EMA smoothing factor
 * @returns {LensOutput}
 */
function computeDeyLens(events, params = {}) {
  const { alpha = 0.4 } = params;
  const dEvents = events
    .filter(e => e.op === 'D')
    .sort((a, b) => a.ts - b.ts);

  const raw = dEvents.map(e => ({
    ts: e.ts,
    i: e.ctx?.intensity ?? 0,
    s: e.ctx?.stability ?? 0,
    f: e.ctx?.fragmentation ?? 0,
  }));

  // Apply EMA smoothing
  const smoothedI = ema(raw.map(s => s.i), alpha);
  const smoothedS = ema(raw.map(s => s.s), alpha);
  const smoothedF = ema(raw.map(s => s.f), alpha);

  const smoothed = raw.map((s, idx) => ({
    ts: s.ts,
    i: smoothedI[idx],
    s: smoothedS[idx],
    f: smoothedF[idx],
  }));

  return {
    lens: 'dey',
    data: { samples: raw, smoothed },
    meta: {
      eventCount: dEvents.length,
      fromTs: raw.length > 0 ? raw[0].ts : null,
      toTs: raw.length > 0 ? raw[raw.length - 1].ts : null,
    },
  };
}

// ── Cooper Lens: Geometric field projection ──────────────────────────────────

/**
 * Cooper Lens: Delegates to cooper.js for geometric projection.
 * Accepts D events and produces field data for rendering.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} params - {projection?: 'polar'|'cartesian', normalize?: boolean}
 * @returns {LensOutput}
 */
function computeCooperLens(events, params = {}) {
  const { projection = 'polar', normalize = true } = params;
  const dEvents = events
    .filter(e => e.op === 'D')
    .sort((a, b) => a.ts - b.ts);

  const samples = dEvents.map(e => ({
    ts: e.ts,
    i: e.ctx?.intensity ?? 0,
    s: e.ctx?.stability ?? 0,
    f: e.ctx?.fragmentation ?? 0,
  }));

  // Compute projection inline (cooper.js will provide full implementation)
  let points;
  if (projection === 'polar') {
    points = samples.map(s => {
      // Map time-of-day to angle (0 to 2π)
      const date = new Date(s.ts * 1000);
      const secondsInDay = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
      const angle = (secondsInDay / 86400) * 2 * Math.PI;
      return { angle, radius: s.i, stability: s.s, fragmentation: s.f, ts: s.ts };
    });
  } else {
    points = samples.map(s => ({
      x: s.ts,
      y: s.i,
      stability: s.s,
      fragmentation: s.f,
      ts: s.ts,
    }));
  }

  // Normalize radius/y if requested
  if (normalize && points.length > 0) {
    const maxVal = Math.max(...points.map(p => p.radius ?? p.y ?? 0), 0.001);
    for (const p of points) {
      if (p.radius != null) p.radius /= maxVal;
      if (p.y != null) p.y /= maxVal;
    }
  }

  return {
    lens: 'cooper',
    data: {
      projection,
      points,
      bounds: {
        minR: 0,
        maxR: 1,
        minAngle: 0,
        maxAngle: 2 * Math.PI,
      },
    },
    meta: {
      eventCount: dEvents.length,
      sampleCount: samples.length,
      fromTs: samples.length > 0 ? samples[0].ts : null,
      toTs: samples.length > 0 ? samples[samples.length - 1].ts : null,
    },
  };
}
