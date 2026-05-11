/**
 * Stream Service — Event Bus
 *
 * EventTarget-based pub/sub with filtered subscriptions.
 * Provides in-memory event distribution to UI components
 * without polling.
 */

/**
 * @typedef {Object} BusFilter
 * @property {string|null} op - Filter by op code (null = match all)
 * @property {string|null} object - Filter by object identifier (null = match all)
 * @property {string|null} prof - Filter by profile (null = match all)
 * @property {string|null} proj - Filter by project from ctx (null = match all)
 * @property {string[]|null} tags - Filter by tags from ctx, any-match (null = match all)
 */

/**
 * StreamBus — EventTarget-based pub/sub with filtered subscriptions.
 */
export class StreamBus extends EventTarget {
  /** @type {Array<{filter: BusFilter, callback: function}>} */
  #subscribers = [];

  /**
   * Subscribe to stream events matching a filter.
   * @param {BusFilter} filter - Criteria to match (null fields = match all)
   * @param {function(import('./format.js').StreamEvent): void} callback
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(filter, callback) {
    const entry = { filter, callback };
    this.#subscribers.push(entry);
    return () => {
      const idx = this.#subscribers.indexOf(entry);
      if (idx !== -1) this.#subscribers.splice(idx, 1);
    };
  }

  /**
   * Emit a stream event to all matching subscribers.
   * @param {import('./format.js').StreamEvent} event
   * @param {string} profile - Active profile name
   */
  emit(event, profile) {
    for (const { filter, callback } of this.#subscribers) {
      if (!this.#matches(filter, event, profile)) continue;
      try {
        callback(event);
      } catch (err) {
        console.error('[StreamBus] Subscriber callback error:', err);
      }
    }
  }

  /**
   * Remove all subscribers.
   */
  clear() {
    this.#subscribers = [];
  }

  /**
   * Tests whether an event matches a filter.
   * Null filter fields match all values.
   * Tags use any-match semantics: if any tag in filter.tags
   * appears in event.ctx.tags, it matches.
   * @param {BusFilter} filter
   * @param {import('./format.js').StreamEvent} event
   * @param {string} profile
   * @returns {boolean}
   */
  #matches(filter, event, profile) {
    if (filter.op != null && filter.op !== event.op) return false;
    if (filter.object != null && filter.object !== event.object) return false;
    if (filter.prof != null && filter.prof !== profile) return false;
    if (filter.proj != null && filter.proj !== event.ctx?.proj) return false;
    if (filter.tags != null) {
      const eventTags = event.ctx?.tags;
      if (!Array.isArray(eventTags)) return false;
      const hasAny = filter.tags.some(tag => eventTags.includes(tag));
      if (!hasAny) return false;
    }
    return true;
  }
}

/** Singleton bus instance */
export const bus = new StreamBus();
