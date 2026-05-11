// Import from existing ww/Workwarrior folder via File System Access API

import { createProfile, listProfiles, addJournal, addLedger } from './profiles.js';
import { putMany, put, setMeta } from './db.js';

export async function importFromFolder(onProgress) {
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API not available in this browser');
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  const results = { profiles: [], errors: [] };

  const log = (msg, type = 'info') => {
    onProgress?.({ msg, type });
  };

  // Find the profiles/ subdirectory
  let profilesDir = null;
  try {
    profilesDir = await dirHandle.getDirectoryHandle('profiles');
    log('Found profiles/ directory');
  } catch {
    // Maybe the user opened the profiles/ dir directly or the root is profiles
    profilesDir = dirHandle;
    log('Using root as profiles directory');
  }

  // Enumerate profile directories
  for await (const [name, handle] of profilesDir.entries()) {
    if (handle.kind !== 'directory') continue;
    log(`Importing profile: ${name}`);

    try {
      // Ensure profile exists
      const existing = listProfiles();
      if (!existing.includes(name)) {
        await createProfile(name);
        log(`  Created profile: ${name}`, 'ok');
      } else {
        log(`  Profile exists, merging: ${name}`);
      }

      // Import tasks
      await importTasks(name, handle, log);

      // Import time intervals
      await importTimewarrior(name, handle, log);

      // Import journals
      await importJournals(name, handle, log);

      // Import ledgers
      await importLedgers(name, handle, log);

      results.profiles.push(name);
    } catch (err) {
      log(`  Error importing ${name}: ${err.message}`, 'error');
      results.errors.push({ profile: name, error: err.message });
    }
  }

  return results;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

async function importTasks(profile, profileDir, log) {
  let taskDir;
  try { taskDir = await profileDir.getDirectoryHandle('.task'); } catch { return; }

  const tasks = [];
  for (const fname of ['pending.data', 'completed.data']) {
    let fh;
    try { fh = await taskDir.getFileHandle(fname); } catch { continue; }
    const text = await (await fh.getFile()).text();
    for (const line of text.split('\n')) {
      const t = parseTaskwarriorLine(line.trim());
      if (t) tasks.push(t);
    }
  }

  if (tasks.length > 0) {
    await putMany(profile, 'tasks', tasks);
    log(`  Tasks: imported ${tasks.length}`, 'ok');
  }
}

function parseTaskwarriorLine(line) {
  if (!line || !line.startsWith('[')) return null;
  try {
    // Taskwarrior NDJSON-ish: [key:"value" key2:"value2" ...]
    const obj = {};
    const re = /(\w+):"([^"]*)"/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      obj[m[1]] = m[2];
    }
    if (!obj.uuid) return null;
    return {
      uuid:        obj.uuid,
      status:      obj.status || 'pending',
      description: obj.description || '',
      project:     obj.project || '',
      tags:        obj.tags ? obj.tags.replace(/,/g, ' ').split(' ').filter(Boolean) : [],
      priority:    obj.priority || '',
      due:         obj.due ? twDateToISO(obj.due) : null,
      scheduled:   obj.scheduled ? twDateToISO(obj.scheduled) : null,
      wait:        obj.wait ? twDateToISO(obj.wait) : null,
      start:       obj.start ? twDateToISO(obj.start) : null,
      end:         obj.end ? twDateToISO(obj.end) : null,
      depends:     obj.depends ? obj.depends.split(',').filter(Boolean) : [],
      annotations: parseAnnotations(obj.annotation || ''),
      urgency:     parseFloat(obj.urgency) || 0,
      modified:    obj.modified ? twDateToISO(obj.modified) : new Date().toISOString(),
      entry:       obj.entry ? twDateToISO(obj.entry) : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function twDateToISO(tw) {
  // Taskwarrior format: 20260506T090000Z
  if (!tw || tw.length < 8) return null;
  try {
    const s = tw.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6Z');
    return new Date(s).toISOString();
  } catch { return null; }
}

function parseAnnotations(raw) {
  if (!raw) return [];
  // Format: "timestamp text|timestamp text"
  return raw.split('|').map(a => {
    const m = a.match(/^(\d+)\s+(.*)/);
    if (!m) return null;
    return { entry: new Date(parseInt(m[1]) * 1000).toISOString(), description: m[2] };
  }).filter(Boolean);
}

// ── TimeWarrior ──────────────────────────────────────────────────────────────

async function importTimewarrior(profile, profileDir, log) {
  let twDir;
  try { twDir = await profileDir.getDirectoryHandle('.timewarrior'); } catch { return; }
  let dataDir;
  try { dataDir = await twDir.getDirectoryHandle('data'); } catch { return; }

  const intervals = [];
  for await (const [fname, fh] of dataDir.entries()) {
    if (fh.kind !== 'file' || !fname.endsWith('.data')) continue;
    const text = await (await fh.getFile()).text();
    for (const line of text.split('\n')) {
      const i = parseTimewLine(line.trim());
      if (i) intervals.push(i);
    }
  }

  if (intervals.length > 0) {
    await putMany(profile, 'time_intervals', intervals);
    log(`  Time: imported ${intervals.length} intervals`, 'ok');
  }
}

function parseTimewLine(line) {
  if (!line || !line.startsWith('inc')) return null;
  try {
    // Format: inc 20260506T090000Z - 20260506T120000Z # tag1 tag2
    const m = line.match(/^inc\s+(\S+)\s+-\s+(\S+)(?:\s+#\s*(.*))?/);
    if (!m) return null;
    return {
      start:      twDateToISO(m[1]),
      end:        m[2] === '' ? null : twDateToISO(m[2]),
      tags:       m[3] ? m[3].trim().split(/\s+/).filter(Boolean) : [],
      annotation: '',
    };
  } catch { return null; }
}

// ── Journals ─────────────────────────────────────────────────────────────────

async function importJournals(profile, profileDir, log) {
  let journalDir;
  try { journalDir = await profileDir.getDirectoryHandle('journals'); } catch { return; }

  let count = 0;
  for await (const [fname, fh] of journalDir.entries()) {
    if (fh.kind !== 'file') continue;
    const journalName = fname.replace(/\.txt$/, '');
    await addJournal(profile, journalName);
    const text = await (await fh.getFile()).text();
    const entries = parseJrnlFile(text, journalName);
    if (entries.length > 0) {
      await putMany(profile, 'journal_entries', entries);
      count += entries.length;
    }
  }
  if (count > 0) log(`  Journal: imported ${count} entries`, 'ok');
}

function parseJrnlFile(text, journal) {
  const entries = [];
  // JRNL format: [2026-05-06 14:23] Entry body
  const re = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s*(.*)/;
  let current = null;

  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) {
      if (current) entries.push(current);
      current = {
        date:        new Date(m[1]).toISOString(),
        body:        m[2],
        journal,
        project:     '',
        tags:        [],
        priority:    '',
        annotations: [],
        archived:    false,
      };
    } else if (current && line.trim()) {
      current.body += '\n' + line;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// ── Ledgers ──────────────────────────────────────────────────────────────────

async function importLedgers(profile, profileDir, log) {
  let ledgerDir;
  try { ledgerDir = await profileDir.getDirectoryHandle('ledgers'); } catch { return; }

  let count = 0;
  for await (const [fname, fh] of ledgerDir.entries()) {
    if (fh.kind !== 'file') continue;
    const ledgerName = fname.replace(/\.txt$|\.journal$|\.ledger$/, '');
    await addLedger(profile, ledgerName);
    const text = await (await fh.getFile()).text();
    const txns = parseHledgerFile(text, ledgerName);
    if (txns.length > 0) {
      await putMany(profile, 'ledger_transactions', txns);
      count += txns.length;
    }
  }
  if (count > 0) log(`  Ledger: imported ${count} transactions`, 'ok');
}

function parseHledgerFile(text, ledger) {
  const txns = [];
  const lines = text.split('\n');
  let current = null;

  for (const raw of lines) {
    // Transaction header: YYYY-MM-DD description
    const header = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)/);
    if (header && !raw.startsWith(' ') && !raw.startsWith('\t')) {
      if (current) txns.push(current);
      current = {
        date:        header[1],
        description: header[2].trim(),
        ledger,
        postings:    [],
        comment:     '',
      };
      continue;
    }

    // Posting: "  account  amount"
    if (current && (raw.startsWith('  ') || raw.startsWith('\t'))) {
      const posting = raw.trim();
      if (!posting || posting.startsWith(';')) continue;
      const pm = posting.match(/^(\S+(?::\S+)*)\s+([-\d$,.]+(?:\s+\w+)?)/);
      if (pm) {
        const amtStr = pm[2].replace(/[$,]/g, '').trim();
        const amt = parseFloat(amtStr.split(/\s+/)[0]);
        current.postings.push({
          account: pm[1],
          amount:  isNaN(amt) ? 0 : amt,
          comment: '',
        });
      } else if (posting) {
        // No amount — will be balanced automatically (we skip for now)
        current.postings.push({ account: posting, amount: 0, comment: '' });
      }
    }
  }
  if (current && current.postings.length > 0) txns.push(current);
  return txns;
}

// ── Demo data ────────────────────────────────────────────────────────────────

export async function loadDemoData(profile) {
  const { computeUrgency } = await import('../core/urgency.js');
  const { getAttributes } = await import('../services/attributes/index.js');
  const now = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().slice(0, 10);
  const threeDaysAgo = new Date(Date.now() - 259200000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 604800000).toISOString().slice(0, 10);
  const lastWeek = new Date(Date.now() - 604800000).toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 1209600000).toISOString().slice(0, 10);

  let udaDefs = [];
  try { udaDefs = await getAttributes(profile); } catch {}

  // ── Web Developer tasks (taskList: web_developer) ──────────────────────────
  const webDevTasks = [
    { uuid: crypto.randomUUID(), status: 'active', taskList: 'web_developer', description: 'Implement OAuth2 login flow with PKCE', project: 'auth-service', tags: ['security', 'backend', 'sprint-3'], priority: 'H', due: tomorrow, scheduled: today, wait: null, start: now, end: null, depends: [], annotations: [{ entry: new Date(Date.now() - 3600000).toISOString(), description: 'Using auth0 SDK — docs at https://auth0.com/docs' }, { entry: new Date(Date.now() - 7200000).toISOString(), description: 'Need to handle token refresh edge case' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T09:00:00Z', stack: 'Node.js, Express, Auth0', codinglanguages: 'TypeScript', manhours: 16, bugs: 'Token refresh fails silently on mobile Safari' },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Migrate PostgreSQL schema to support multi-tenancy', project: 'platform', tags: ['database', 'architecture', 'sprint-3'], priority: 'H', due: nextWeek, scheduled: tomorrow, wait: null, start: null, end: null, depends: [], annotations: [{ entry: lastWeek + 'T14:00:00Z', description: 'Reviewed RLS approach — row-level security preferred over schema-per-tenant' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T10:00:00Z', stack: 'PostgreSQL, Prisma', codinglanguages: 'SQL, TypeScript', manhours: 24, testing: 'Need migration rollback tests' },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Build real-time notification WebSocket service', project: 'notifications', tags: ['backend', 'websocket', 'sprint-4'], priority: 'M', due: nextWeek, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: yesterday + 'T11:00:00Z', description: 'Evaluated Socket.io vs native WS — going native for less overhead' }, { entry: yesterday + 'T15:00:00Z', description: 'journaled: design decisions in web_developer journal' }], urgency: 0, modified: now, entry: lastWeek + 'T08:00:00Z', stack: 'Node.js, Redis Pub/Sub', codinglanguages: 'TypeScript', manhours: 12 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Optimize bundle size — tree-shake unused lodash imports', project: 'performance', tags: ['frontend', 'optimization'], priority: 'M', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: threeDaysAgo + 'T09:00:00Z', description: 'Current bundle: 2.4MB, target: <1MB' }], urgency: 0, modified: now, entry: lastWeek + 'T14:00:00Z', stack: 'Vite, React', codinglanguages: 'JavaScript', manhours: 4 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Write integration tests for payment webhook handler', project: 'payments', tags: ['testing', 'backend', 'stripe'], priority: 'H', due: tomorrow, scheduled: today, wait: null, start: null, end: null, depends: [], annotations: [{ entry: yesterday + 'T16:00:00Z', description: 'Stripe test mode keys configured in .env.test' }, { entry: today + 'T08:00:00Z', description: 'shared to community/team-updates (today)' }], urgency: 0, modified: now, entry: threeDaysAgo + 'T10:00:00Z', stack: 'Jest, Supertest, Stripe SDK', codinglanguages: 'TypeScript', testing: 'Webhook signature verification + idempotency', manhours: 8 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Set up CI/CD pipeline with GitHub Actions', project: 'devops', tags: ['ci-cd', 'automation'], priority: 'M', due: nextWeek, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: twoDaysAgo + 'T10:00:00Z', description: 'Need: lint → test → build → deploy stages' }], urgency: 0, modified: now, entry: lastWeek + 'T11:00:00Z', stack: 'GitHub Actions, Docker', codinglanguages: 'YAML', deployment: 'Auto-deploy to staging on PR merge' },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Implement dark mode toggle with CSS custom properties', project: 'ui-system', tags: ['frontend', 'design-system', 'accessibility'], priority: 'L', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [], urgency: 0, modified: now, entry: lastWeek + 'T15:00:00Z', stack: 'React, CSS Variables', codinglanguages: 'CSS, TypeScript', design: 'Follow WCAG 2.1 contrast ratios' },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'web_developer', description: 'Refactor API error handling to use Result pattern', project: 'platform', tags: ['architecture', 'backend', 'refactor'], priority: 'L', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: threeDaysAgo + 'T14:00:00Z', description: 'Inspired by Rust Result<T,E> — no more try/catch spaghetti' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T16:00:00Z', stack: 'TypeScript', codinglanguages: 'TypeScript', manhours: 6 },
    { uuid: crypto.randomUUID(), status: 'completed', taskList: 'web_developer', description: 'Fix CORS headers for API gateway', project: 'platform', tags: ['backend', 'bugfix'], priority: 'H', due: yesterday, scheduled: null, wait: null, start: null, end: yesterday + 'T17:00:00Z', depends: [], annotations: [{ entry: yesterday + 'T17:00:00Z', description: 'Fixed — was missing Access-Control-Allow-Credentials header' }], urgency: 0, modified: now, entry: twoDaysAgo + 'T09:00:00Z', stack: 'Express, nginx', bugs: 'Resolved', manhours: 2 },
    { uuid: crypto.randomUUID(), status: 'completed', taskList: 'web_developer', description: 'Deploy staging environment to AWS ECS', project: 'devops', tags: ['deployment', 'aws'], priority: 'M', due: lastWeek, scheduled: null, wait: null, start: null, end: lastWeek + 'T16:00:00Z', depends: [], annotations: [{ entry: lastWeek + 'T16:00:00Z', description: 'Running on t3.medium, auto-scaling configured' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T08:00:00Z', deployment: 'ECS Fargate, ALB', manhours: 10 },
  ];

  // ── Project Manager tasks (taskList: project_manager) ──────────────────────
  const pmTasks = [
    { uuid: crypto.randomUUID(), status: 'active', taskList: 'project_manager', description: 'Finalize Q3 roadmap with stakeholders', project: 'strategy', tags: ['planning', 'leadership', 'q3'], priority: 'H', due: tomorrow, scheduled: today, wait: null, start: now, end: null, depends: [], annotations: [{ entry: yesterday + 'T10:00:00Z', description: 'Meeting with VP Product scheduled for tomorrow 2pm' }, { entry: today + 'T09:00:00Z', description: 'Draft shared in team-updates community' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T09:00:00Z', milestones: 'Roadmap approval by Friday', goals: 'Align engineering capacity with business priorities', clients: 'Internal stakeholders', manhours: 8 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Conduct sprint retrospective and publish action items', project: 'agile-ops', tags: ['agile', 'team', 'sprint-3'], priority: 'H', due: today, scheduled: today, wait: null, start: null, end: null, depends: [], annotations: [{ entry: yesterday + 'T14:00:00Z', description: 'Team velocity dropped 15% — need to investigate blockers' }, { entry: yesterday + 'T16:00:00Z', description: 'Prepared Miro board with retro template' }], urgency: 0, modified: now, entry: threeDaysAgo + 'T08:00:00Z', team: 'Platform squad (8 engineers)', stages: 'Retro → Action items → Follow-up', manhours: 3 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Review and approve vendor contract for cloud monitoring', project: 'procurement', tags: ['vendor', 'contracts', 'budget'], priority: 'H', due: tomorrow, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: twoDaysAgo + 'T11:00:00Z', description: 'Datadog vs Grafana Cloud — cost comparison complete' }, { entry: yesterday + 'T09:00:00Z', description: 'Legal review pending on SLA terms' }], urgency: 0, modified: now, entry: lastWeek + 'T10:00:00Z', costtodevelop: '$24,000/year', vendors: 'Datadog', constraints: 'Must support multi-region', manhours: 4 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Prepare board presentation on engineering velocity metrics', project: 'reporting', tags: ['metrics', 'leadership', 'presentation'], priority: 'M', due: nextWeek, scheduled: threeDaysAgo, wait: null, start: null, end: null, depends: [], annotations: [{ entry: threeDaysAgo + 'T15:00:00Z', description: 'Include: cycle time, deployment frequency, MTTR, change failure rate' }], urgency: 0, modified: now, entry: lastWeek + 'T14:00:00Z', deliverables: 'Slide deck + live dashboard demo', scope: 'Last 2 quarters comparison', manhours: 6 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Onboard two new engineers — setup mentorship pairs', project: 'hiring', tags: ['onboarding', 'team', 'culture'], priority: 'M', due: nextWeek, scheduled: tomorrow, wait: null, start: null, end: null, depends: [], annotations: [{ entry: yesterday + 'T13:00:00Z', description: 'New hires: Sarah (frontend) and Marcus (backend) starting Monday' }], urgency: 0, modified: now, entry: threeDaysAgo + 'T09:00:00Z', team: 'Sarah Chen, Marcus Williams', managers: 'Direct reports to me', contributors: 'Mentor: Alex (senior)', manhours: 10 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Define OKRs for Platform team Q3', project: 'strategy', tags: ['okrs', 'planning', 'q3'], priority: 'M', due: nextWeek, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: twoDaysAgo + 'T10:00:00Z', description: 'Key result candidates: 99.9% uptime, <200ms p95 latency, zero critical bugs' }], urgency: 0, modified: now, entry: lastWeek + 'T11:00:00Z', goals: '3 objectives, 9 key results', milestones: 'Draft by Wed, final by Fri', progress: 'Draft in progress' },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Resolve cross-team dependency blocker with Mobile team', project: 'coordination', tags: ['blocker', 'cross-team', 'mobile'], priority: 'H', due: today, scheduled: today, wait: null, start: null, end: null, depends: [], annotations: [{ entry: yesterday + 'T11:00:00Z', description: 'Mobile team needs our API v2 endpoints — currently blocked on auth migration' }, { entry: today + 'T08:30:00Z', description: 'Escalated to engineering director' }], urgency: 0, modified: now, entry: twoDaysAgo + 'T14:00:00Z', blocking: 'Mobile app release 2.5', constraints: 'API v2 depends on auth-service completion', manhours: 2 },
    { uuid: crypto.randomUUID(), status: 'pending', taskList: 'project_manager', description: 'Update project risk register and mitigation plans', project: 'governance', tags: ['risk', 'compliance', 'documentation'], priority: 'L', due: nextWeek, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: lastWeek + 'T15:00:00Z', description: 'Top risks: key-person dependency, vendor lock-in, scope creep' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T10:00:00Z', risks: 'Key-person, vendor lock-in, scope creep', scope: 'All active projects' },
    { uuid: crypto.randomUUID(), status: 'completed', taskList: 'project_manager', description: 'Negotiate 20% discount on annual Jira license renewal', project: 'procurement', tags: ['vendor', 'budget', 'negotiation'], priority: 'M', due: lastWeek, scheduled: null, wait: null, start: null, end: lastWeek + 'T14:00:00Z', depends: [], annotations: [{ entry: lastWeek + 'T14:00:00Z', description: 'Secured 22% discount — $18k annual savings' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T09:00:00Z', costtodevelop: '$18,000 saved', vendors: 'Atlassian', dollars: 18000 },
    { uuid: crypto.randomUUID(), status: 'completed', taskList: 'project_manager', description: 'Ship Sprint 2 release to production', project: 'agile-ops', tags: ['release', 'deployment', 'sprint-2'], priority: 'H', due: lastWeek, scheduled: null, wait: null, start: null, end: lastWeek + 'T18:00:00Z', depends: [], annotations: [{ entry: lastWeek + 'T18:00:00Z', description: 'Released v2.3.0 — 14 stories, 3 bug fixes, zero rollbacks' }, { entry: lastWeek + 'T18:30:00Z', description: 'shared to community/team-updates' }], urgency: 0, modified: now, entry: twoWeeksAgo + 'T08:00:00Z', deliverables: 'v2.3.0', progress: 'Complete' },
  ];

  const allTasks = [...webDevTasks, ...pmTasks];
  allTasks.forEach(t => { t.urgency = computeUrgency(t, udaDefs); });

  // ── Time intervals ─────────────────────────────────────────────────────────
  const intervals = [
    { start: new Date(Date.now() - 14400000).toISOString(), end: new Date(Date.now() - 10800000).toISOString(), tags: ['auth-service', 'coding'], annotation: 'OAuth2 PKCE implementation', log: 'web_developer' },
    { start: new Date(Date.now() - 86400000 - 7200000).toISOString(), end: new Date(Date.now() - 86400000 - 3600000).toISOString(), tags: ['payments', 'testing'], annotation: 'Stripe webhook integration tests', log: 'web_developer' },
    { start: new Date(Date.now() - 86400000 - 10800000).toISOString(), end: new Date(Date.now() - 86400000 - 7200000).toISOString(), tags: ['platform', 'database'], annotation: 'Multi-tenancy schema design', log: 'web_developer' },
    { start: new Date(Date.now() - 172800000 - 3600000).toISOString(), end: new Date(Date.now() - 172800000).toISOString(), tags: ['strategy', 'planning'], annotation: 'Q3 roadmap draft session', log: 'project_manager' },
    { start: new Date(Date.now() - 172800000 - 7200000).toISOString(), end: new Date(Date.now() - 172800000 - 3600000).toISOString(), tags: ['agile-ops', 'retro'], annotation: 'Sprint 2 retrospective prep', log: 'project_manager' },
    { start: new Date(Date.now() - 259200000 - 5400000).toISOString(), end: new Date(Date.now() - 259200000 - 1800000).toISOString(), tags: ['devops', 'deployment'], annotation: 'ECS staging environment setup', log: 'web_developer' },
    { start: new Date(Date.now() - 345600000 - 3600000).toISOString(), end: new Date(Date.now() - 345600000).toISOString(), tags: ['hiring', 'onboarding'], annotation: 'Interview prep for new hires', log: 'project_manager' },
    { start: new Date(Date.now() - 345600000 - 7200000).toISOString(), end: new Date(Date.now() - 345600000 - 3600000).toISOString(), tags: ['notifications', 'architecture'], annotation: 'WebSocket service design session', log: 'web_developer' },
    { start: new Date(Date.now() - 7200000).toISOString(), end: new Date(Date.now() - 3600000).toISOString(), tags: ['general', 'admin'], annotation: 'Email and Slack catch-up', log: 'main' },
    { start: new Date(Date.now() - 432000000 - 3600000).toISOString(), end: new Date(Date.now() - 432000000).toISOString(), tags: ['learning', 'reading'], annotation: 'Technical reading session', log: 'main' },
  ];

  // ── Journal entries ────────────────────────────────────────────────────────
  const journalEntries = [
    { date: now, body: 'Deep work session on OAuth2 PKCE flow. The token refresh edge case on mobile Safari is tricky — the browser kills the background tab before the refresh completes. Solution: proactive refresh 5min before expiry.\n[task: Implement OAuth2 login flow with PKCE]', journal: 'web_developer', project: 'auth-service', tags: ['security', 'learning'], priority: 'H', annotations: [{ text: 'This pattern should be documented in our auth guide', entry: now }], archived: false },
    { date: yesterday + 'T16:00:00Z', body: 'Completed CORS fix. Root cause: nginx proxy was stripping the credentials header. Added explicit pass-through in location block. Took 2h to debug because the error only manifested in cross-origin iframe context.', journal: 'web_developer', project: 'platform', tags: ['bugfix', 'learning'], priority: '', annotations: [], archived: false },
    { date: twoDaysAgo + 'T14:00:00Z', body: 'Evaluated WebSocket libraries:\n- Socket.io: 45KB, auto-reconnect, rooms, but heavy\n- ws (native): 3KB, manual reconnect, but lean\n- Decision: native ws + custom reconnect logic\n\nRedis Pub/Sub for horizontal scaling across ECS tasks.', journal: 'web_developer', project: 'notifications', tags: ['architecture', 'decision'], priority: 'M', annotations: [{ text: 'shared to community/team-updates', entry: twoDaysAgo + 'T15:00:00Z' }], archived: false },
    { date: today + 'T09:00:00Z', body: 'Sprint 3 kickoff. Team velocity target: 42 points. Key deliverables: auth migration, payment webhooks, notification service MVP.\n\nBlocker: Mobile team dependency on API v2 — escalated.', journal: 'project_manager', project: 'agile-ops', tags: ['sprint-3', 'planning'], priority: 'H', annotations: [{ text: 'Action: schedule sync with mobile lead by EOD', entry: today + 'T09:30:00Z' }], archived: false },
    { date: yesterday + 'T10:00:00Z', body: 'Vendor evaluation complete for cloud monitoring:\n- Datadog: $2k/mo, excellent APM, expensive at scale\n- Grafana Cloud: $800/mo, good dashboards, weaker APM\n- Decision: Datadog for now, revisit at 50+ services\n\nContract terms need legal review on SLA guarantees.', journal: 'project_manager', project: 'procurement', tags: ['vendor', 'decision'], priority: 'M', annotations: [{ text: 'Legal review ETA: 2 business days', entry: yesterday + 'T11:00:00Z' }, { text: 'Budget approved by CFO', entry: yesterday + 'T14:00:00Z' }], archived: false },
    { date: threeDaysAgo + 'T15:00:00Z', body: 'OKR brainstorm for Platform team Q3:\n\nO1: Achieve production reliability\n- KR: 99.9% uptime (currently 99.7%)\n- KR: <200ms p95 API latency\n- KR: Zero P1 incidents\n\nO2: Accelerate developer velocity\n- KR: CI pipeline <5min\n- KR: Deploy to staging in <10min\n- KR: 80% test coverage on critical paths', journal: 'project_manager', project: 'strategy', tags: ['okrs', 'q3'], priority: 'M', annotations: [], archived: false },
  ];

  // ── Ledger transactions ────────────────────────────────────────────────────
  const transactions = [
    { date: today, description: 'Datadog annual license', ledger: 'main', postings: [{ account: 'expenses:software:monitoring', amount: 24000, comment: 'annual contract' }, { account: 'liabilities:accounts-payable', amount: -24000, comment: '' }], comment: 'project:procurement' },
    { date: yesterday, description: 'AWS ECS staging costs (monthly)', ledger: 'main', postings: [{ account: 'expenses:infrastructure:aws', amount: 340, comment: 'ECS + ALB + RDS' }, { account: 'assets:bank', amount: -340, comment: '' }], comment: 'project:devops' },
    { date: twoDaysAgo, description: 'Jira license renewal (discounted)', ledger: 'main', postings: [{ account: 'expenses:software:tools', amount: 62000, comment: '22% discount applied' }, { account: 'assets:bank', amount: -62000, comment: '' }], comment: 'project:procurement; saved $18k' },
    { date: lastWeek, description: 'Conference tickets — React Summit', ledger: 'main', postings: [{ account: 'expenses:training:conferences', amount: 1200, comment: '2 tickets' }, { account: 'assets:bank', amount: -1200, comment: '' }], comment: 'team development budget' },
  ];

  // ── List items ─────────────────────────────────────────────────────────────
  const listItems = [
    { text: 'Research GraphQL federation for microservices', list: 'web_developer', done: false, created: threeDaysAgo + 'T10:00:00Z' },
    { text: 'Benchmark Redis vs Memcached for session store', list: 'web_developer', done: false, created: lastWeek + 'T09:00:00Z' },
    { text: 'Read "Designing Data-Intensive Applications" Ch.7', list: 'web_developer', done: true, created: twoWeeksAgo + 'T08:00:00Z' },
    { text: 'Set up Playwright for E2E tests', list: 'web_developer', done: false, created: twoDaysAgo + 'T14:00:00Z' },
    { text: 'Draft team charter document', list: 'project_manager', done: false, created: yesterday + 'T09:00:00Z' },
    { text: 'Schedule 1:1s with new hires for first week', list: 'project_manager', done: false, created: today + 'T08:00:00Z' },
    { text: 'Review competitor product roadmaps', list: 'project_manager', done: false, created: threeDaysAgo + 'T11:00:00Z' },
    { text: 'Update RACI matrix for Q3 projects', list: 'project_manager', done: true, created: lastWeek + 'T10:00:00Z' },
  ];

  await putMany(profile, 'tasks', allTasks);
  await putMany(profile, 'time_intervals', intervals);
  await putMany(profile, 'journal_entries', journalEntries);
  await putMany(profile, 'ledger_transactions', transactions);
  await putMany(profile, 'lists', listItems);

  // Register task lists, journals, and time logs in profile metadata
  await setMeta(profile, 'task_lists', ['main', 'web_developer', 'project_manager']);
  await setMeta(profile, 'journals', ['main', 'web_developer', 'project_manager']);
  await setMeta(profile, 'time_logs', ['main', 'web_developer', 'project_manager']);

  // Populate community collections with cross-posted content
  try {
    const Community = await import('../services/community/index.js');

    // Ensure collections exist (create if missing)
    let collections = await Community.listCollections();
    let webDevColl = collections.find(c => c.name === 'web_developer' || c.name === 'web-developer');
    let pmColl = collections.find(c => c.name === 'project_manager' || c.name === 'project-manager');

    if (!webDevColl) {
      await Community.createCollection('web_developer', 'Web development team updates, shared tasks, and technical decisions');
      collections = await Community.listCollections();
      webDevColl = collections.find(c => c.name === 'web_developer');
    }
    if (!pmColl) {
      await Community.createCollection('project_manager', 'Project management updates, roadmap decisions, and cross-team coordination');
      collections = await Community.listCollections();
      pmColl = collections.find(c => c.name === 'project_manager');
    }

    if (webDevColl) {
      const e1 = await Community.addEntry(webDevColl.id, { type: 'task', profile, content: webDevTasks[0] });
      await Community.addComment(e1, 'PKCE flow is critical for mobile — prioritizing this sprint', profile);
      await Community.addComment(e1, 'Auth0 SDK handles most of the heavy lifting, focus on refresh edge case', profile);
      const e2 = await Community.addEntry(webDevColl.id, { type: 'journal', profile, content: { body: journalEntries[2].body, project: 'notifications' } });
      await Community.addComment(e2, 'Good analysis — native WS is the right call for our scale', profile);
      const e3 = await Community.addEntry(webDevColl.id, { type: 'task', profile, content: webDevTasks[4] });
      await Community.addComment(e3, 'Stripe webhook tests need to cover idempotency keys — had a production incident last quarter', profile);
      const e4 = await Community.addEntry(webDevColl.id, { type: 'task', profile, content: webDevTasks[5] });
      await Community.addComment(e4, 'Use the reusable workflow template from our infra repo', profile);
      const e5 = await Community.addEntry(webDevColl.id, { type: 'journal', profile, content: { body: 'Deployed staging to ECS Fargate. Auto-scaling configured: min 2, max 8 tasks. ALB health checks passing. Cost estimate: ~$340/mo at current load.', project: 'devops' } });
      await Community.addComment(e5, 'Nice — can we get a cost alert if it exceeds $500/mo?', profile);
    }

    if (pmColl) {
      const e6 = await Community.addEntry(pmColl.id, { type: 'task', profile, content: pmTasks[0] });
      await Community.addComment(e6, 'Roadmap draft v2 attached — please review before stakeholder meeting', profile);
      await Community.addComment(e6, 'VP Product confirmed attendance for Thursday 2pm', profile);
      const e7 = await Community.addEntry(pmColl.id, { type: 'journal', profile, content: { body: journalEntries[4].body, project: 'procurement' } });
      await Community.addComment(e7, 'Legal flagged the SLA clause — needs revision before signing', profile);
      await Community.addComment(e7, 'Budget approved by CFO — proceed once legal clears', profile);
      const e8 = await Community.addEntry(pmColl.id, { type: 'task', profile, content: pmTasks[9] });
      await Community.addComment(e8, 'Great release — zero rollbacks is a team achievement', profile);
      const e9 = await Community.addEntry(pmColl.id, { type: 'task', profile, content: pmTasks[6] });
      await Community.addComment(e9, 'Mobile team lead says they can unblock themselves if we ship auth endpoint by Wednesday', profile);
      const e10 = await Community.addEntry(pmColl.id, { type: 'journal', profile, content: { body: 'Sprint 3 velocity target: 42 points. Team capacity at 85% due to PTO. Adjusted scope: defer notification service to Sprint 4 if needed.', project: 'agile-ops' } });
      await Community.addComment(e10, 'Agreed — notifications can slip if auth migration takes priority', profile);
    }
  } catch (err) {
    console.warn('[demo] Community population skipped:', err.message);
  }

  // Import attribute template packs into the demo profile
  try {
    const { importTemplatePack } = await import('../services/attributes/index.js');
    await importTemplatePack(profile, 'project_management');
    await importTemplatePack(profile, 'development');
    await importTemplatePack(profile, 'financial');
    await importTemplatePack(profile, 'people');
    await importTemplatePack(profile, 'dates');
  } catch (err) {
    console.warn('[demo] Attribute packs import skipped:', err.message);
  }

  // Populate Stream with rich demo data for all lenses
  try {
    await loadStreamDemoData(profile);
  } catch (err) {
    console.warn('[demo] Stream data population skipped:', err.message);
  }
}


// ── Stream Demo Data ─────────────────────────────────────────────────────────

/**
 * Populates the Stream OPFS log with rich demo data spanning 7 days.
 * Covers all op codes: T (tasks), F (frick), B (bundy), D (dey), S (system), A (annotation), M (mutation).
 * This enables all lenses (Burroughs, Bundy, Frick, Felt, Dey, Cooper) to display meaningful data.
 */
async function loadStreamDemoData(profile) {
  const { initLog, append } = await import('../services/stream/log.js');
  const { format: fmtEvent } = await import('../services/stream/format.js');
  const { setEnabled } = await import('../services/stream/config.js');

  // Enable stream for this profile
  await setEnabled(profile, true);
  await initLog(profile);

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  const HOUR = 3600;
  const MIN = 60;

  // Generate task UUIDs for consistent references
  const taskIds = Array.from({ length: 12 }, () => crypto.randomUUID());
  const projects = ['auth-service', 'platform', 'notifications', 'payments', 'devops', 'ui-system'];
  const tagSets = [['backend', 'security'], ['database', 'architecture'], ['websocket', 'backend'], ['testing', 'stripe'], ['ci-cd', 'automation'], ['frontend', 'design-system']];

  const lines = [];

  function emit(ts, op, action, object, ctx = null) {
    lines.push(fmtEvent({ ts, op, action, object, ctx }));
  }

  // ── System events (S) — session boundaries ─────────────────────────────────
  // Simulate 7 days of sessions (2-3 sessions per day)
  for (let day = 6; day >= 0; day--) {
    const dayStart = now - day * DAY;

    // Morning session: 09:00–12:30
    const morningStart = dayStart - (dayStart % DAY) + 9 * HOUR;
    emit(morningStart, 'S', 'session-start', 'stream.log', { prof: profile });

    // Afternoon session: 13:30–17:30
    const afternoonStart = dayStart - (dayStart % DAY) + 13.5 * HOUR;
    emit(morningStart + 3.5 * HOUR, 'S', 'session-end', 'stream.log', { prof: profile });
    emit(afternoonStart, 'S', 'session-start', 'stream.log', { prof: profile });
    emit(afternoonStart + 4 * HOUR, 'S', 'session-end', 'stream.log', { prof: profile });

    // Evening session on some days
    if (day % 2 === 0) {
      const eveningStart = dayStart - (dayStart % DAY) + 20 * HOUR;
      emit(eveningStart, 'S', 'session-start', 'stream.log', { prof: profile });
      emit(eveningStart + 1.5 * HOUR, 'S', 'session-end', 'stream.log', { prof: profile });
    }
  }

  // ── Task events (T) — lifecycle across the week ────────────────────────────
  for (let i = 0; i < taskIds.length; i++) {
    const taskDay = Math.floor(i / 2); // Spread across days
    const baseTs = now - (6 - taskDay) * DAY + 9 * HOUR + i * 20 * MIN;
    const proj = projects[i % projects.length];
    const tags = tagSets[i % tagSets.length];

    emit(baseTs, 'T', 'add', taskIds[i], { src: 'task', prof: profile, proj, tags, name: `Demo task ${i + 1}` });

    // Some tasks get modified
    if (i % 3 === 0) {
      emit(baseTs + 30 * MIN, 'T', 'modify', taskIds[i], { src: 'task', prof: profile, proj, field: 'priority', value: 'H' });
    }

    // Some tasks get started
    if (i < 8) {
      emit(baseTs + HOUR, 'T', 'start', taskIds[i], { src: 'task', prof: profile, proj, tags });
    }

    // Some tasks get completed
    if (i < 5) {
      emit(baseTs + 3 * HOUR, 'T', 'done', taskIds[i], { src: 'task', prof: profile, proj, tags });
    }

    // Some tasks get stopped (not completed)
    if (i >= 5 && i < 8) {
      emit(baseTs + 2 * HOUR, 'T', 'stop', taskIds[i], { src: 'task', prof: profile, proj, tags });
    }
  }

  // ── Frick events (F) — discrete state transitions ──────────────────────────
  // Simulate realistic work patterns: start → work → pause → resume → switch
  for (let day = 6; day >= 0; day--) {
    const dayBase = now - day * DAY - (now % DAY) + 9 * HOUR;

    // Morning work block
    const taskIdx = day % taskIds.length;
    emit(dayBase + 5 * MIN, 'F', 'start', taskIds[taskIdx], { src: 'time', prof: profile, proj: projects[taskIdx % projects.length] });
    emit(dayBase + 45 * MIN, 'F', 'pause', taskIds[taskIdx], { src: 'time', prof: profile });
    emit(dayBase + 55 * MIN, 'F', 'resume', taskIds[taskIdx], { src: 'time', prof: profile });
    emit(dayBase + 90 * MIN, 'F', 'stop', taskIds[taskIdx], { src: 'time', prof: profile });

    // Switch to another task
    const nextIdx = (taskIdx + 1) % taskIds.length;
    emit(dayBase + 95 * MIN, 'F', 'switch', taskIds[nextIdx], { src: 'time', prof: profile, from: taskIds[taskIdx], proj: projects[nextIdx % projects.length] });
    emit(dayBase + 95 * MIN, 'F', 'start', taskIds[nextIdx], { src: 'time', prof: profile, proj: projects[nextIdx % projects.length] });
    emit(dayBase + 150 * MIN, 'F', 'stop', taskIds[nextIdx], { src: 'time', prof: profile });

    // Afternoon block
    const pmBase = dayBase + 4.5 * HOUR;
    const pmIdx = (day + 2) % taskIds.length;
    emit(pmBase, 'F', 'start', taskIds[pmIdx], { src: 'time', prof: profile, proj: projects[pmIdx % projects.length] });
    emit(pmBase + 60 * MIN, 'F', 'pause', taskIds[pmIdx], { src: 'time', prof: profile });
    emit(pmBase + 70 * MIN, 'F', 'resume', taskIds[pmIdx], { src: 'time', prof: profile });
    emit(pmBase + 120 * MIN, 'F', 'stop', taskIds[pmIdx], { src: 'time', prof: profile });
  }

  // ── Bundy events (B) — interval boundaries for time tracking ───────────────
  for (let day = 6; day >= 0; day--) {
    const dayBase = now - day * DAY - (now % DAY) + 9 * HOUR;

    // Morning interval
    const taskIdx = day % taskIds.length;
    emit(dayBase + 5 * MIN, 'B', 'start', taskIds[taskIdx], { src: 'time', prof: profile, proj: projects[taskIdx % projects.length], tags: tagSets[taskIdx % tagSets.length] });
    emit(dayBase + 90 * MIN, 'B', 'stop', taskIds[taskIdx], { src: 'time', prof: profile, duration: 85 * MIN });

    // Second interval
    const nextIdx = (taskIdx + 1) % taskIds.length;
    emit(dayBase + 95 * MIN, 'B', 'start', taskIds[nextIdx], { src: 'time', prof: profile, proj: projects[nextIdx % projects.length], tags: tagSets[nextIdx % tagSets.length] });
    emit(dayBase + 150 * MIN, 'B', 'stop', taskIds[nextIdx], { src: 'time', prof: profile, duration: 55 * MIN });

    // Afternoon interval
    const pmIdx = (day + 2) % taskIds.length;
    emit(dayBase + 4.5 * HOUR, 'B', 'start', taskIds[pmIdx], { src: 'time', prof: profile, proj: projects[pmIdx % projects.length], tags: tagSets[pmIdx % tagSets.length] });
    emit(dayBase + 4.5 * HOUR + 120 * MIN, 'B', 'stop', taskIds[pmIdx], { src: 'time', prof: profile, duration: 120 * MIN });

    // Short interval
    const shortIdx = (day + 3) % taskIds.length;
    emit(dayBase + 7 * HOUR, 'B', 'start', taskIds[shortIdx], { src: 'time', prof: profile, proj: projects[shortIdx % projects.length] });
    emit(dayBase + 7 * HOUR + 25 * MIN, 'B', 'stop', taskIds[shortIdx], { src: 'time', prof: profile, duration: 25 * MIN });
  }

  // ── Dey events (D) — continuous behavioral signal samples ──────────────────
  // Generate samples every 5 minutes during active periods for 7 days
  for (let day = 6; day >= 0; day--) {
    const dayBase = now - day * DAY - (now % DAY) + 9 * HOUR;

    // Morning samples (09:00–12:30) — ramp up, peak, slight dip
    for (let m = 0; m < 42; m++) { // 3.5 hours * 12 samples/hour
      const ts = dayBase + m * 5 * MIN;
      const progress = m / 42;
      // Intensity: ramps up, peaks around 60%, then slight decline
      const i = Math.min(0.95, 0.3 + 0.5 * Math.sin(progress * Math.PI) + (Math.random() * 0.1 - 0.05));
      // Stability: high in focused blocks, dips during transitions
      const s = Math.min(0.95, 0.6 + 0.3 * (1 - Math.abs(progress - 0.5)) + (Math.random() * 0.08 - 0.04));
      // Fragmentation: low when focused, spikes at transitions
      const f = Math.max(0.05, 0.15 + 0.2 * Math.abs(Math.sin(progress * 3 * Math.PI)) + (Math.random() * 0.1 - 0.05));

      emit(ts, 'D', 'sample', `session-${new Date((dayBase) * 1000).toISOString().slice(0, 10)}`, {
        intensity: Math.round(i * 100) / 100,
        stability: Math.round(s * 100) / 100,
        fragmentation: Math.round(f * 100) / 100,
        prof: profile,
      });
    }

    // Afternoon samples (13:30–17:30) — post-lunch dip, recovery, sustained
    for (let m = 0; m < 48; m++) { // 4 hours * 12 samples/hour
      const ts = dayBase + Math.floor(4.5 * HOUR) + m * 5 * MIN;
      const progress = m / 48;
      // Post-lunch dip then recovery
      const i = Math.min(0.95, 0.2 + 0.6 * (progress < 0.2 ? progress * 3 : 0.8 + 0.15 * Math.sin((progress - 0.2) * 4)) + (Math.random() * 0.08 - 0.04));
      const s = Math.min(0.95, 0.5 + 0.35 * progress + (Math.random() * 0.06 - 0.03));
      const f = Math.max(0.05, 0.25 - 0.15 * progress + 0.1 * Math.sin(progress * 5 * Math.PI) + (Math.random() * 0.08 - 0.04));

      emit(ts, 'D', 'sample', `session-${new Date((dayBase) * 1000).toISOString().slice(0, 10)}`, {
        intensity: Math.round(i * 100) / 100,
        stability: Math.round(s * 100) / 100,
        fragmentation: Math.round(f * 100) / 100,
        prof: profile,
      });
    }
  }

  // ── Annotation events (A) — journal entries and notes ──────────────────────
  const annotations = [
    { day: 6, offset: 10 * HOUR, action: 'write', text: 'Started deep work on auth migration. PKCE flow requires careful token handling.' },
    { day: 5, offset: 9.5 * HOUR, action: 'write', text: 'Multi-tenancy schema review. RLS approach looks promising for isolation.' },
    { day: 5, offset: 14 * HOUR, action: 'annotate', text: 'Need to benchmark RLS performance under load.' },
    { day: 4, offset: 10 * HOUR, action: 'write', text: 'WebSocket service design session. Going with native ws + Redis pub/sub.' },
    { day: 4, offset: 15 * HOUR, action: 'write', text: 'Sprint planning complete. 42 points committed.' },
    { day: 3, offset: 9 * HOUR, action: 'write', text: 'Payment webhook tests passing. Idempotency key handling verified.' },
    { day: 3, offset: 11 * HOUR, action: 'annotate', text: 'Edge case: duplicate webhook delivery within 5s window.' },
    { day: 2, offset: 10 * HOUR, action: 'write', text: 'CI/CD pipeline draft. Lint → Test → Build → Deploy stages defined.' },
    { day: 2, offset: 14.5 * HOUR, action: 'write', text: 'Vendor evaluation complete. Datadog selected for monitoring.' },
    { day: 1, offset: 9 * HOUR, action: 'write', text: 'CORS fix deployed. Root cause: nginx stripping credentials header.' },
    { day: 1, offset: 15 * HOUR, action: 'write', text: 'OKR draft for Q3: reliability, velocity, developer experience.' },
    { day: 0, offset: 9.5 * HOUR, action: 'write', text: 'Morning standup notes. Auth migration on track, mobile team unblocked.' },
    { day: 0, offset: 11 * HOUR, action: 'annotate', text: 'Token refresh edge case resolved with proactive refresh strategy.' },
  ];

  for (const ann of annotations) {
    const ts = now - ann.day * DAY - (now % DAY) + ann.offset;
    const jrnlId = `jrnl:${100 + annotations.indexOf(ann)}`;
    emit(ts, 'A', ann.action, jrnlId, { src: 'journal', prof: profile, text: ann.text, proj: projects[ann.day % projects.length] });
  }

  // ── Mutation events (M) — field changes, tag operations, navigation ────────
  // Navigation events (spread throughout the week)
  const sections = ['tasks', 'time', 'journal', 'ledger', 'lists', 'tags', 'stream', 'projects', 'community'];
  for (let day = 6; day >= 0; day--) {
    const dayBase = now - day * DAY - (now % DAY) + 9 * HOUR;
    // Simulate 15-25 navigation events per day
    const navCount = 15 + Math.floor(Math.random() * 11);
    for (let n = 0; n < navCount; n++) {
      const ts = dayBase + Math.floor(Math.random() * 8 * HOUR);
      const from = sections[Math.floor(Math.random() * sections.length)];
      const to = sections[Math.floor(Math.random() * sections.length)];
      if (from !== to) {
        emit(ts, 'M', 'nav', to, { src: 'nav', prof: profile, from, to });
      }
    }

    // Tag operations
    if (day % 2 === 0) {
      const tagTs = dayBase + 2 * HOUR;
      emit(tagTs, 'M', 'tag-add', taskIds[day % taskIds.length], { src: 'task', prof: profile, tag: 'urgent' });
    }
    if (day % 3 === 0) {
      const fieldTs = dayBase + 3 * HOUR;
      emit(fieldTs, 'M', 'field', taskIds[(day + 1) % taskIds.length], { src: 'task', prof: profile, field: 'priority', old: 'M', new: 'H' });
    }

    // List operations
    if (day % 2 === 1) {
      const listTs = dayBase + 5 * HOUR;
      emit(listTs, 'M', 'item-add', `list:${200 + day}`, { src: 'list', prof: profile, list: 'web_developer', text: `Research item day ${day}` });
    }
  }

  // ── Sort all lines by timestamp and write to OPFS ──────────────────────────
  // Parse timestamps for sorting
  lines.sort((a, b) => {
    const tsA = parseInt(a.split(' ')[0]);
    const tsB = parseInt(b.split(' ')[0]);
    return tsA - tsB;
  });

  // Bulk write: join all lines and write as a single append for performance
  // The log already has a header from initLog(), so we just append all events
  const bulkContent = lines.join('\n');
  await append(profile, bulkContent);

  // Also enable stream in config and set initial preferences
  await setMeta(profile, 'stream_enabled', true);
  await setMeta(profile, 'stream_config', {
    snapshot_events: 1000,
    snapshot_minutes: 30,
    dey_interval: 60,
    gap_threshold: 300,
    precision: 'seconds',
    zero_activity_mode: 'suppress',
  });
}
