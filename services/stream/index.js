/**
 * Stream Service — Public API
 *
 * Entry point for the Stream service. Initializes all layers,
 * manages lifecycle, and re-exports sub-module APIs.
 */

import { initLog, append, getSize, deleteLog } from './log.js';
import { bus } from './bus.js';
import * as Replay from './replay.js';
import { getConfig, setConfig, isEnabled, setEnabled } from './config.js';
import { setActive, setProfile, registerAll, isActive } from './intercept.js';
import { createEvent, format, parse, validate, OP_CODES } from './format.js';
import { exportLog, exportJSON } from './export.js';
import { computeLiveSample } from './dey.js';
import { detectSessions, getCurrentSession, shouldStartNewSession } from './session.js';

let _initialized = false;
let _profile = null;
let _lastEventTs = null;
let _samplingTimer = null;
let _recentEvents = [];
let _lastSample = null;
let _busUnsubscribe = null;
let _readOnly = false;
let _tabId = null;
let _broadcastChannel = null;
let _eventsSinceSnapshot = 0;
let _lastSnapshotTs = 0;

/**
 * Initializes the stream service for a profile.
 * - Opens/creates OPFS log
 * - Loads config
 * - Starts worker
 * - Sets up interception state
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function init(profile) {
  _profile = profile;

  const enabled = await isEnabled(profile);
  if (!enabled) {
    _initialized = false;
    setActive(false);
    return;
  }

  // Multi-tab conflict detection
  _tabId = crypto.randomUUID();
  _broadcastChannel = new BroadcastChannel('ww-stream-lock');
  _broadcastChannel.postMessage({ type: 'claim', profile, tabId: _tabId });
  _broadcastChannel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'claim' && msg.profile === _profile && msg.tabId !== _tabId) {
      _readOnly = true;
    }
  };

  await initLog(profile);
  await Replay.init();
  setProfile(profile);
  setActive(true);
  _initialized = true;

  // Load config for snapshot thresholds
  const config = await getConfig(profile);

  // Subscribe to all events to maintain rolling buffer
  _busUnsubscribe = bus.subscribe({}, (event) => {
    _recentEvents.push(event);
    if (_recentEvents.length > 200) {
      _recentEvents.shift();
    }

    // Snapshot auto-trigger
    _eventsSinceSnapshot++;
    const nowSec = Math.floor(Date.now() / 1000);
    if (_eventsSinceSnapshot >= config.snapshot_events) {
      snapshot(profile);
    } else if (_lastSnapshotTs > 0 && (nowSec - _lastSnapshotTs) >= config.snapshot_minutes * 60) {
      snapshot(profile);
    }
  });

  // Start the Dey sampling loop
  await startSampling(profile);
}

/**
 * Starts the periodic Dey sampling loop.
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function startSampling(profile) {
  stopSampling();
  if (!_initialized) return;

  const config = await getConfig(profile);
  const interval = (config.dey_interval || 60) * 1000;
  const zeroMode = config.zero_activity_mode || 'suppress';

  let _eventsAtLastSample = 0;

  _samplingTimer = setInterval(async () => {
    if (_readOnly) return; // Skip appends in read-only mode
    try {
      const eventsSinceLastSample = _recentEvents.length - _eventsAtLastSample;
      _eventsAtLastSample = _recentEvents.length;

      let sample;

      if (eventsSinceLastSample === 0) {
        // No new events since last sample
        if (zeroMode === 'suppress') return;
        if (zeroMode === 'decay') {
          if (_lastSample) {
            sample = {
              ts: Math.floor(Date.now() / 1000),
              i: _lastSample.i * 0.7,
              s: _lastSample.s,
              f: _lastSample.f,
            };
          } else {
            return;
          }
        }
      }

      if (!sample) {
        sample = computeLiveSample(_recentEvents, config);
      }

      _lastSample = sample;

      const event = createEvent('D', 'sample', 'session-' + new Date().toISOString().slice(0, 10), {
        intensity: sample.i,
        stability: sample.s,
        fragmentation: sample.f,
        prof: profile,
      });
      const line = format(event);
      await append(profile, line);
      bus.emit(event, profile);
    } catch (err) {
      console.warn('[Stream] Sampling error:', err);
    }
  }, interval);
}

/**
 * Stops the periodic Dey sampling loop.
 */
export function stopSampling() {
  if (_samplingTimer !== null) {
    clearInterval(_samplingTimer);
    _samplingTimer = null;
  }
}

/**
 * Shuts down the stream service.
 * - Terminates worker
 * - Clears bus subscriptions
 */
export async function shutdown() {
  stopSampling();
  if (_busUnsubscribe) {
    _busUnsubscribe();
    _busUnsubscribe = null;
  }
  if (_broadcastChannel) {
    _broadcastChannel.close();
    _broadcastChannel = null;
  }
  Replay.terminate();
  bus.clear();
  setActive(false);
  _initialized = false;
  _profile = null;
  _lastEventTs = null;
  _recentEvents = [];
  _lastSample = null;
  _readOnly = false;
  _tabId = null;
  _eventsSinceSnapshot = 0;
  _lastSnapshotTs = 0;
}

/**
 * Toggles stream on/off with appropriate events.
 * @param {string} profile
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function toggle(profile, enabled) {
  if (enabled) {
    await setEnabled(profile, true);
    await initLog(profile);
    await Replay.init();
    setProfile(profile);
    setActive(true);
    _initialized = true;

    // Subscribe to all events to maintain rolling buffer
    if (!_busUnsubscribe) {
      _busUnsubscribe = bus.subscribe({}, (event) => {
        _recentEvents.push(event);
        if (_recentEvents.length > 200) {
          _recentEvents.shift();
        }
      });
    }

    // Emit stream-init event
    const event = createEvent('S', 'stream-init', 'stream.log', { prof: profile });
    const line = format(event);
    await append(profile, line);
    bus.emit(event, profile);
    _lastEventTs = event.ts;

    // Start sampling
    await startSampling(profile);
  } else {
    // Stop sampling before disabling
    stopSampling();

    // Emit stream-halt event before disabling
    if (_initialized) {
      const event = createEvent('S', 'stream-halt', 'stream.log', { prof: profile });
      const line = format(event);
      await append(profile, line);
      bus.emit(event, profile);
    }

    if (_busUnsubscribe) {
      _busUnsubscribe();
      _busUnsubscribe = null;
    }
    setActive(false);
    await setEnabled(profile, false);
    Replay.terminate();
    bus.clear();
    _initialized = false;
    _recentEvents = [];
    _lastSample = null;
  }
}

/**
 * Emits a session-start event if needed (called on first interaction after gap).
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function checkSessionStart(profile) {
  if (!_initialized) return;

  if (shouldStartNewSession(_lastEventTs, (await getConfig(profile)).gap_threshold)) {
    const event = createEvent('S', 'session-start', 'stream.log', { prof: profile });
    const line = format(event);
    await append(profile, line);
    bus.emit(event, profile);
    _lastEventTs = event.ts;
  }
}

/**
 * Records the timestamp of the last event (called by intercept layer).
 * @param {number} ts
 */
export function recordEventTime(ts) {
  _lastEventTs = ts;
}

/**
 * Manually triggers a snapshot.
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function snapshot(profile) {
  if (!_initialized) return;

  _eventsSinceSnapshot = 0;
  _lastSnapshotTs = Math.floor(Date.now() / 1000);

  const result = await Replay.createSnapshot(profile);
  const event = createEvent('S', 'snapshot', 'stream.log', {
    prof: profile,
    event_count: result.snapshot?.eventCount || 0,
  });
  const line = format(event);
  await append(profile, line);
  bus.emit(event, profile);
}

/**
 * Resets the stream (requires confirmation token === profile name).
 * @param {string} profile
 * @param {string} confirmToken - Must equal profile name
 * @returns {Promise<void>}
 */
export async function reset(profile, confirmToken) {
  if (confirmToken !== profile) {
    throw new Error('Reset confirmation failed: token must equal profile name');
  }

  // Emit reset event as final entry
  if (_initialized) {
    const event = createEvent('S', 'reset', 'stream.log', { prof: profile, reason: 'user-initiated' });
    const line = format(event);
    await append(profile, line);
  }

  // Delete and recreate
  Replay.terminate();
  bus.clear();
  setActive(false);

  try {
    await deleteLog(profile);
  } catch { /* file may not exist */ }

  // Reinitialize with fresh header
  await initLog(profile);
  _lastEventTs = null;

  const enabled = await isEnabled(profile);
  if (enabled) {
    await Replay.init();
    setProfile(profile);
    setActive(true);
    _initialized = true;
  }
}

/**
 * Returns current stream status.
 * @param {string} profile
 * @returns {Promise<Object>}
 */
export async function getStatus(profile) {
  const enabled = await isEnabled(profile);
  const size = enabled ? await getSize(profile).catch(() => 0) : 0;
  return {
    enabled,
    initialized: _initialized,
    active: isActive(),
    profile: _profile,
    logSize: size,
    lastEventTs: _lastEventTs,
  };
}

/**
 * Emits a navigation event (M nav) if stream is active.
 * @param {string} profile
 * @param {string} from - Previous section name
 * @param {string} to - New section name
 * @returns {Promise<void>}
 */
export async function emitNavEvent(profile, from, to) {
  if (!_initialized || !isActive()) return;
  try {
    const event = createEvent('M', 'nav', to, { src: 'nav', prof: profile, from, to });
    const line = format(event);
    await append(profile, line);
    bus.emit(event, profile);
  } catch (err) {
    // Best-effort: never block navigation
  }
}

/**
 * Returns whether this tab is in read-only mode (another tab owns the stream).
 * @returns {boolean}
 */
export function isReadOnly() {
  return _readOnly;
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export { bus } from './bus.js';
export { getConfig, setConfig, isEnabled } from './config.js';
export { exportLog, exportJSON } from './export.js';
export { parse, format, validate, createEvent, OP_CODES } from './format.js';
export { computeLiveSample } from './dey.js';
export { detectSessions, getCurrentSession } from './session.js';
export { registerAll, isActive } from './intercept.js';
export const replay = Replay.replay;
export const computeDey = Replay.computeDey;
export const computeCooper = Replay.computeCooper;
