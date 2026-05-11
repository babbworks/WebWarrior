/**
 * Stream Service — Session Detection
 *
 * Detects session boundaries from event gaps.
 * A session is a contiguous period of activity bounded by
 * inactivity gaps exceeding the configured threshold.
 */

/**
 * @typedef {Object} Session
 * @property {number} start - Session start timestamp
 * @property {number} end - Session end timestamp (or null if open)
 * @property {number} eventCount - Number of events in this session
 * @property {number} duration - Duration in seconds
 */

/**
 * Detects session boundaries from a sorted event sequence.
 * A new session starts when the gap between consecutive events
 * exceeds the threshold.
 * @param {import('./format.js').StreamEvent[]} events - Events sorted by ts ascending
 * @param {number} gapThreshold - Inactivity gap in seconds that triggers a new session
 * @returns {Session[]}
 */
export function detectSessions(events, gapThreshold = 300) {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const sessions = [];
  let sessionStart = sorted[0].ts;
  let sessionEventCount = 1;
  let lastTs = sorted[0].ts;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].ts - lastTs;

    if (gap > gapThreshold) {
      // Close previous session
      sessions.push({
        start: sessionStart,
        end: lastTs,
        eventCount: sessionEventCount,
        duration: lastTs - sessionStart,
      });
      // Start new session
      sessionStart = sorted[i].ts;
      sessionEventCount = 1;
    } else {
      sessionEventCount++;
    }

    lastTs = sorted[i].ts;
  }

  // Close final session (open if it's recent)
  const now = Math.floor(Date.now() / 1000);
  const isOpen = (now - lastTs) < gapThreshold;

  sessions.push({
    start: sessionStart,
    end: isOpen ? null : lastTs,
    eventCount: sessionEventCount,
    duration: (isOpen ? now : lastTs) - sessionStart,
  });

  return sessions;
}

/**
 * Returns the current (most recent) session, or null if no events.
 * @param {import('./format.js').StreamEvent[]} events
 * @param {number} gapThreshold
 * @returns {Session|null}
 */
export function getCurrentSession(events, gapThreshold = 300) {
  const sessions = detectSessions(events, gapThreshold);
  return sessions.length > 0 ? sessions[sessions.length - 1] : null;
}

/**
 * Determines if a new session should be started based on the last event time.
 * @param {number|null} lastEventTs - Timestamp of the last event (null if no events)
 * @param {number} gapThreshold - Gap threshold in seconds
 * @returns {boolean} True if a new session should be started
 */
export function shouldStartNewSession(lastEventTs, gapThreshold = 300) {
  if (lastEventTs === null) return true;
  const now = Math.floor(Date.now() / 1000);
  return (now - lastEventTs) > gapThreshold;
}
