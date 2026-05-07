# Workwarrior → Webwarrior: Architectural Journey

> Recorded 2026-05-06. Documents the conceptual shift from the terminal-first ww stack to the browser-native Webwarrior application.

---

## Why This Exists

Workwarrior is a terminal-first productivity suite unifying TaskWarrior, TimeWarrior, JRNL, and Hledger under a single CLI (`ww`). It has a mature browser UI — but that UI depends on a Python HTTP server and all four CLI tools installed locally. Webwarrior is the answer to: *what if the entire system ran standalone in any browser, with no installed software, with data stored only in the user's own device?*

---

## Fundamental Architectural Differences

### Process model

| Workwarrior | Webwarrior |
|---|---|
| `bin/ww` dispatches to executable bash scripts | `app.js` imports ES modules directly |
| Each service = a subprocess (spawned, isolated) | Each service = a JS module (same runtime, same heap) |
| IPC via stdin/stdout/exit codes | Communication via function calls returning Promises |
| Shell env vars for profile context (`TASKRC`, etc.) | Profile name passed as first arg to every function |
| Python HTTP server as browser gateway | No gateway — browser IS the runtime |

The core shift: ww is a microservice mesh at the OS process level. Webwarrior is a modular monolith — everything runs in one browser JS context. There is no process isolation, no IPC, no serialization overhead between services.

### Service contract comparison

**ww service contract:**
```bash
services/journal/journal.sh add "entry text"
# stdout → result, exit code → success/failure
# TASKRC, WORKWARRIOR_BASE, etc. in env
```

**Webwarrior service contract:**
```javascript
// services/journal/index.js
export async function addEntry(profile, { body, journal, project, tags }) { ... }
// profile arg replaces env vars
// returns Promise<entry object>
// storage via IndexedDB, no file I/O
```

Same conceptual contract — named service, subcommand, args, result — different substrate.

---

## Data Layer

| Workwarrior | Webwarrior |
|---|---|
| Taskwarrior JSON files on disk | IndexedDB (one database per profile: `ww_profile_<name>`) |
| JRNL text files | IndexedDB `journal_entries` object store |
| Hledger journal files | IndexedDB `ledger_transactions` object store |
| TimeWarrior interval files | IndexedDB `time_intervals` object store |
| SQLite (community service) | IndexedDB (community service) |
| Profile isolation via env vars | Profile isolation via separate IndexedDB databases |
| Active profile in `.state/` | Active profile in `localStorage` |

---

## Privacy Architecture

The static host (GitHub Pages, Netlify, etc.) delivers only HTML/CSS/JS. It has no mechanism to read IndexedDB data. This is enforced architecturally:

- `connect-src 'none'` in CSP blocks all outbound fetch/XHR after page load
- No analytics, no telemetry, no CDN scripts — all assets are self-hosted
- File System Access API (import from ww) reads local files inside the browser sandbox only — nothing is uploaded
- Export generates a local file download — no POST anywhere

---

## Service Candidate Map

### Implemented in v0.1
- Tasks (core/tasks.js) — full lifecycle, urgency scoring, bulk ops
- Time tracking (core/time.js) — start/stop/track, summaries
- Journal (core/journal.js) — entries, annotations, named journals
- Ledger (core/ledger.js) — double-entry, balance/register/income reports

### Planned for v0.2
- **Lists** — simple todo list, trivial IndexedDB port of sjl/t
- **Next** — task recommendation (pure urgency heuristic, no server needed)
- **Warrior** (renamed: cross-profile overview) — query all profile DBs in parallel
- **Projects** — extended from current derived-project view
- **Questions** — templated capture workflows (form templates + dispatch)
- **Community** — cross-profile shared collections (IndexedDB port of SQLite schema)
- **Export** — expanded: JSON, CSV, markdown, hledger-format file download

### Parked — backlog
- **Groups** — profile grouping metadata
- **AI / Models** — requires relaxing `connect-src`, user-supplied API keys
- **GitHub Sync** — requires personal access token; OAuth not possible from pure browser
- **Network checks** — connectivity pings require `connect-src` relaxation
- **Schedule (cron)** — Service Worker Periodic Sync is experimental; explore after SW planning
- **Warlock** — launches an external process; not applicable
- **Saves / Bookbuilder** — server-side content fetching (CORS); not applicable

---

## The Microservice Intent in Browser Context

ww's microservice pattern exists because bash is the integration fabric and each tool (taskwarrior, timewarrior, jrnl, hledger) is an isolated binary. The service layer wraps those binaries with consistent CLI contracts.

In Webwarrior, the tools *are* the JS modules — there is nothing to wrap. The service contract collapses from a process boundary to a module boundary. The benefit of process isolation is gone, but so is the spawn/serialize/parse overhead.

The intent is preserved through discipline: every `services/<name>/index.js` module must:
1. Import only from `../../storage/db.js` and sibling `core/` utilities
2. Export only pure async functions with `(profile, args)` signatures
3. Have no DOM dependency — no `document`, no `window`
4. Be independently testable without a browser
5. Be moveable to a Web Worker without API changes

This last point is the browser-native equivalent of ww's loosely coupled service scripts. See `docs/concurrency-workers-channels.md` for the Worker migration path.

---

## Directory Conventions (Target State)

```
webwarrior/
  services/               ← one directory per service (microservice intent)
    tasks/
      index.js            ← service API: addTask, getTasks, updateTask, ...
      worker.js           ← Web Worker version (when computation warrants it)
    time/index.js
    journal/index.js
    ledger/index.js
    lists/index.js        ← planned
    next/index.js         ← planned
    warrior/index.js      ← planned (cross-profile stats)
    questions/index.js    ← planned
    community/index.js    ← planned
    export/index.js       ← planned (expanded)
  core/                   ← shared primitives used by services
    urgency.js            ← pure computation, no storage
    (future: parsers, formatters, shared algorithms)
  storage/
    db.js                 ← IndexedDB abstraction (never called from UI directly)
    profiles.js           ← profile registry
    import.js             ← ww data import
  ui/
    render.js             ← section render functions
    terminal.js           ← keyboard + terminal bar
    modals.js             ← toast, confirm, overlays
  docs/                   ← this directory
  app.js                  ← entry point: wires UI to services
  index.html
  style.css
```

Current state has services flat in `core/`. Migration to `services/` subdirectories is a rename-and-redirect — `app.js` imports change, no logic changes.
