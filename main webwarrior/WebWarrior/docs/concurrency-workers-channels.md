# Concurrency Model: Web Workers, Service Workers, Broadcast Channel

> Planning document for Webwarrior's concurrency and background-processing architecture. Covers three browser APIs and one fork scenario (moving services to a Worker-per-service model). Read after `service-contract.md`.

---

## The Problem

Webwarrior is currently a single-threaded browser app. All service logic, IndexedDB access, and UI rendering run on the main thread. For the current data scale (hundreds of tasks, thousands of journal entries) this is fine. Two scenarios break it:

1. **Heavy computation** — urgency scoring across 10k+ tasks, hledger reports over large ledgers, community indexing
2. **Background work** — periodic sync, offline queue, push notifications, pre-caching for fast load

Three browser APIs address these scenarios. They are complementary, not alternatives.

---

## 1. Web Workers

**What:** JavaScript that runs in a background OS thread. Shares no memory with the main thread. Communicates via `postMessage` / `onmessage`.

**When to use in Webwarrior:** When a service function takes >50ms and blocks UI responsiveness. Candidates:
- Urgency recompute over full task list after bulk import
- Ledger balance aggregation over large transaction sets
- Community indexing / full-text search over journal entries
- Future: NLP/heuristic matching if we port the 627-rule CMD engine

**How a service migrates to a Worker** (the fork scenario — see section below):

```javascript
// services/tasks/worker.js
self.onmessage = async ({ data: { type, profile, args } }) => {
  const result = await dispatch(type, profile, args);
  self.postMessage({ type, result });
};

async function dispatch(type, profile, args) {
  switch (type) {
    case 'getTasks':    return getTasks(profile, args);
    case 'computeAll':  return recomputeAllUrgency(profile);
    // ...
  }
}
```

```javascript
// In app.js — thin proxy
const taskWorker = new Worker('./services/tasks/worker.js', { type: 'module' });

function callTaskWorker(type, profile, args) {
  return new Promise((resolve) => {
    taskWorker.onmessage = ({ data }) => resolve(data.result);
    taskWorker.postMessage({ type, profile, args });
  });
}
```

Because our services follow the contract (no DOM, pure `(profile, args)` signatures), moving them to a Worker requires only:
1. Adding `worker.js` with the message dispatcher
2. Adding a proxy wrapper in `app.js`
3. No changes to the service module itself

**IndexedDB in Workers:** IndexedDB is available in Web Workers. Our `storage/db.js` abstraction works in Worker context without modification. The only constraint: a Worker and the main thread should not both hold write transactions open on the same store simultaneously.

**Current recommendation:** Don't move services to Workers yet. Mark service functions with `// WORKER-SAFE` when they're confirmed to have no DOM dependency, so migration is easy when the time comes. All current services in `core/` are already Worker-safe.

---

## 2. Service Workers

**What:** A Worker that acts as a network proxy between the browser and the outside world. Intercepts all fetch requests. Persists across page reloads and browser restarts. Can run in the background even when no tab is open (within browser limits).

**This is the highest-priority concurrency feature for Webwarrior.** Here's why:

### Offline-first caching

Without a Service Worker, Webwarrior requires a network connection to load the initial HTML/CSS/JS. With one:
- First visit: SW caches all static assets
- Subsequent visits: loads entirely from cache, zero network required
- Works on airplane mode, spotty hotel wifi, offline-first truly

```javascript
// sw.js — install: cache all static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('ww-v1').then(cache =>
      cache.addAll(['./', './app.js', './style.css', './core/tasks.js', /* ... */])
    )
  );
});

// fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );
});
```

### Background sync (future: when connect-src is relaxed)

When GitHub sync or AI features are added, the Service Worker can queue requests made while offline and replay them when connectivity returns, using the Background Sync API:

```javascript
// In app.js
navigator.serviceWorker.ready.then(sw =>
  sw.sync.register('sync-tasks-to-github')
);

// In sw.js
self.addEventListener('sync', event => {
  if (event.tag === 'sync-tasks-to-github') {
    event.waitUntil(doGitHubSync());
  }
});
```

### Periodic background tasks (replaces Schedule service for ww-equivalent)

The Periodic Background Sync API (Chrome/Edge only, requires user engagement score) can run SW logic on a schedule — the closest browser equivalent to ww's cron-based Schedule service:

```javascript
// Register
navigator.serviceWorker.ready.then(sw =>
  sw.periodicSync.register('daily-review', { minInterval: 24 * 60 * 60 * 1000 })
);

// In sw.js
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-review') event.waitUntil(runDailyReview());
});
```

**Limitation:** Periodic Background Sync requires a Chrome/Edge browser, HTTPS, and sufficient "site engagement." Not a replacement for Schedule in all scenarios, but the right direction.

### Push notifications

Service Workers enable Web Push — the browser can receive a push notification even when Webwarrior isn't open. Requires a push server (small backend) and user permission. Parked for now, but architecturally enabled once SW is in place.

**Next planning action:** Design and implement `sw.js` for offline-first caching. This is the single highest-value browser API addition and should be in v0.2 scope.

---

## 3. Broadcast Channel API

**What:** A named channel that any tab, Worker, or Service Worker from the same origin can post messages to and receive from. Zero setup — no server, no WebSocket.

**Use case in Webwarrior:** Multi-tab coordination. If a user has Webwarrior open in two windows (e.g., one for tasks, one for journal), a change in one tab should update the other.

```javascript
// In app.js — setup
const channel = new BroadcastChannel('ww-sync');

channel.onmessage = ({ data }) => {
  if (data.profile === activeProfile) {
    // Another tab changed data — reload relevant section
    if (data.store === 'tasks')   loadTasks();
    if (data.store === 'journal') loadJournal();
  }
};

// After any mutation — broadcast to other tabs
function broadcast(store) {
  channel.postMessage({ profile: activeProfile, store, ts: Date.now() });
}
```

This is lightweight (no server), works instantly, and requires ~15 lines of code. It also works between a tab and a Service Worker.

**Recommendation:** Add Broadcast Channel in v0.2 alongside the Service Worker. The SW can post a message to all open tabs after completing a background sync, and all tabs reload their data.

---

## Fork Scenario: core/service.js with Web Workers

This section explores what it would look like to fork Webwarrior's service layer toward a Worker-per-service model — a closer analogue to ww's subprocess-per-service architecture.

### Option A: Shared Worker (one Worker, all services)

One persistent Worker handles all service calls. Main thread sends typed messages; Worker dispatches to service modules.

```
app.js  ──postMessage({type, service, fn, args})──►  shared-worker.js
                                                       │
                                                       ├── services/tasks/index.js
                                                       ├── services/journal/index.js
                                                       ├── services/ledger/index.js
                                                       └── ...
```

**Pros:** Single Worker to manage; IndexedDB access fully off main thread; no spawn overhead per call.
**Cons:** Worker failure crashes all services; no parallelism between services; message serialization overhead on every call.

### Option B: Worker-per-service (microservice intent, fullest form)

Each service gets its own Worker. Main thread has a service proxy registry.

```
app.js
  ├── TasksProxy   ──► Worker(services/tasks/worker.js)
  ├── JournalProxy ──► Worker(services/journal/worker.js)
  ├── LedgerProxy  ──► Worker(services/ledger/worker.js)
  └── ...
```

```javascript
// core/service-proxy.js — generic Worker proxy
export class ServiceProxy {
  constructor(workerPath) {
    this.worker = new Worker(workerPath, { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.worker.onmessage = ({ data }) => {
      const { id, result, error } = data;
      const { resolve, reject } = this.pending.get(id) || {};
      this.pending.delete(id);
      error ? reject(new Error(error)) : resolve(result);
    };
  }

  call(fn, ...args) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, fn, args });
    });
  }
}

// Usage in app.js
import { ServiceProxy } from './core/service-proxy.js';
const Tasks = new ServiceProxy('./services/tasks/worker.js');
await Tasks.call('addTask', activeProfile, { description: 'hello' });
```

**Pros:** True service isolation; main thread never blocks; fault-isolated (one Worker crash doesn't affect others); closest to ww's subprocess model.
**Cons:** Higher complexity; Worker spawn time (~5-20ms each) per new tab; each Worker holds its own IndexedDB connection (concurrent write contention risk without a coordinating lock).

### Option C: Hybrid (current default + opt-in Worker migration)

Keep the current direct-import model as default. Add `worker.js` alongside `index.js` for services that prove to be performance bottlenecks. `app.js` uses a feature flag:

```javascript
const USE_WORKERS = localStorage.getItem('ww_use_workers') === 'true';
const Tasks = USE_WORKERS
  ? new ServiceProxy('./services/tasks/worker.js')
  : await import('./services/tasks/index.js');
```

**This is the recommended path.** It lets us ship fast, measure actual performance bottlenecks, and migrate hot services to Workers without a full rewrite.

### Recommendation

| Phase | Model | Why |
|---|---|---|
| v0.1 (now) | Direct imports, no Workers | No observed bottlenecks; premature optimization |
| v0.2 | Add Service Worker for offline caching | Highest value, minimal complexity |
| v0.2 | Add Broadcast Channel for multi-tab sync | ~15 lines, immediate value |
| v0.3+ | Profile `core/urgency.js` and bulk import under load | Measure before moving to Worker |
| v0.3+ | Migrate hot services to Option C hybrid | Only if perf data justifies it |
| Future | Evaluate Option B (Worker-per-service) | Only if true isolation becomes a requirement |

---

## Summary Table

| API | What it solves | Priority | Complexity |
|---|---|---|---|
| **Service Worker** | Offline-first, background sync, push | HIGH — v0.2 | Medium |
| **Broadcast Channel** | Multi-tab data consistency | MEDIUM — v0.2 | Low |
| **Web Worker (shared)** | Heavy computation off main thread | LOW — v0.3 if needed | Medium |
| **Web Worker (per-service)** | True service isolation | FUTURE | High |
| **Periodic Background Sync** | Browser-native schedule (Chrome/Edge) | PARKED | Medium |
| **Web Push** | Notifications when app is closed | PARKED | High (needs server) |
