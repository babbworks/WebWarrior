/**
 * Stream Service — Dey Signal Computation
 *
 * Computes continuous behavioral signal (intensity, stability, fragmentation)
 * from stream events using configurable weights, sources, and EMA smoothing.
 */

/**
 * @typedef {Object} DeySample
 * @property {number} ts - Timestamp of sample
 * @property {number} i - Intensity [0, 1]
 * @property {number} s - Stability [0, 1]
 * @property {number} f - Fragmentation [0, 1]
 */

/**
 * @typedef {Object} DeyConfig
 * @property {Object} weights - Source-to-dimension weight mapping {source: {i, s, f}}
 * @property {Object} windows - EMA window sizes per dimension {i, s, f} in seconds
 * @property {string[]} sources - Active source signal names
 * @property {number} interval - Sampling interval in seconds
 * @property {'decay'|'suppress'|'threshold-silent'} zeroMode - Zero-activity behavior
 */

/**
 * Applies Exponential Moving Average smoothing to a series of values.
 * First smoothed value equals first raw value (no warm-up suppression).
 * @param {number[]} values - Raw values
 * @param {number} alpha - Smoothing factor (0 < alpha <= 1). Higher = less smoothing.
 * @returns {number[]} Smoothed values (same length as input)
 */
export function ema(values, alpha) {
  if (values.length === 0) return [];
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

/**
 * Clamps a value to [0, 1].
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Computes Shannon entropy of a frequency distribution (normalized to [0, 1]).
 * @param {Map<string, number>} freqMap - Map of category to count
 * @returns {number} Normalized entropy [0, 1]
 */
function shannonEntropy(freqMap) {
  const total = [...freqMap.values()].reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const categories = freqMap.size;
  if (categories <= 1) return 0;

  let entropy = 0;
  for (const count of freqMap.values()) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  // Normalize by max possible entropy (log2 of category count)
  const maxEntropy = Math.log2(categories);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Computes standard deviation of an array of numbers.
 */
function stddev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Computes raw source signal values from events within a time window.
 * Each source returns a value normalized to [0, 1].
 * @param {import('./format.js').StreamEvent[]} windowEvents - Events in the window
 * @param {import('./format.js').StreamEvent[]} allEvents - All events (for session context)
 * @param {number} windowStart - Window start timestamp
 * @param {number} windowEnd - Window end timestamp
 * @param {number} interval - Bucket interval in seconds
 * @returns {Object} Map of source name to normalized value
 */
function computeSourceValues(windowEvents, allEvents, windowStart, windowEnd, interval) {
  const windowDuration = windowEnd - windowStart || 1;
  const sources = {};

  // command_freq: event count per window, normalized by expected max (~1 event/sec)
  const maxExpectedRate = interval; // 1 event per second over interval
  sources.command_freq = clamp01(windowEvents.length / maxExpectedRate);

  // task_transitions: F op code events per window
  const fEvents = windowEvents.filter(e => e.op === 'F');
  sources.task_transitions = clamp01(fEvents.length / Math.max(interval / 30, 1));

  // dwell_time: average time between F events for same object (longer = higher stability signal)
  if (fEvents.length >= 2) {
    const gaps = [];
    for (let i = 1; i < fEvents.length; i++) {
      gaps.push(fEvents[i].ts - fEvents[i - 1].ts);
    }
    const avgGap = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    // Normalize: 300s (5min) dwell = 1.0, 0s = 0.0
    sources.dwell_time = clamp01(avgGap / 300);
  } else {
    sources.dwell_time = fEvents.length === 0 ? 0.5 : 0.8; // no transitions = moderate dwell
  }

  // entropy: Shannon entropy of project distribution
  const projMap = new Map();
  for (const e of windowEvents) {
    const proj = e.ctx?.proj || '(none)';
    projMap.set(proj, (projMap.get(proj) || 0) + 1);
  }
  sources.entropy = shannonEntropy(projMap);

  // journal_freq: A op code events per window
  const aEvents = windowEvents.filter(e => e.op === 'A');
  sources.journal_freq = clamp01(aEvents.length / Math.max(interval / 60, 1));

  // list_rate: M events with list/item actions
  const listEvents = windowEvents.filter(e =>
    e.op === 'M' && (e.action.includes('item') || e.action.includes('list'))
  );
  sources.list_rate = clamp01(listEvents.length / Math.max(interval / 60, 1));

  // idle_gap: time since last event before this window (longer = higher idle)
  const lastEventBeforeWindow = allEvents
    .filter(e => e.ts < windowStart)
    .sort((a, b) => b.ts - a.ts)[0];
  if (lastEventBeforeWindow) {
    const gap = windowStart - lastEventBeforeWindow.ts;
    // Normalize: 300s gap = 1.0
    sources.idle_gap = clamp01(gap / 300);
  } else {
    sources.idle_gap = 0;
  }

  // session_length: elapsed time from first event in session
  const firstEvent = allEvents.length > 0 ? allEvents[0] : null;
  if (firstEvent) {
    const elapsed = windowEnd - firstEvent.ts;
    // Normalize: 8 hours (28800s) = 1.0
    sources.session_length = clamp01(elapsed / 28800);
  } else {
    sources.session_length = 0;
  }

  // creation_rate: T add events per window
  const addEvents = windowEvents.filter(e => e.op === 'T' && e.action === 'add');
  sources.creation_rate = clamp01(addEvents.length / Math.max(interval / 120, 1));

  // urgency_spread: std dev of urgency values from ctx
  const urgencies = windowEvents
    .filter(e => e.ctx?.urgency != null)
    .map(e => e.ctx.urgency);
  if (urgencies.length >= 2) {
    // Normalize: stddev of 5 = 1.0
    sources.urgency_spread = clamp01(stddev(urgencies) / 5);
  } else {
    sources.urgency_spread = 0;
  }

  // nav_entropy: Shannon entropy of action distribution
  const actionMap = new Map();
  for (const e of windowEvents) {
    actionMap.set(e.action, (actionMap.get(e.action) || 0) + 1);
  }
  sources.nav_entropy = shannonEntropy(actionMap);

  return sources;
}

/**
 * Computes Dey signal samples from a set of events.
 * @param {import('./format.js').StreamEvent[]} events - Events in timestamp order
 * @param {DeyConfig} config
 * @returns {DeySample[]}
 */
export function computeDey(events, config) {
  if (events.length === 0) return [];

  const { weights, windows, sources: activeSources, interval, zeroMode } = config;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const startTs = sorted[0].ts;
  const endTs = sorted[sorted.length - 1].ts;

  if (endTs - startTs < 1) {
    // Single point in time
    const sourceVals = computeSourceValues(sorted, sorted, startTs, startTs + interval, interval);
    return [{ ts: startTs, ...computeDimensions(sourceVals, weights, activeSources) }];
  }

  // Divide into buckets
  const samples = [];
  const rawI = [];
  const rawS = [];
  const rawF = [];
  const timestamps = [];

  for (let bucketStart = startTs; bucketStart <= endTs; bucketStart += interval) {
    const bucketEnd = bucketStart + interval;
    const windowStart = Math.max(startTs, bucketStart - (windows?.i || 60));
    const windowEvents = sorted.filter(e => e.ts >= windowStart && e.ts < bucketEnd);

    // Zero-activity check
    const bucketEvents = sorted.filter(e => e.ts >= bucketStart && e.ts < bucketEnd);
    if (bucketEvents.length === 0) {
      if (zeroMode === 'suppress') continue;
      if (zeroMode === 'threshold-silent' && samples.length > 0) continue;
    }

    const sourceVals = computeSourceValues(windowEvents, sorted, bucketStart, bucketEnd, interval);
    const dims = computeDimensions(sourceVals, weights, activeSources);

    // Apply decay for zero-activity in decay mode
    if (bucketEvents.length === 0 && zeroMode === 'decay' && rawI.length > 0) {
      const decayFactor = 0.7;
      dims.i = rawI[rawI.length - 1] * decayFactor;
      dims.s = rawS[rawS.length - 1]; // stability holds
      dims.f = rawF[rawF.length - 1]; // fragmentation holds
    }

    rawI.push(dims.i);
    rawS.push(dims.s);
    rawF.push(dims.f);
    timestamps.push(bucketStart);
  }

  if (rawI.length === 0) return [];

  // Apply EMA smoothing per dimension
  const alphaI = 2 / ((windows?.i || 60) / interval + 1);
  const alphaS = 2 / ((windows?.s || 300) / interval + 1);
  const alphaF = 2 / ((windows?.f || 300) / interval + 1);

  const smoothI = ema(rawI, Math.min(alphaI, 1));
  const smoothS = ema(rawS, Math.min(alphaS, 1));
  const smoothF = ema(rawF, Math.min(alphaF, 1));

  for (let i = 0; i < timestamps.length; i++) {
    samples.push({
      ts: timestamps[i],
      i: clamp01(smoothI[i]),
      s: clamp01(smoothS[i]),
      f: clamp01(smoothF[i]),
    });
  }

  return samples;
}

/**
 * Computes i, s, f dimensions from source values using weights.
 * @param {Object} sourceVals - Map of source name to normalized value
 * @param {Object} weights - Weight mapping {source: {i, s, f}}
 * @param {string[]} activeSources - Which sources to include
 * @returns {{i: number, s: number, f: number}}
 */
function computeDimensions(sourceVals, weights, activeSources) {
  let i = 0, s = 0, f = 0;

  for (const source of activeSources) {
    const val = sourceVals[source] || 0;
    const w = weights[source];
    if (!w) continue;
    i += val * (w.i || 0);
    s += val * (w.s || 0);
    f += val * (w.f || 0);
  }

  return { i: clamp01(i), s: clamp01(s), f: clamp01(f) };
}

/**
 * Computes a single live Dey sample from recent events (main thread use).
 * @param {import('./format.js').StreamEvent[]} recentEvents - Last N events in memory
 * @param {DeyConfig} config
 * @returns {DeySample}
 */
export function computeLiveSample(recentEvents, config) {
  if (recentEvents.length === 0) {
    return { ts: Math.floor(Date.now() / 1000), i: 0, s: 0.5, f: 0 };
  }

  const { weights, sources: activeSources, interval } = config;
  const sorted = [...recentEvents].sort((a, b) => a.ts - b.ts);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - interval;
  const windowEvents = sorted.filter(e => e.ts >= windowStart);

  const sourceVals = computeSourceValues(windowEvents, sorted, windowStart, now, interval);
  const dims = computeDimensions(sourceVals, weights, activeSources);

  return { ts: now, ...dims };
}
