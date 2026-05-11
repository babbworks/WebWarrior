/**
 * Works Bridge Listener — responds to Works Compound Browser discovery,
 * heartbeat, and data requests via BroadcastChannel.
 *
 * This module makes WebWarrior visible to the Works Compound Browser
 * running in another tab on the same origin.
 *
 * Protocol:
 *   works-discovery-request  → responds with profiles, active profile, tools
 *   works-heartbeat          → responds with heartbeat-response
 *   works-bulk-import-request → sends requested data back
 *   works-stream-subscribe   → forwards stream events to Works
 *   works-ping               → responds with pong
 */

import { listProfiles, getActive, getJournals, getLedgers, getTimeLogs } from '../../storage/profiles.js';

let channel = null;
let streamForwardProfile = null;
let streamForwardFilters = null;

/**
 * Initializes the Works bridge listener.
 * Opens the BroadcastChannel and starts responding to Works requests.
 *
 * @param {object} options
 * @param {Function} options.getTasksFn - Function to get tasks for a profile: (profile) => Promise<object[]>
 * @param {Function} options.getTimeFn - Function to get time intervals: (profile) => Promise<object[]>
 * @param {Function} options.getJournalFn - Function to get journal entries: (profile) => Promise<object[]>
 * @param {Function} options.getLedgerFn - Function to get ledger transactions: (profile) => Promise<object[]>
 * @param {object} options.streamBus - Stream bus instance for forwarding events
 */
export function initWorksListener(options = {}) {
  if (channel) return; // Already initialized

  channel = new BroadcastChannel('works-webwarrior-bridge');

  channel.addEventListener('message', async (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'works-discovery-request':
        await handleDiscovery();
        break;

      case 'works-heartbeat':
        channel.postMessage({
          type: 'webwarrior-heartbeat-response',
          ts: Math.floor(Date.now() / 1000),
        });
        break;

      case 'works-ping':
        channel.postMessage({
          type: 'webwarrior-heartbeat-response',
          ts: Math.floor(Date.now() / 1000),
          pingId: msg.connectionId,
        });
        break;

      case 'works-bulk-import-request':
        await handleBulkImport(msg, options);
        break;

      case 'works-stream-subscribe':
        handleStreamSubscribe(msg, options);
        break;
    }
  });

  // If stream bus is available, set up event forwarding
  if (options.streamBus && options.streamBus.subscribe) {
    options.streamBus.subscribe({}, (event) => {
      if (streamForwardProfile) {
        channel.postMessage({
          type: 'webwarrior-stream-event',
          profile: streamForwardProfile,
          event,
        });
      }
    });
  }

  console.log('[WorksListener] Initialized — listening on works-webwarrior-bridge');
}

/**
 * Responds to a discovery request with profile and tool information.
 */
async function handleDiscovery() {
  try {
    const profiles = await listProfiles();
    const activeProfile = await getActive();

    // Build tool inventory per profile
    const tools = {};
    for (const profile of profiles) {
      const journals = await getJournals(profile).catch(() => ['main']);
      const ledgers = await getLedgers(profile).catch(() => ['main']);
      const timeLogs = await getTimeLogs(profile).catch(() => ['main']);

      tools[profile] = {
        tasks: true,
        time: timeLogs.length > 0,
        journals: journals,
        ledgers: ledgers,
      };
    }

    channel.postMessage({
      type: 'webwarrior-discovery-response',
      profiles,
      activeProfile,
      tools,
      version: '1.0.0',
      ts: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    console.error('[WorksListener] Discovery failed:', err);
    // Send minimal response so Works knows we're alive
    channel.postMessage({
      type: 'webwarrior-discovery-response',
      profiles: [],
      activeProfile: null,
      tools: {},
      version: '1.0.0',
      ts: Math.floor(Date.now() / 1000),
    });
  }
}

/**
 * Handles a bulk import request — sends all data for a profile/tool back to Works.
 */
async function handleBulkImport(msg, options) {
  const { profile, tool, filters } = msg;

  try {
    let data = [];

    switch (tool) {
      case 'tasks':
        if (options.getTasksFn) {
          data = await options.getTasksFn(profile);
        }
        break;
      case 'time':
        if (options.getTimeFn) {
          data = await options.getTimeFn(profile);
        }
        break;
      case 'journal':
        if (options.getJournalFn) {
          data = await options.getJournalFn(profile);
        }
        break;
      case 'ledger':
        if (options.getLedgerFn) {
          data = await options.getLedgerFn(profile);
        }
        break;
    }

    // Apply filters if provided
    if (filters) {
      if (filters.project) {
        data = data.filter(item => item.project === filters.project);
      }
      if (filters.tags && filters.tags.length > 0) {
        data = data.filter(item => {
          const itemTags = item.tags || [];
          return filters.tags.some(t => itemTags.includes(t));
        });
      }
    }

    // Send each item as a separate message to Works
    for (const item of data) {
      channel.postMessage({
        type: 'webwarrior-to-works',
        tool,
        profile,
        payload: {
          type: tool === 'tasks' ? 'T' : tool === 'time' ? 'B' : tool === 'journal' ? 'A' : 'T',
          content: item,
          metadata: {
            project: item.project || null,
            tags: item.tags || [],
            row: `ww-${tool}`,
            bin: 'bulk-import',
          },
        },
      });
    }

    console.log(`[WorksListener] Bulk import: sent ${data.length} ${tool} items for profile "${profile}"`);
  } catch (err) {
    console.error('[WorksListener] Bulk import failed:', err);
  }
}

/**
 * Handles a stream subscription request — starts forwarding stream events.
 */
function handleStreamSubscribe(msg, options) {
  streamForwardProfile = msg.profile || null;
  streamForwardFilters = msg.filters || null;
  console.log(`[WorksListener] Stream subscription: forwarding events for profile "${streamForwardProfile}"`);
}

/**
 * Notifies Works that the active profile has changed.
 * Call this from WebWarrior's profile switching logic.
 */
export function notifyProfileChange(newProfile) {
  if (!channel) return;
  channel.postMessage({
    type: 'webwarrior-profile-changed',
    profile: newProfile,
    ts: Math.floor(Date.now() / 1000),
  });
}

/**
 * Closes the listener and cleans up.
 */
export function closeWorksListener() {
  if (channel) {
    channel.close();
    channel = null;
  }
  streamForwardProfile = null;
  streamForwardFilters = null;
}
