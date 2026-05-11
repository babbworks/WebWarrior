/**
 * Stream Service — Replay Coordinator (Main Thread)
 *
 * Manages the Web Worker lifecycle and provides a promise-based
 * interface for replay, Dey computation, and Cooper projection.
 */

let worker = null;
let requestId = 0;
const pending = new Map(); // id → {resolve, reject, timer}

const TIMEOUT_MS = 30000; // 30 second timeout

/**
 * Initializes the Web Worker and sets up message handling.
 * @returns {Promise<void>}
 */
export async function init() {
  if (worker) return;

  worker = new Worker(
    new URL('./worker.js', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = (e) => {
    const { id, type } = e.data;
    const entry = pending.get(id);
    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(id);

    if (type === 'error') {
      entry.reject(new Error(e.data.message || 'Worker error'));
    } else {
      entry.resolve(e.data);
    }
  };

  worker.onerror = (err) => {
    console.error('[Stream Replay] Worker error:', err);
    // Reject all pending requests
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Worker crashed'));
    }
    pending.clear();
    // Attempt restart
    worker = null;
  };
}

/**
 * Sends a message to the worker and returns a promise for the response.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function send(message) {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized. Call init() first.'));
  }

  const id = ++requestId;
  message.id = id;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Worker request timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    worker.postMessage(message);
  });
}

/**
 * Requests a replay for a time range with optional lens and filters.
 * @param {string} profile
 * @param {number} fromTs
 * @param {number} toTs
 * @param {string} lens - Lens name (burroughs, bundy, frick, felt, dey, cooper)
 * @param {Object} filters - {op, object, prof, proj, tags}
 * @param {Object} params - Lens-specific parameters
 * @returns {Promise<Object>} LensOutput
 */
export async function replay(profile, fromTs, toTs, lens = 'burroughs', filters = null, params = {}) {
  return send({ type: 'replay', profile, from_ts: fromTs, to_ts: toTs, lens, filters, params });
}

/**
 * Requests Dey signal computation for a time range.
 * @param {string} profile
 * @param {number} fromTs
 * @param {number} toTs
 * @param {Object} config - Dey configuration
 * @returns {Promise<{samples: Array}>}
 */
export async function computeDey(profile, fromTs, toTs, config) {
  return send({ type: 'compute-dey', profile, from_ts: fromTs, to_ts: toTs, config });
}

/**
 * Requests Cooper projection computation.
 * @param {string} profile
 * @param {number} fromTs
 * @param {number} toTs
 * @param {Object} params - Projection parameters
 * @returns {Promise<{field: Object}>}
 */
export async function computeCooper(profile, fromTs, toTs, params = {}) {
  return send({ type: 'compute-cooper', profile, from_ts: fromTs, to_ts: toTs, params });
}

/**
 * Requests a snapshot of current state.
 * @param {string} profile
 * @returns {Promise<Object>}
 */
export async function createSnapshot(profile) {
  return send({ type: 'snapshot', profile });
}

/**
 * Terminates the worker and cleans up.
 */
export function terminate() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error('Worker terminated'));
  }
  pending.clear();
}
