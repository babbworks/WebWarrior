/**
 * Stream Service — Web Worker
 *
 * Runs in a Worker context. Handles replay, Dey computation,
 * and Cooper projection requests from the main thread.
 * Has direct access to OPFS for reading the log file.
 */

import { parse } from './format.js';
import { computeDey } from './dey.js';
import { LENSES } from './lenses.js';
import { polarProject, cartesianProject } from './cooper.js';

/**
 * Reads the OPFS log file for a profile and returns parsed events.
 * @param {string} profile
 * @param {number|null} fromTs - Start timestamp filter (inclusive)
 * @param {number|null} toTs - End timestamp filter (inclusive)
 * @returns {Promise<import('./format.js').StreamEvent[]>}
 */
async function readLogEvents(profile, fromTs = null, toTs = null) {
  const fileName = `stream_${profile}.log`;
  const dir = await navigator.storage.getDirectory();

  let fileHandle;
  try {
    fileHandle = await dir.getFileHandle(fileName, { create: false });
  } catch {
    return []; // File doesn't exist
  }

  const file = await fileHandle.getFile();
  const content = await file.text();
  const lines = content.split('\n').filter(line => line.length > 0);
  const events = [];

  for (const line of lines) {
    const result = parse(line);
    if (!result.ok) continue;
    const event = result.event;
    if (fromTs !== null && event.ts < fromTs) continue;
    if (toTs !== null && event.ts > toTs) continue;
    events.push(event);
  }

  return events;
}

/**
 * Applies a bus-style filter to events.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {Object} filters - {op, object, prof, proj, tags}
 * @param {string} profile
 * @returns {import('./format.js').StreamEvent[]}
 */
function applyFilters(events, filters, profile) {
  if (!filters) return events;

  return events.filter(e => {
    if (filters.op && filters.op !== e.op) return false;
    if (filters.object && filters.object !== e.object) return false;
    if (filters.prof && filters.prof !== profile) return false;
    if (filters.proj && filters.proj !== e.ctx?.proj) return false;
    if (filters.tags && Array.isArray(filters.tags)) {
      const eventTags = e.ctx?.tags;
      if (!Array.isArray(eventTags)) return false;
      if (!filters.tags.some(tag => eventTags.includes(tag))) return false;
    }
    return true;
  });
}

/**
 * Main message handler — dispatches by message type.
 */
self.onmessage = async (e) => {
  const { type, id } = e.data;

  try {
    switch (type) {
      case 'replay': {
        const { profile, from_ts, to_ts, filters, lens } = e.data;
        const events = await readLogEvents(profile, from_ts, to_ts);
        const filtered = applyFilters(events, filters, profile);

        const lensName = lens || 'burroughs';
        const lensFn = LENSES[lensName];
        if (!lensFn) {
          self.postMessage({ type: 'error', id, message: `Unknown lens: ${lensName}`, source: 'replay' });
          return;
        }

        const result = lensFn(filtered, e.data.params || {});
        self.postMessage({ type: 'replay-result', id, lens: lensName, ...result });
        break;
      }

      case 'compute-dey': {
        const { profile, from_ts, to_ts, config } = e.data;
        const events = await readLogEvents(profile, from_ts, to_ts);

        const samples = computeDey(events, config);
        self.postMessage({ type: 'dey-result', id, samples });
        break;
      }

      case 'compute-cooper': {
        const { profile, from_ts, to_ts, params } = e.data;
        const events = await readLogEvents(profile, from_ts, to_ts);

        // Extract Dey samples from D events
        const deySamples = events
          .filter(ev => ev.op === 'D')
          .map(ev => ({
            ts: ev.ts,
            i: ev.ctx?.intensity ?? 0,
            s: ev.ctx?.stability ?? 0,
            f: ev.ctx?.fragmentation ?? 0,
          }));

        const projection = params?.projection || 'polar';
        const field = projection === 'polar'
          ? polarProject(deySamples, params)
          : cartesianProject(deySamples, params);

        self.postMessage({ type: 'cooper-result', id, field });
        break;
      }

      case 'snapshot': {
        const { profile } = e.data;
        const events = await readLogEvents(profile);
        // Snapshot = summary of current state
        const snapshot = {
          eventCount: events.length,
          lastTs: events.length > 0 ? events[events.length - 1].ts : null,
          opCounts: {},
        };
        for (const ev of events) {
          snapshot.opCounts[ev.op] = (snapshot.opCounts[ev.op] || 0) + 1;
        }
        self.postMessage({ type: 'snapshot-result', id, success: true, ts: Math.floor(Date.now() / 1000), snapshot });
        break;
      }

      default:
        self.postMessage({ type: 'error', id, message: `Unknown message type: ${type}`, source: 'worker' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message || String(err), source: type || 'unknown' });
  }
};
