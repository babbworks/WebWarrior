# Webwarrior Service Contract

> The codified microservice intent for the browser-native stack. Every service must follow this contract so the system remains composable, testable, and upgradeable to Web Workers without API changes.

---

## The Contract

Every service lives at `services/<name>/index.js` and must satisfy:

### 1. Signature convention
```javascript
// All exported functions take (profile, args) or (profile, options)
export async function doSomething(profile, { field1, field2 } = {}) { ... }
```

The `profile` string replaces the env-var profile context from ww. It is always the first argument. No service reads `localStorage` or `getActive()` — profile selection is the caller's responsibility.

### 2. No DOM dependency
A service module must not reference `document`, `window`, `location`, or any browser UI API. This ensures it can run in a Web Worker, a test harness, or a future server-side context without modification.

```javascript
// BAD — breaks in Worker
document.getElementById('task-list').innerHTML = ...

// GOOD — return data, let app.js/render.js handle DOM
return tasks;
```

### 3. Storage only through db.js
Services call `storage/db.js` functions directly. They do not reach into `localStorage` or any other persistence layer. Exception: `storage/profiles.js` (which owns the profile registry) may read `localStorage` for the active profile name.

```javascript
import { getAll, put, remove } from '../../storage/db.js';
```

### 4. Pure error surface
Services throw typed errors or return null/empty arrays — they do not call `showToast()` or render error UI. The UI layer handles user-facing error presentation.

```javascript
// BAD
if (!task) { showToast('Not found', 'error'); return; }

// GOOD
if (!task) throw new Error(`Task ${uuid} not found`);
```

### 5. Independently testable
Every service can be tested in Node.js by mocking `storage/db.js`. No browser globals required.

### 6. Self-contained logic
Services do not call other services. Cross-service composition happens in `app.js`. This prevents circular dependencies and keeps upgrade paths clean.

---

## Service Registry

Current and planned services, in priority order:

| Service | Path | Status | Notes |
|---|---|---|---|
| tasks | services/tasks/index.js | impl (in core/) | urgency, bulk ops, deps |
| time | services/time/index.js | impl (in core/) | intervals, summaries |
| journal | services/journal/index.js | impl (in core/) | annotations, named journals |
| ledger | services/ledger/index.js | impl (in core/) | double-entry, 3 reports |
| lists | services/lists/index.js | planned v0.2 | sjl/t port, simple todos |
| next | services/next/index.js | planned v0.2 | urgency heuristic recommendation |
| warrior | services/warrior/index.js | planned v0.2 | cross-profile stats (renamed) |
| questions | services/questions/index.js | planned v0.2 | template capture forms |
| community | services/community/index.js | planned v0.2 | cross-profile shared collections |
| export | services/export/index.js | planned v0.2 | JSON, CSV, markdown, hledger |

### Parked backlog (not in v0.2 scope)

| Service | Blocker |
|---|---|
| groups | Low priority — profile grouping is metadata-only |
| ai/models | `connect-src` relaxation, user key management, consent UX |
| sync/github | OAuth not possible in pure browser; requires personal access token + `connect-src api.github.com` |
| network | Requires `connect-src` relaxation |
| schedule | Service Worker Periodic Sync is experimental (see `docs/concurrency-workers-channels.md`) |

---

## How to Add a New Service

Four touch points, always in this order:

### 1. Create the service module
```
services/<name>/index.js
```
Implement all CRUD and query functions. Import from `../../storage/db.js` only. No DOM. Unit test in Node.

### 2. Add render functions
Add to `ui/render.js` (or create `ui/sections/<name>.js` if complex). Functions take plain data objects, return HTML strings or mutate a specific DOM container. No service imports in render.

### 3. Add section HTML to index.html
```html
<section class="section hidden" id="section-<name>">
  <!-- add form, filter bar, output container -->
</section>
```
And add a nav item:
```html
<button class="nav-item" data-section="<name>">
  <span class="nav-icon">◉</span>
  <span class="nav-label">Name</span>
</button>
```

### 4. Wire in app.js
```javascript
// In SECTION_TITLES
'<name>': 'Display Name',

// In loadSection() switch
case '<name>': return load<Name>();

// Add wire<Name>() function
// Add keyboard shortcut in terminal.js SECTION_KEYS
```

That's the full contract. Any service following these four steps is automatically:
- Navigable via sidebar and keyboard (`g <key>`)
- Filterable via terminal filter mode
- Testable independently
- Upgradeable to a Web Worker

---

## Cross-Service Data Flow

Some features require data from multiple services — for example, adding a task to a community, or linking a ledger transaction to a journal entry. These are composed in `app.js`, not in the services themselves.

Pattern:
```javascript
// In app.js — NOT in a service
async function addTaskToCommunity(taskUuid, communityName) {
  const task    = await Tasks.getTask(activeProfile, taskUuid);
  const entry   = await Community.addEntry(activeProfile, communityName, { type: 'task', content: task });
  showToast('Added to community');
}
```

The services remain unaware of each other. Composition lives in the orchestration layer (`app.js`).

---

## Cross-Posting Pattern (tasks ↔ journal ↔ community ↔ ledger)

Webwarrior supports "cross-posting" — capturing one item in multiple services simultaneously. Examples:
- Complete a task → optionally log to journal
- Add a ledger transaction → optionally annotate a journal entry
- Add a journal entry → optionally add to a community collection

This is implemented as opt-in action chains in `app.js`, not baked into individual services. Each service remains a single-purpose data layer. The cross-post UI is a confirmation prompt or inline toggle presented after a primary action completes.

This directly mirrors the ww `community add` pattern where items are captured from their source service and referenced (not copied) in the community collection.
