/**
 * Stream Service — Export Functions
 *
 * Exports stream data as .log (canonical Hollerith lines) or JSON
 * with optional time-range filtering.
 */

import { readAll } from './log.js';
import { parse } from './format.js';

/**
 * Exports the raw log as a .log file for a time range.
 * @param {string} profile
 * @param {number|null} fromTs - Start timestamp (null = beginning)
 * @param {number|null} toTs - End timestamp (null = end)
 * @returns {Promise<Blob>} .log file blob
 */
export async function exportLog(profile, fromTs = null, toTs = null) {
  const content = await readAll(profile);
  const lines = content.split('\n').filter(line => line.length > 0);

  let filtered;
  if (fromTs === null && toTs === null) {
    filtered = lines;
  } else {
    filtered = lines.filter(line => {
      const result = parse(line);
      if (!result.ok) return true; // Include unparseable lines (like header)
      const ts = result.event.ts;
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      return true;
    });
  }

  const output = filtered.join('\n') + '\n';
  return new Blob([output], { type: 'text/plain;charset=utf-8' });
}

/**
 * Exports stream data as structured JSON for a time range.
 * @param {string} profile
 * @param {number|null} fromTs - Start timestamp (null = beginning)
 * @param {number|null} toTs - End timestamp (null = end)
 * @returns {Promise<string>} JSON string with metadata and events
 */
export async function exportJSON(profile, fromTs = null, toTs = null) {
  const content = await readAll(profile);
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

  const exported = {
    format: 'webwarrior-stream',
    version: 'v0',
    exported: new Date().toISOString(),
    profile,
    from_ts: fromTs,
    to_ts: toTs,
    event_count: events.length,
    events,
  };

  return JSON.stringify(exported, null, 2);
}
