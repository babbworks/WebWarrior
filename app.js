// app.js — Webwarrior entry point
// All data stays in the browser. No network requests after page load.

import { ensureDefaultProfile, listProfiles, createProfile, deleteProfile, getActive, setActive, getJournals, addJournal, getLedgers, addLedger, getUdaKeys, addUdaKey, getTaskLists, addTaskList, removeTaskList, getTimeLogs, addTimeLog, removeTimeLog } from './storage/profiles.js';
import * as Tasks     from './services/tasks/index.js';
import * as Time      from './services/time/index.js';
import * as Journal   from './services/journal/index.js';
import * as Ledger    from './services/ledger/index.js';
import * as Lists     from './services/lists/index.js';
import * as Next      from './services/next/index.js';
import * as Warrior   from './services/warrior/index.js';
import * as Questions from './services/questions/index.js';
import * as Community from './services/community/index.js';
import * as Export    from './services/export/index.js';
import * as Render    from './ui/render.js';
import { Terminal }   from './ui/terminal.js';
import { showToast, confirm, promptText } from './ui/modals.js';
import { importFromFolder, loadDemoData } from './storage/import.js';

// ── State ────────────────────────────────────────────────────────────────────

let activeSection = 'tasks';
let activeProfile = null;
let taskGroupMode = false;
let taskShowDone  = false;
let taskShowAnns  = false;
let bulkSelected  = new Set();
let activeTaskList    = 'main';
let activeTimeLog     = 'main';
let activeJournal     = 'main';
let journalTheme      = 'default';
let journalFilterMode = 'all';
let twainRecentSections   = [];
let twainRecentTags       = [];
let twainHiddenSections   = new Set();
let twainSectionsCollapsed = false;
let twainTagsCollapsed     = false;
let journalShowMd     = false;
let journalShowArchived = false;
let timeTagFilter  = '';
let timeDateRange  = 'all';
let activeLedger  = 'main';
let activeReport  = 'balance';
let filterText    = '';
let ledgerSearchText = '';
let tagsSort      = 'name';

const scrollPositions = new Map();

const terminal = new Terminal({
  onNavigate: (section) => showSection(section),
  onCommand:  (cmd) => handleCommand(cmd),
  onFilter:   (q)   => applyFilter(q),
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  activeProfile = await ensureDefaultProfile();
  journalTheme  = localStorage.getItem('ww_journal_theme') || 'default';
  terminal.init();
  terminal.setProfile(activeProfile);
  initBroadcastChannel();
  updateHeader();
  wireSidebar();
  wireProfileSwitcher();
  wireTaskDrawer();
  wireJournalDrawer();
  wireLedgerDrawer();
  wireTimeDrawer();
  wireTaskSection();
  wireTimeSection();
  wireJournalSection();
  wireLedgerSection();
  wireListsSection();
  wireTagsSection();
  wireNextSection();
  wireWarriorSection();
  wireCommunitySection();
  wireQuestionsSection();
  wireProjectsSection();
  wireExportSection();
  wireImportSection();
  wireProfileSection();
  wireCtrlSection();
  wireDensity();
  wireHelpClose();
  await showSection(activeSection, { noScroll: true });
  updateStat();
}

// ── Section navigation ───────────────────────────────────────────────────────

const SECTION_TITLES = {
  tasks:     'Tasks',
  time:      'Times',
  journal:   'Journals',
  ledger:    'Ledgers',
  lists:     'Lists',
  tags:      'Tags',
  next:      'Next',
  warrior:   'Warrior',
  community: 'Community',
  questions: 'Questions',
  projects:  'Projects',
  export:    'Export',
  import:    'Import',
  profile:   'Profiles',
  ctrl:      'Settings',
};

// Theme-specific modes. Maps theme → array of {value, label} mode options.
const THEME_MODES = {
  twain: [{ value: '', label: '—' }, { value: 'river', label: '〰 river' }],
};

function updateThemeModeSelect(theme, resetValue = true) {
  const sel = document.getElementById('global-mode-select');
  if (!sel) return;
  const modes = THEME_MODES[theme];
  if (!modes) {
    sel.innerHTML = '<option value="">—</option>';
    sel.disabled = true;
    sel.value = '';
    return;
  }
  sel.disabled = false;
  sel.innerHTML = modes.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  if (resetValue) sel.value = '';
}

function syncThemeModeSelectToRiver() {
  const sel = document.getElementById('global-mode-select');
  if (!sel) return;
  sel.value = document.body.classList.contains('river-mode') ? 'river' : '';
}

async function showSection(name, { noScroll = false } = {}) {
  if (scrollPositions.has(activeSection)) {
    const area = document.getElementById('content-area');
    if (area) scrollPositions.set(activeSection, area.scrollTop);
  }

  activeSection = name;
  filterText = '';

  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`section-${name}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-item, .cmd-ctrl-btn').forEach(btn => {
    const sec = btn.dataset.section;
    btn.classList.toggle('active', sec === name);
  });

  const titleEl = document.getElementById('section-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[name] || name;

  document.querySelectorAll('[data-resource-section]').forEach(el => el.classList.add('hidden'));
  const resourceBar = document.querySelector(`[data-resource-section="${name}"]`);
  if (resourceBar) resourceBar.classList.remove('hidden');

  // Twain journal mode needs the content-area overflow change only when journal is visible
  const contentArea = document.getElementById('content-area');
  if (name === 'journal' && journalTheme === 'twain') {
    contentArea?.classList.add('twain-journal-active');
  } else {
    contentArea?.classList.remove('twain-journal-active');
  }

  if (!noScroll) {
    const area = document.getElementById('content-area');
    if (area) area.scrollTop = scrollPositions.get(name) || 0;
  }

  await loadSection(name);
}

async function loadSection(name) {
  switch (name) {
    case 'tasks':     return loadTasks();
    case 'time':      return loadTime();
    case 'journal':   return loadJournal();
    case 'ledger':    return loadLedger();
    case 'lists':     return loadLists();
    case 'tags':      return loadTags();
    case 'next':      return loadNext();
    case 'warrior':   return loadWarrior();
    case 'community': return loadCommunity();
    case 'questions': return loadQuestions();
    case 'projects':  return loadProjects();
    case 'profile':   return loadProfile();
    case 'ctrl':      return loadCtrl();
  }
}

// ── Tasks ────────────────────────────────────────────────────────────────────

async function loadTasks() {
  // Populate sub-list selector
  const taskLists = await getTaskLists(activeProfile);
  const tlSel = document.getElementById('task-list-select');
  if (tlSel) {
    tlSel.innerHTML = taskLists.map(l =>
      `<option value="${esc(l)}" ${l === activeTaskList ? 'selected' : ''}>${esc(l)}</option>`
    ).join('');
  }

  const tasks = await Tasks.getTasks(activeProfile, { includeDone: false, taskList: activeTaskList });
  Render.renderTasks(tasks, { filterText, groupByProject: taskGroupMode, showAnnotations: taskShowAnns, bulkSelected });
  Render.updateWarriorStats(tasks.length);
  updateTaskStats(tasks.length);

  if (taskShowDone) {
    const done = await Tasks.getTasks(activeProfile, { includeDone: true, taskList: activeTaskList });
    Render.renderDoneTasks(done.filter(t => t.status === 'completed'));
  }
}

function wireTaskSection() {
  const form = document.getElementById('add-task-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const desc = fd.get('description')?.trim();
    if (!desc) return;
    await Tasks.addTask(activeProfile, {
      taskList:    activeTaskList,
      description: desc,
      project:     fd.get('project')?.trim() || '',
      tags:        fd.get('tags')?.trim() || '',
      priority:    fd.get('priority') || '',
      due:         fd.get('due') || null,
      scheduled:   fd.get('scheduled') || null,
      wait:        fd.get('wait') || null,
    });
    form.reset();
    showToast('Task added');
    await loadTasks();
  });

  document.getElementById('btn-task-start-new')?.addEventListener('click', async () => {
    const fd = new FormData(form);
    const desc = fd.get('description')?.trim();
    if (!desc) { showToast('Enter a description first', 'warning'); return; }
    const task = await Tasks.addTask(activeProfile, {
      taskList:    activeTaskList,
      description: desc,
      project:     fd.get('project')?.trim() || '',
      tags:        fd.get('tags')?.trim() || '',
      priority:    fd.get('priority') || '',
    });
    await Tasks.startTask(activeProfile, task.uuid);
    form.reset();
    showToast('Task started');
    await loadTasks();
  });

  // Sub-list selector
  document.getElementById('task-list-select')?.addEventListener('change', (e) => {
    activeTaskList = e.target.value;
    loadTasks();
  });

  document.getElementById('btn-new-task-list')?.addEventListener('click', async () => {
    const name = await promptText('Task list name:');
    if (!name?.trim()) return;
    const clean = name.trim();
    await addTaskList(activeProfile, clean);
    activeTaskList = clean;
    showToast(`List "${clean}" created`);
    await loadTasks();
  });

  document.getElementById('btn-del-task-list')?.addEventListener('click', async () => {
    if (activeTaskList === 'main') { showToast('Cannot remove the main list', 'warning'); return; }
    if (!await confirm(`Remove task list "${activeTaskList}"? Tasks in it will remain but become unlisted.`)) return;
    await removeTaskList(activeProfile, activeTaskList);
    activeTaskList = 'main';
    showToast('List removed');
    await loadTasks();
  });

  document.getElementById('btn-group-toggle')?.addEventListener('click', () => {
    taskGroupMode = !taskGroupMode;
    loadTasks();
  });

  document.getElementById('btn-show-done-tasks')?.addEventListener('click', async () => {
    taskShowDone = !taskShowDone;
    document.getElementById('task-done-list')?.classList.toggle('hidden', !taskShowDone);
    document.getElementById('btn-show-done-tasks')?.classList.toggle('active', taskShowDone);
    await loadTasks();
  });

  document.getElementById('btn-ann-toggle')?.addEventListener('click', () => {
    taskShowAnns = !taskShowAnns;
    document.getElementById('btn-ann-toggle')?.classList.toggle('active', taskShowAnns);
    loadTasks();
  });

  document.getElementById('task-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadTasks();
  });

  // Delegate task action clicks
  document.getElementById('task-list')?.addEventListener('click', async (e) => {
    // Inline panel submit/cancel (must check before data-action routing)
    const panelBtn = e.target.closest('[data-panel-action]');
    if (panelBtn) { await handleTaskInlinePanelAction(panelBtn); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, uuid } = el.dataset;
    if (action === 'select') { toggleBulkSelect(uuid, el.checked); return; }
    if (action === 'open-drawer' || action === 'expand') { openTaskDrawer(uuid); return; }
    if (action === 'task-community') { await openTaskCommunityPanel(el); return; }
    await handleTaskAction(action, uuid);
  });

  document.getElementById('task-done-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) await handleTaskAction(btn.dataset.action, btn.dataset.uuid);
  });

  wireBulkToolbar();
}

async function handleTaskAction(action, uuid) {
  switch (action) {
    case 'done':     await Tasks.completeTask(activeProfile, uuid); showToast('Done'); break;
    case 'delete': {
      if (!await confirm('Delete this task?')) return;
      await Tasks.deleteTask(activeProfile, uuid); showToast('Deleted');
      break;
    }
    case 'start':    await Tasks.startTask(activeProfile, uuid); showToast('Started'); break;
    case 'stop':     await Tasks.stopTask(activeProfile, uuid); showToast('Stopped'); break;
    case 'annotate': {
      const text = await promptText('Annotation:');
      if (!text) return;
      await Tasks.annotateTask(activeProfile, uuid, text); showToast('Annotated');
      break;
    }
  }
  await loadTasks();
}

// ── Task inline community panel ───────────────────────────────────────────────

function closeAllTaskPanels() {
  document.querySelectorAll('#task-list .jrnl-inline-panel.open').forEach(p => {
    p.classList.remove('open'); p.innerHTML = '';
  });
}

async function openTaskCommunityPanel(btn) {
  const uuid  = btn.dataset.uuid;
  const panel = document.querySelector(`.jrnl-inline-panel[data-panel="task-${uuid}"]`);
  if (!panel) return;

  if (panel.classList.contains('open')) { closeAllTaskPanels(); return; }
  closeAllTaskPanels();

  const collections = await Community.listCollections();
  const active = collections.filter(c => !c.archived_at);

  if (active.length === 0) {
    panel.innerHTML = `<div class="jrnl-inline-panel-inner"><div class="jrnl-panel-row">
      <span class="jrnl-panel-confirm">No collections yet — create one in Community first.</span>
      <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel-task-panel" data-uuid="${uuid}">close</button>
    </div></div>`;
    panel.classList.add('open');
    return;
  }

  const opts = active.map(c => `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  panel.innerHTML = `<div class="jrnl-inline-panel-inner"><div class="jrnl-panel-row">
    <select class="jrnl-panel-select" data-field="coll-id">${opts}</select>
    <input class="jrnl-panel-input" data-field="comm-note" placeholder="optional note…" style="flex:2">
    <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-task-community" data-uuid="${uuid}">→ add</button>
    <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel-task-panel" data-uuid="${uuid}">cancel</button>
  </div></div>`;
  panel.classList.add('open');
  panel.querySelector('input')?.focus();
}

async function handleTaskInlinePanelAction(btn) {
  const action = btn.dataset.panelAction;
  const uuid   = btn.dataset.uuid;

  if (action === 'cancel-task-panel') {
    closeAllTaskPanels();
    return;
  }

  if (action === 'submit-task-community') {
    const panel = document.querySelector(`.jrnl-inline-panel[data-panel="task-${uuid}"]`);
    const collSel = panel?.querySelector('[data-field="coll-id"]');
    const collId  = parseInt(collSel?.value);
    const collName = collSel?.options[collSel.selectedIndex]?.dataset.name || '';
    const note    = panel?.querySelector('[data-field="comm-note"]')?.value.trim();

    if (!collId) return;
    const task = await Tasks.getTask(activeProfile, uuid);
    if (!task) return;

    await Community.addEntry(collId, { type: 'task', profile: activeProfile, content: task });

    // Annotate the task with the community action
    const today = new Date().toISOString().slice(0, 10);
    const ann   = note
      ? `shared to community/${collName} — "${note}" (${today})`
      : `shared to community/${collName} (${today})`;
    await Tasks.annotateTask(activeProfile, uuid, ann);

    showToast(`Added to ${collName}`);
    closeAllTaskPanels();
    await loadTasks();
  }
}

// ── Task Detail Drawer ────────────────────────────────────────────────────────

const TASK_CORE_KEYS = new Set([
  'uuid','status','description','project','tags','priority','due','scheduled',
  'wait','start','end','depends','annotations','urgency','modified','entry',
]);

let _drawerUuid = null;
let _drawerTask = null;
let _allTasksCache = [];

async function openTaskDrawer(uuid) {
  if (!uuid) return;
  _drawerUuid = uuid;
  _drawerTask  = await Tasks.getTask(activeProfile, uuid);
  if (!_drawerTask) return;

  _allTasksCache = await Tasks.getTasks(activeProfile, { includeDone: false });

  const drawer = document.getElementById('task-drawer');
  drawer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Mark row as open
  document.querySelectorAll('.task-row.drawer-open').forEach(r => r.classList.remove('drawer-open'));
  document.querySelector(`.task-row[data-uuid="${uuid}"]`)?.classList.add('drawer-open');

  populateDrawer(_drawerTask);
}

function closeTaskDrawer() {
  const drawer = document.getElementById('task-drawer');
  drawer.classList.add('hidden');
  document.body.style.overflow = '';
  document.querySelectorAll('.task-row.drawer-open').forEach(r => r.classList.remove('drawer-open'));
  _drawerUuid = null;
  _drawerTask  = null;
}

function populateDrawer(t) {
  const level = (t.urgency >= 10 ? 'high' : t.urgency >= 5 ? 'med' : 'low');

  // Header
  document.getElementById('tdr-urgency-score').textContent = t.urgency.toFixed(1);
  document.getElementById('tdr-header-project').textContent = t.project || '';
  document.getElementById('tdr-header-project').style.display = t.project ? '' : 'none';
  document.getElementById('tdr-header-title').textContent = t.description;
  document.getElementById('tdr-header-tags').innerHTML = (t.tags||[]).map(g => `<span class="task-tag">${esc(g)}</span>`).join('');

  // Header action buttons
  const isActive = t.status === 'active';
  document.getElementById('tdr-header-actions').innerHTML = `
    ${isActive
      ? `<button data-tdr-action="stop">■ stop</button>`
      : `<button data-tdr-action="start">▶ start</button>`}
    <button class="tdr-btn-primary" data-tdr-action="done">✓ done</button>
    <button data-tdr-action="delete" style="color:var(--error);border-color:var(--error)">✗ delete</button>
  `;

  // Core fields
  const toDateVal = iso => iso ? iso.slice(0,10) : '';
  document.getElementById('tdr-desc').value  = t.description || '';
  document.getElementById('tdr-proj').value  = t.project     || '';
  document.getElementById('tdr-pri').value   = t.priority    || '';
  document.getElementById('tdr-due').value   = toDateVal(t.due);
  document.getElementById('tdr-sched').value = toDateVal(t.scheduled);
  document.getElementById('tdr-wait').value  = toDateVal(t.wait);
  document.getElementById('tdr-tags').value  = (t.tags||[]).join(', ');
  document.getElementById('tdr-status').textContent  = t.status || '';
  document.getElementById('tdr-urgency-val').textContent = t.urgency.toFixed(2);
  document.getElementById('tdr-created').textContent = t.entry ? new Date(t.entry).toLocaleDateString('en', { year:'numeric', month:'short', day:'numeric' }) : '';

  populateUdas(t);
  populateAnnotations(t);
  populateDeps(t);
  populateDrawerJournalSelect();
  populateDrawerCommunitySelect();
  populateDrawerTaskListSelect(t);
  populateUdaDatalist();
}

async function populateUdaDatalist() {
  const keys = await getUdaKeys(activeProfile);
  const dl = document.getElementById('tdr-uda-datalist');
  if (dl) dl.innerHTML = keys.map(k => `<option value="${esc(k)}">`).join('');
}

function populateUdas(t) {
  const udas = Object.entries(t).filter(([k]) => !TASK_CORE_KEYS.has(k));
  const el = document.getElementById('tdr-uda-list');
  if (!el) return;
  if (udas.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:3px 0">No UDAs.</div>';
    return;
  }
  el.innerHTML = udas.map(([k, v]) => `
    <div class="tdr-uda-row">
      <span class="tdr-uda-key">${esc(k)}</span>
      <span class="tdr-uda-val">${esc(String(v))}</span>
      <button class="tdr-uda-del" data-tdr-uda-del="${esc(k)}">✗</button>
    </div>
  `).join('');
}

function populateAnnotations(t) {
  const el = document.getElementById('tdr-annotations');
  if (!el) return;
  const anns = t.annotations || [];
  el.innerHTML = `
    <div class="tdr-section-header">ANNOTATIONS</div>
    ${anns.length === 0 ? '<div style="font-size:11px;color:var(--muted);padding:3px 0">None.</div>' : ''}
    <div class="tdr-ann-list">${anns.map((a, i) => `
      <div class="tdr-ann-item">
        <span class="tdr-ann-date">${a.entry ? new Date(a.entry).toLocaleDateString('en',{month:'short',day:'numeric'}) : ''}</span>
        <span class="tdr-ann-text">${esc(a.description)}</span>
        <button class="tdr-ann-del" data-tdr-ann-del="${i}">✗</button>
      </div>
    `).join('')}</div>
  `;
}

function populateDeps(t) {
  const el = document.getElementById('tdr-dep-list');
  if (!el) return;
  const deps = t.depends || [];
  if (deps.length === 0) {
    el.innerHTML = '<div class="tdr-dep-empty">no dependencies</div>';
    return;
  }
  el.innerHTML = deps.map(dep => {
    const found = _allTasksCache.find(x => x.uuid === dep.uuid);
    const desc = found ? found.description : dep.uuid;
    const dir = dep.direction === 'blocks' ? 'blocks' : 'blocked by';
    return `
      <div class="tdr-dep-item">
        <span class="tdr-dep-direction">${dir}</span>
        <span class="tdr-dep-desc">${esc(desc)}</span>
        <span class="tdr-dep-uuid" style="font-size:10px;color:var(--muted);font-family:monospace">${dep.uuid.slice(0,8)}</span>
        <button class="tdr-dep-del" data-tdr-dep-del="${dep.uuid}">✗</button>
      </div>
    `;
  }).join('');
}

async function populateDrawerJournalSelect() {
  const journals = await getJournals(activeProfile);
  const sel = document.getElementById('tdr-journal-select');
  if (!sel) return;
  sel.innerHTML = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
}

async function populateDrawerTaskListSelect(t) {
  const lists = await getTaskLists(activeProfile);
  const sel = document.getElementById('tdr-task-list');
  if (!sel) return;
  const cur = t.taskList || 'main';
  sel.innerHTML = lists.map(l => `<option value="${esc(l)}" ${l === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

async function populateDrawerCommunitySelect() {
  const collections = await Community.listCollections();
  const active = collections.filter(c => !c.archived_at);
  const sel = document.getElementById('tdr-community-select');
  if (!sel) return;
  sel.innerHTML = active.length === 0
    ? '<option value="">no collections</option>'
    : active.map(c => `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
}

async function saveDrawer() {
  if (!_drawerUuid || !_drawerTask) return;

  // Collect core field values
  const rawTags = document.getElementById('tdr-tags').value;
  const tags = rawTags.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

  const updates = {
    taskList:    document.getElementById('tdr-task-list')?.value || 'main',
    description: document.getElementById('tdr-desc').value.trim(),
    project:     document.getElementById('tdr-proj').value.trim(),
    priority:    document.getElementById('tdr-pri').value,
    due:         document.getElementById('tdr-due').value || null,
    scheduled:   document.getElementById('tdr-sched').value || null,
    wait:        document.getElementById('tdr-wait').value || null,
    tags,
  };

  // Collect current UDAs (re-read from DOM)
  const udaRows = document.querySelectorAll('.tdr-uda-row');
  const udas = {};
  udaRows.forEach(row => {
    const key = row.querySelector('.tdr-uda-key')?.textContent?.trim();
    const val = row.querySelector('.tdr-uda-val')?.textContent?.trim();
    if (key) udas[key] = val;
  });

  await Tasks.updateTask(activeProfile, _drawerUuid, { ...updates, ...udas });
  _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
  populateDrawer(_drawerTask);
  await loadTasks();
  showToast('Task saved');
}

function wireTaskDrawer() {
  const drawer = document.getElementById('task-drawer');
  if (!drawer) return;

  // Close on backdrop click
  document.getElementById('tdr-backdrop')?.addEventListener('click', closeTaskDrawer);

  // Close button
  document.getElementById('tdr-close')?.addEventListener('click', closeTaskDrawer);

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('task-drawer').classList.contains('hidden')) {
      closeTaskDrawer();
    }
  });

  // Header action buttons (start/stop/done/delete)
  document.getElementById('tdr-header-actions')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tdr-action]');
    if (!btn || !_drawerUuid) return;
    const action = btn.dataset.tdrAction;
    if (action === 'delete') {
      if (!await confirm('Delete this task?')) return;
      await Tasks.deleteTask(activeProfile, _drawerUuid);
      showToast('Deleted');
      closeTaskDrawer();
      await loadTasks();
      return;
    }
    await handleTaskAction(action, _drawerUuid);
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    if (_drawerTask) populateDrawer(_drawerTask);
  });

  // Save button
  document.getElementById('btn-tdr-save')?.addEventListener('click', saveDrawer);

  // Add UDA
  document.getElementById('btn-tdr-add-uda')?.addEventListener('click', async () => {
    const key = document.getElementById('tdr-uda-key').value.trim();
    const val = document.getElementById('tdr-uda-val').value.trim();
    if (!key) { showToast('Enter a UDA key', 'warning'); return; }
    await Tasks.updateTask(activeProfile, _drawerUuid, { [key]: val });
    await addUdaKey(activeProfile, key);
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateUdas(_drawerTask);
    populateUdaDatalist();
    document.getElementById('tdr-uda-key').value = '';
    document.getElementById('tdr-uda-val').value = '';
    showToast(`UDA "${key}" set`);
  });

  // Delete UDA (delegated)
  document.getElementById('tdr-uda-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tdr-uda-del]');
    if (!btn || !_drawerUuid) return;
    const key = btn.dataset.tdrUdaDel;
    // Set to empty string = effectively clear; updateTask will omit it if we delete
    const patch = { [key]: undefined };
    await Tasks.updateTask(activeProfile, _drawerUuid, patch);
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateUdas(_drawerTask);
  });

  // Add annotation
  document.getElementById('btn-tdr-annotate')?.addEventListener('click', async () => {
    const text = document.getElementById('tdr-ann-text').value.trim();
    if (!text) return;
    await Tasks.annotateTask(activeProfile, _drawerUuid, text);
    document.getElementById('tdr-ann-text').value = '';
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateAnnotations(_drawerTask);
    showToast('Annotation added');
  });
  document.getElementById('tdr-ann-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-tdr-annotate').click(); }
  });

  // Delete annotation (delegated)
  document.getElementById('tdr-annotations')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tdr-ann-del]');
    if (!btn || !_drawerTask) return;
    const idx = parseInt(btn.dataset.tdrAnnDel);
    const anns = [...(_drawerTask.annotations || [])];
    anns.splice(idx, 1);
    await Tasks.updateTask(activeProfile, _drawerUuid, { annotations: anns });
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateAnnotations(_drawerTask);
    showToast('Annotation removed');
  });

  // Note to journal
  document.getElementById('btn-tdr-to-journal')?.addEventListener('click', async () => {
    const text = document.getElementById('tdr-journal-text').value.trim();
    const jname = document.getElementById('tdr-journal-select').value || activeJournal;
    if (!text) return;
    const body = `${text}\n[task: ${_drawerTask.description}]`;
    await Journal.addEntry(activeProfile, { body, journal: jname });
    // Add annotation back-reference on the task
    const ref = `journaled: ${new Date().toISOString().slice(0,10)}`;
    await Tasks.annotateTask(activeProfile, _drawerUuid, ref);
    document.getElementById('tdr-journal-text').value = '';
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateAnnotations(_drawerTask);
    showToast(`Added to ${jname} journal`);
  });
  document.getElementById('tdr-journal-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-tdr-to-journal').click(); }
  });

  // Share to community
  document.getElementById('btn-tdr-to-community')?.addEventListener('click', async () => {
    if (!_drawerTask) return;
    const collSel  = document.getElementById('tdr-community-select');
    const collId   = parseInt(collSel?.value);
    const collName = collSel?.options[collSel.selectedIndex]?.dataset.name || '';
    if (!collId) { showToast('No collections — create one in Community first', 'warning'); return; }

    const note  = document.getElementById('tdr-community-note').value.trim();
    await Community.addEntry(collId, { type: 'task', profile: activeProfile, content: _drawerTask });

    const today = new Date().toISOString().slice(0, 10);
    const ann   = note
      ? `shared to community/${collName} — "${note}" (${today})`
      : `shared to community/${collName} (${today})`;
    await Tasks.annotateTask(activeProfile, _drawerUuid, ann);

    document.getElementById('tdr-community-note').value = '';
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateAnnotations(_drawerTask);
    showToast(`Added to ${collName}`);
    await loadTasks();
  });

  // Dependency search (live)
  document.getElementById('tdr-dep-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const resultsEl = document.getElementById('tdr-dep-results');
    if (!q || q.length < 2) { resultsEl.classList.add('hidden'); return; }
    const matches = _allTasksCache.filter(t =>
      t.uuid !== _drawerUuid &&
      (t.description.toLowerCase().includes(q) || t.uuid.startsWith(q))
    ).slice(0, 8);
    if (matches.length === 0) { resultsEl.classList.add('hidden'); return; }
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = matches.map(t => `
      <div class="tdr-dep-result-item" data-dep-uuid="${esc(t.uuid)}">
        <span style="flex:1">${esc(t.description)}</span>
        <span class="tdr-dep-result-uuid">${t.uuid.slice(0,8)}</span>
      </div>
    `).join('');
  });

  // Select from dep search results — mark with direction, then add via button
  let _pendingDepUuid = null;
  document.getElementById('tdr-dep-results')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-dep-uuid]');
    if (!item) return;
    _pendingDepUuid = item.dataset.depUuid;
    document.getElementById('tdr-dep-search').value = item.querySelector('span').textContent;
    document.getElementById('tdr-dep-results').classList.add('hidden');
  });

  async function addDep(direction) {
    const search = document.getElementById('tdr-dep-search').value.trim();
    const targetUuid = _pendingDepUuid || _allTasksCache.find(t =>
      t.description.toLowerCase() === search.toLowerCase() || t.uuid === search
    )?.uuid;
    if (!targetUuid) { showToast('Task not found', 'warning'); return; }

    const deps = [...(_drawerTask.depends || [])];
    if (deps.some(d => d.uuid === targetUuid)) { showToast('Already a dependency', 'warning'); return; }
    deps.push({ uuid: targetUuid, direction });
    await Tasks.updateTask(activeProfile, _drawerUuid, { depends: deps });
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateDeps(_drawerTask);
    document.getElementById('tdr-dep-search').value = '';
    _pendingDepUuid = null;
    showToast(`Dependency added`);
  }

  document.getElementById('btn-tdr-blocked-by')?.addEventListener('click', () => addDep('blocked-by'));
  document.getElementById('btn-tdr-blocks')?.addEventListener('click',     () => addDep('blocks'));

  // Remove dependency (delegated)
  document.getElementById('tdr-dep-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tdr-dep-del]');
    if (!btn || !_drawerTask) return;
    const depUuid = btn.dataset.tdrDepDel;
    const deps = (_drawerTask.depends || []).filter(d => d.uuid !== depUuid);
    await Tasks.updateTask(activeProfile, _drawerUuid, { depends: deps });
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateDeps(_drawerTask);
    showToast('Dependency removed');
  });
}

function toggleBulkSelect(uuid, checked) {
  if (checked) bulkSelected.add(uuid); else bulkSelected.delete(uuid);
  document.getElementById('bulk-toolbar')?.classList.toggle('hidden', bulkSelected.size === 0);
  const countEl = document.getElementById('bulk-count');
  if (countEl) countEl.textContent = `${bulkSelected.size} selected`;
}

function wireBulkToolbar() {
  document.getElementById('bulk-select-all')?.addEventListener('change', async (e) => {
    const tasks = await Tasks.getTasks(activeProfile);
    if (e.target.checked) tasks.forEach(t => bulkSelected.add(t.uuid));
    else bulkSelected.clear();
    await loadTasks();
    document.getElementById('bulk-toolbar')?.classList.toggle('hidden', bulkSelected.size === 0);
  });

  document.getElementById('bulk-toolbar')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-bulk');
    if (!btn) return;
    const op = btn.dataset.op;
    const ids = [...bulkSelected];
    if (ids.length === 0) return;

    switch (op) {
      case 'done':         await Tasks.bulkComplete(activeProfile, ids); break;
      case 'delete':
        if (!await confirm(`Delete ${ids.length} tasks?`)) return;
        await Tasks.bulkDelete(activeProfile, ids); break;
      case 'set-project': {
        const p = document.getElementById('bulk-project-input')?.value.trim();
        if (p) await Tasks.bulkSetProject(activeProfile, ids, p);
        break;
      }
      case 'add-tag': {
        const t = document.getElementById('bulk-tag-input')?.value.trim();
        if (t) await Tasks.bulkAddTag(activeProfile, ids, t);
        break;
      }
      case 'remove-tag': {
        const t = document.getElementById('bulk-tag-input')?.value.trim();
        if (t) await Tasks.bulkRemoveTag(activeProfile, ids, t);
        break;
      }
      case 'set-priority': {
        const p = document.getElementById('bulk-priority-select')?.value;
        if (p) await Tasks.bulkSetPriority(activeProfile, ids, p);
        break;
      }
    }
    bulkSelected.clear();
    document.getElementById('bulk-toolbar')?.classList.add('hidden');
    showToast('Done');
    await loadTasks();
  });
}

// ── Time ─────────────────────────────────────────────────────────────────────

async function loadTime() {
  // Populate time log selector
  const timeLogs = await getTimeLogs(activeProfile);
  const tlSel = document.getElementById('time-log-select');
  if (tlSel) {
    tlSel.innerHTML = timeLogs.map(l =>
      `<option value="${esc(l)}" ${l === activeTimeLog ? 'selected' : ''}>${esc(l)}</option>`
    ).join('');
  }

  let [intervals, todaySecs, weekDays, active, tagSummary] = await Promise.all([
    Time.getIntervals(activeProfile, { limit: 500, log: activeTimeLog }),
    Time.getTodayTotal(activeProfile, activeTimeLog),
    Time.getWeekSummary(activeProfile),
    Time.getActiveInterval(activeProfile),
    Time.getTagSummary(activeProfile, { log: activeTimeLog }),
  ]);

  // Apply filters
  if (timeTagFilter) {
    intervals = intervals.filter(i => (i.tags || []).some(t => t.toLowerCase().includes(timeTagFilter.toLowerCase())));
  }
  if (timeDateRange !== 'all') {
    const now = new Date();
    intervals = intervals.filter(i => {
      const d = new Date(i.start);
      if (timeDateRange === 'today') return d.toDateString() === now.toDateString();
      if (timeDateRange === 'week')  { const w = new Date(now); w.setDate(now.getDate() - 6); return d >= w; }
      if (timeDateRange === 'month') { return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }
      return true;
    });
  }

  Render.renderTimeToday(todaySecs, active);
  Render.renderWeekChart(weekDays);
  Render.renderIntervals(intervals);
  Render.renderTagSummary(tagSummary);
  updateTimeStat(todaySecs);
}

function wireTimeSection() {
  document.getElementById('btn-timew-start')?.addEventListener('click', async () => {
    const form = document.getElementById('add-time-form');
    const fd = new FormData(form);
    const tags = fd.get('tags')?.trim() || 'work';
    const ann  = fd.get('description')?.trim() || '';
    await Time.startTracking(activeProfile, tags, ann, activeTimeLog);
    form.reset();
    showToast('Tracking started');
    await loadTime();
  });

  document.getElementById('btn-timew-stop')?.addEventListener('click', async () => {
    const i = await Time.stopTracking(activeProfile);
    if (!i) { showToast('Not tracking', 'warning'); return; }
    showToast('Stopped');
    await loadTime();
  });

  document.getElementById('add-time-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const tags = fd.get('tags')?.trim() || 'work';
    const dur  = fd.get('duration')?.trim();
    const ann  = fd.get('description')?.trim() || '';
    if (!dur) { showToast('Enter a duration', 'warning'); return; }
    try {
      await Time.trackInterval(activeProfile, tags, dur, ann, activeTimeLog);
      formEl.reset();
      showToast('Interval tracked');
      await loadTime();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Time log selector
  document.getElementById('time-log-select')?.addEventListener('change', (e) => {
    activeTimeLog = e.target.value;
    loadTime();
  });

  document.getElementById('btn-new-time-log')?.addEventListener('click', async () => {
    const name = await promptText('Time log name:');
    if (!name?.trim()) return;
    const clean = name.trim();
    await addTimeLog(activeProfile, clean);
    activeTimeLog = clean;
    showToast(`Log "${clean}" created`);
    await loadTime();
  });

  document.getElementById('btn-del-time-log')?.addEventListener('click', async () => {
    if (activeTimeLog === 'main') { showToast('Cannot remove the main log', 'warning'); return; }
    if (!await confirm(`Remove time log "${activeTimeLog}"? Intervals in it will remain but become unlisted.`)) return;
    await removeTimeLog(activeProfile, activeTimeLog);
    activeTimeLog = 'main';
    showToast('Log removed');
    await loadTime();
  });

  // Tag filter input
  document.getElementById('time-tag-filter')?.addEventListener('input', (e) => {
    timeTagFilter = e.target.value.trim();
    loadTime();
  });

  // Date range filter
  document.getElementById('time-date-range')?.addEventListener('change', (e) => {
    timeDateRange = e.target.value;
    loadTime();
  });

  // Tag chip click → set filter
  document.getElementById('time-tag-summary')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag-filter]');
    if (!chip) return;
    const tag = chip.dataset.tagFilter;
    timeTagFilter = (timeTagFilter === tag) ? '' : tag;
    const inp = document.getElementById('time-tag-filter');
    if (inp) inp.value = timeTagFilter;
    loadTime();
  });

  // Intervals list — inline panel system
  document.getElementById('time-intervals')?.addEventListener('click', async (e) => {
    // Group collapse
    if (e.target.closest('[data-action="toggle-time-group"]')) {
      e.target.closest('.time-date-group')?.classList.toggle('collapsed');
      return;
    }
    // Panel submit/cancel
    const panelBtn = e.target.closest('[data-panel-action]');
    if (panelBtn) { await handleTimePanelAction(panelBtn); return; }
    // Action pills
    const pill = e.target.closest('.jrnl-action-pill[data-action]');
    if (pill) { await openTimeInlinePanel(pill); return; }
    // Row click → drawer (not on pills/buttons)
    const row = e.target.closest('.time-interval[data-action="open-time-drawer"]');
    if (row && !e.target.closest('button')) {
      await openTimeDrawer(parseInt(row.dataset.id));
    }
  });
}

// ── Time inline panel ────────────────────────────────────────────────────────

function closeAllTimePanels() {
  document.querySelectorAll('.time-interval .jrnl-inline-panel.open').forEach(p => {
    p.classList.remove('open'); p.innerHTML = '';
  });
  document.querySelectorAll('.time-interval .jrnl-action-pill.pill-active').forEach(b => b.classList.remove('pill-active'));
}

async function openTimeInlinePanel(pill) {
  const action = pill.dataset.action;
  const id     = pill.dataset.id;
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="time-${id}"]`);

  if (action === 'open-time-drawer') { await openTimeDrawer(parseInt(id)); return; }

  if (pill.classList.contains('pill-active')) { closeAllTimePanels(); return; }
  closeAllTimePanels();
  if (!panel) return;

  pill.classList.add('pill-active');
  panel.classList.add('open');
  panel.innerHTML = `<div class="jrnl-inline-panel-inner">${await buildTimePanelHtml(action, id)}</div>`;
  panel.querySelector('input, textarea, select')?.focus();
}

async function buildTimePanelHtml(action, id) {
  const numId = parseInt(id);

  switch (action) {
    case 'stop-interval':
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">Stop tracking this interval?</span>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-stop-interval" data-id="${id}">■ stop</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;

    case 'edit-interval': {
      const intervals = await Time.getIntervals(activeProfile, { limit: 10000 });
      const i = intervals.find(x => x.id === numId);
      if (!i) return '';
      const toLocal = iso => {
        if (!iso) return '';
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      return `<div class="jrnl-panel-row" style="flex-wrap:wrap;gap:6px">
        <input class="jrnl-panel-input" data-field="edit-tags" value="${esc((i.tags||[]).join(' '))}" placeholder="tags" style="flex:1">
        <input class="jrnl-panel-input" type="datetime-local" data-field="edit-start" value="${toLocal(i.start)}" style="flex:0 0 185px">
        <input class="jrnl-panel-input" type="datetime-local" data-field="edit-end"   value="${toLocal(i.end)}"   style="flex:0 0 185px" placeholder="leave empty if active">
        <input class="jrnl-panel-input" data-field="edit-ann" value="${esc(i.annotation||'')}" placeholder="annotation…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-edit-interval" data-id="${id}">save</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'time-journal': {
      const journals = await getJournals(activeProfile);
      const opts = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="jrnl-text" placeholder="note to journal…" style="flex:2">
        <select class="jrnl-panel-select" data-field="jrnl-name">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-time-journal" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'time-community': {
      const collections = await Community.listCollections();
      const active = collections.filter(c => !c.archived_at);
      if (!active.length) return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">No collections — create one in Community first.</span>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">close</button>
      </div>`;
      const opts = active.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">Add to:</span>
        <select class="jrnl-panel-select" data-field="coll-id">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-time-community" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'delete-interval':
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm"><strong>Delete</strong> this interval? Cannot be undone.</span>
        <button class="btn-inline-submit tdr-btn-sm" style="background:var(--error);border-color:var(--error)" data-panel-action="submit-delete-interval" data-id="${id}">delete</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;

    default: return '';
  }
}

async function handleTimePanelAction(btn) {
  const action = btn.dataset.panelAction;
  const numId  = parseInt(btn.dataset.id);
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="time-${btn.dataset.id}"]`);
  const field  = (key) => panel?.querySelector(`[data-field="${key}"]`)?.value ?? '';

  switch (action) {
    case 'cancel':
      closeAllTimePanels(); return;

    case 'submit-stop-interval':
      await Time.stopTracking(activeProfile);
      showToast('Stopped'); closeAllTimePanels(); await loadTime(); return;

    case 'submit-edit-interval': {
      const tags  = field('edit-tags').trim();
      const start = field('edit-start');
      const end   = field('edit-end');
      const ann   = field('edit-ann').trim();
      if (!start) { showToast('Start time required', 'warning'); return; }
      await Time.updateInterval(activeProfile, numId, {
        tags,
        start: start ? new Date(start).toISOString() : undefined,
        end:   end   ? new Date(end).toISOString()   : null,
        annotation: ann,
      });
      showToast('Updated'); closeAllTimePanels(); await loadTime(); return;
    }

    case 'submit-time-journal': {
      const text = field('jrnl-text').trim();
      if (!text) return;
      const intervals = await Time.getIntervals(activeProfile, { limit: 10000 });
      const i = intervals.find(x => x.id === numId);
      const tagStr = (i?.tags || []).join(' ') || 'time';
      const body = `${text}\n[time: ${tagStr} ${i ? Time.formatDuration(Time.intervalDuration(i)) : ''}]`;
      await Journal.addEntry(activeProfile, { body, journal: field('jrnl-name') || activeJournal });
      showToast('Added to journal'); closeAllTimePanels(); return;
    }

    case 'submit-time-community': {
      const collId = parseInt(field('coll-id'));
      if (!collId) return;
      const intervals = await Time.getIntervals(activeProfile, { limit: 10000 });
      const i = intervals.find(x => x.id === numId);
      await Community.addEntry(collId, { type: 'time', profile: activeProfile, content: i });
      showToast('Added to community'); closeAllTimePanels(); return;
    }

    case 'submit-delete-interval':
      await Time.deleteInterval(activeProfile, numId);
      showToast('Deleted'); closeAllTimePanels(); await loadTime(); return;
  }
}

// ── Time Interval Drawer ──────────────────────────────────────────────────────

let _tmrId       = null;
let _tmrInterval = null;

async function openTimeDrawer(id) {
  const intervals = await Time.getIntervals(activeProfile, { limit: 10000 });
  _tmrInterval = intervals.find(i => i.id === id);
  if (!_tmrInterval) return;
  _tmrId = id;
  document.getElementById('time-drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  await populateTimeDrawer(_tmrInterval);
}

function closeTimeDrawer() {
  document.getElementById('time-drawer')?.classList.add('hidden');
  document.body.style.overflow = '';
  _tmrId = null; _tmrInterval = null;
}

async function populateTimeDrawer(i) {
  const active  = !i.end;
  const dur     = Time.formatDuration(Time.intervalDuration(i));
  const toLocal = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  document.getElementById('tmr-dur-badge').textContent = dur;
  document.getElementById('tmr-tags-title').textContent = (i.tags || []).join(' ') || 'untagged';
  document.getElementById('tmr-tags').value       = (i.tags || []).join(' ');
  document.getElementById('tmr-start').value      = toLocal(i.start);
  document.getElementById('tmr-end').value        = toLocal(i.end);
  document.getElementById('tmr-duration').textContent = dur + (active ? ' (active)' : '');
  document.getElementById('tmr-annotation').value = i.annotation || '';

  const stopBtn = document.getElementById('tmr-stop-btn');
  if (stopBtn) stopBtn.style.display = active ? '' : 'none';

  const journals = await getJournals(activeProfile);
  const jsel = document.getElementById('tmr-journal-select');
  if (jsel) jsel.innerHTML = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
}

function wireTimeDrawer() {
  document.getElementById('tmr-backdrop')?.addEventListener('click', closeTimeDrawer);
  document.getElementById('tmr-close')?.addEventListener('click', closeTimeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('time-drawer')?.classList.contains('hidden'))
      closeTimeDrawer();
  });

  // Save button
  document.getElementById('btn-tmr-save')?.addEventListener('click', async () => {
    if (!_tmrId) return;
    const toIso = localStr => localStr ? new Date(localStr).toISOString() : null;
    const start = toIso(document.getElementById('tmr-start').value);
    const endV  = document.getElementById('tmr-end').value;
    if (!start) { showToast('Start time required', 'warning'); return; }
    await Time.updateInterval(activeProfile, _tmrId, {
      tags:       document.getElementById('tmr-tags').value.trim(),
      start,
      end:        endV ? toIso(endV) : null,
      annotation: document.getElementById('tmr-annotation').value.trim(),
    });
    // Refresh badge
    const intervals = await Time.getIntervals(activeProfile, { limit: 10000 });
    _tmrInterval = intervals.find(i => i.id === _tmrId);
    if (_tmrInterval) {
      document.getElementById('tmr-dur-badge').textContent = Time.formatDuration(Time.intervalDuration(_tmrInterval));
      document.getElementById('tmr-tags-title').textContent = (_tmrInterval.tags || []).join(' ') || 'untagged';
    }
    showToast('Saved');
    await loadTime();
  });

  // Stop from drawer
  document.getElementById('tmr-stop-btn')?.addEventListener('click', async () => {
    await Time.stopTracking(activeProfile);
    showToast('Stopped');
    closeTimeDrawer();
    await loadTime();
  });

  // Note to journal
  document.getElementById('btn-tmr-to-journal')?.addEventListener('click', async () => {
    if (!_tmrInterval) return;
    const text = document.getElementById('tmr-journal-text').value.trim();
    if (!text) return;
    const jname   = document.getElementById('tmr-journal-select').value || activeJournal;
    const tagStr  = (_tmrInterval.tags || []).join(' ') || 'time';
    const dur     = Time.formatDuration(Time.intervalDuration(_tmrInterval));
    const body    = `${text}\n[time: ${tagStr} ${dur}]`;
    await Journal.addEntry(activeProfile, { body, journal: jname });
    document.getElementById('tmr-journal-text').value = '';
    showToast(`Added to ${jname} journal`);
  });

  // Delete from header
  document.querySelector('#time-drawer .tdr-header-actions')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tmr-action="delete"]');
    if (!btn || !_tmrId) return;
    if (!await confirm('Delete this interval?')) return;
    await Time.deleteInterval(activeProfile, _tmrId);
    showToast('Deleted');
    closeTimeDrawer();
    await loadTime();
  });
}

// ── Journal ──────────────────────────────────────────────────────────────────

async function loadJournal() {
  const journals = await getJournals(activeProfile);
  populateJournalSelect(journals);
  const entries = await Journal.getEntries(activeProfile, {
    journal: activeJournal,
    search: filterText,
    showArchived: journalShowArchived,
  });
  Render.renderJournal(entries, {
    filterText,
    filterMode: journalFilterMode,
    showMd: journalShowMd,
  });
  if (journalTheme === 'twain') {
    updateTwainEntriesInfo(entries);
    mergeTwainSectionsFromEntries(entries);
  }
}

function populateJournalSelect(journals) {
  const sel = document.getElementById('journal-name-select');
  if (!sel) return;
  sel.innerHTML = journals.map(j =>
    `<option value="${j}" ${j === activeJournal ? 'selected' : ''}>${j}</option>`
  ).join('');
}

function activateJournalTheme(theme) {
  journalTheme = theme;
  localStorage.setItem('ww_journal_theme', theme);

  const sec    = document.getElementById('section-journal');
  const area   = document.getElementById('content-area');
  const list   = document.getElementById('journal-list');
  const drawer = document.getElementById('twain-entries-drawer');
  const ta     = document.getElementById('journal-entry-textarea');
  const proj   = document.getElementById('journal-project-input');

  const twainEls = ['twain-scratch-col', 'twain-save-bar', 'twain-entries-bar', 'twain-task-bar'];
  const thSel    = document.getElementById('journal-theme-select');
  if (thSel) thSel.value = theme;

  if (theme === 'twain') {
    sec?.classList.add('twain-mode');
    if (activeSection === 'journal') area?.classList.add('twain-journal-active');
    twainEls.forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    // Move journal-list into drawer
    if (list && drawer && !drawer.contains(list)) drawer.appendChild(list);
    if (proj) proj.placeholder = '@sections';
    if (ta) ta.placeholder = 'Write here…';
    // Update save-to label
    const saveTo = document.getElementById('twain-save-to');
    if (saveTo) saveTo.textContent = activeJournal;
    // Update date/time display
    updateTwainDatetime();
    // Restore scratch content
    const scratch = document.getElementById('twain-scratch');
    if (scratch) scratch.value = localStorage.getItem('ww_twain_scratch') || '';
    // Load recent sections/tags for context panel
    twainRecentSections = JSON.parse(localStorage.getItem('ww_twain_sections') || '[]');
    twainRecentTags     = JSON.parse(localStorage.getItem('ww_twain_tags')     || '[]');
    twainHiddenSections = new Set(JSON.parse(localStorage.getItem('ww_twain_sections_hidden') || '[]'));
    updateTwainInkPanel();
    // Disable enter-to-submit
    const cb = document.getElementById('jrnl-enter-toggle');
    if (cb) cb.checked = false;
  } else {
    sec?.classList.remove('twain-mode', 'scratch-collapsed', 'scratch-expanded');
    area?.classList.remove('twain-journal-active');
    twainEls.forEach(id => document.getElementById(id)?.classList.add('hidden'));
    // Hide ink panel
    document.getElementById('twain-ink-panel')?.classList.add('hidden');
    // Move journal-list back into section (before Twain elements)
    const scratchCol = document.getElementById('twain-scratch-col');
    if (list && sec && scratchCol) sec.insertBefore(list, scratchCol);
    else if (list && sec) sec.appendChild(list);
    if (proj) proj.placeholder = '@project';
    if (ta) ta.placeholder = 'New journal entry… (Enter to submit, Shift+Enter for newline)';
  }
}

function updateTwainEntriesInfo(entries) {
  const info = document.getElementById('twain-entries-info');
  if (!info) return;
  const total = entries.length;
  if (total === 0) { info.textContent = 'no entries yet'; return; }
  const latest = entries[0];
  const d = latest?.date ? new Date(latest.date) : null;
  const dateStr = d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '';
  info.textContent = `${total} ${total === 1 ? 'entry' : 'entries'} · ${activeJournal} · last: ${dateStr}`;
}

function updateTwainDatetime() {
  const el = document.getElementById('twain-datetime');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) +
    '  ' + now.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

function updateTwainInkPanel() {
  if (journalTheme !== 'twain') return;
  const panel = document.getElementById('twain-ink-panel');
  if (!panel) return;
  const activeProj = document.getElementById('journal-project-input')?.value.trim() || '';
  const activeTags = (document.getElementById('journal-tags-input')?.value || '').split(/[\s,]+/).filter(Boolean);

  const visible = twainRecentSections.filter(s => !twainHiddenSections.has(s));

  const secList = document.getElementById('twain-section-list');
  if (secList) {
    secList.innerHTML = twainSectionsCollapsed ? '' : visible.map((s, i) =>
      `<span class="twain-ink-section-row" draggable="true" data-section-index="${i}">
        <span class="twain-ink-drag-handle" title="Drag to reorder">⠿</span>
        <button class="twain-ink-section-item${s === activeProj ? ' active' : ''}" data-ctx-section="${esc(s)}">${esc(s)}</button>
        <button class="twain-ink-section-remove" data-remove-section="${esc(s)}" title="Remove">×</button>
      </span>`
    ).join('');
    document.getElementById('twain-ink-sections-group')?.classList.toggle('hidden',
      twainSectionsCollapsed && visible.length === 0);
  }
  const tagList = document.getElementById('twain-tag-list');
  if (tagList) {
    tagList.innerHTML = twainTagsCollapsed ? '' : twainRecentTags.map(t =>
      `<button class="twain-ink-tag-item${activeTags.includes(t) ? ' active' : ''}" data-ctx-tag="${esc(t)}">${esc(t)}</button>`
    ).join('');
  }
  const hasContent = visible.length > 0 || twainRecentTags.length > 0;
  panel.classList.toggle('hidden', !hasContent);
}

function mergeTwainSectionsFromEntries(entries) {
  const fromEntries = [...new Set(
    entries.map(e => (e.project || '').trim()).filter(Boolean)
  )];
  const merged = [...new Set([...fromEntries, ...twainRecentSections])]
    .filter(s => !twainHiddenSections.has(s));
  twainRecentSections = merged;
  updateTwainInkPanel();
}

function addTwainSection(val) {
  if (!val) return;
  if (!twainRecentSections.includes(val)) {
    twainRecentSections = [val, ...twainRecentSections].slice(0, 8);
    localStorage.setItem('ww_twain_sections', JSON.stringify(twainRecentSections));
  }
  const inp = document.getElementById('journal-project-input');
  if (inp) inp.value = val;
  updateTwainInkPanel();
}

function addTwainTag(val) {
  if (!val) return;
  if (!twainRecentTags.includes(val)) {
    twainRecentTags = [val, ...twainRecentTags].slice(0, 12);
    localStorage.setItem('ww_twain_tags', JSON.stringify(twainRecentTags));
  }
  const inp = document.getElementById('journal-tags-input');
  if (!inp) return;
  const current = inp.value.split(/[\s,]+/).filter(Boolean);
  if (current.includes(val)) {
    inp.value = current.filter(t => t !== val).join(', ');
  } else {
    inp.value = [...current, val].join(', ');
  }
  updateTwainInkPanel();
}

function wireJournalSection() {
  const form = document.getElementById('add-journal-form');
  const textarea = document.getElementById('journal-entry-textarea');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = textarea?.value.trim();
    if (!body) return;
    const fd = new FormData(form);
    const editingId = form.dataset.editingId ? parseInt(form.dataset.editingId, 10) : null;

    if (editingId) {
      await Journal.updateEntry(activeProfile, editingId, {
        body,
        project:  fd.get('project')?.trim() || '',
        tags:     fd.get('tags')?.trim() || '',
        priority: fd.get('priority') || '',
      });
      delete form.dataset.editingId;
      document.querySelectorAll('.twain-entry-editing').forEach(el => el.classList.remove('twain-entry-editing'));
      showToast('Entry updated');
    } else {
      await Journal.addEntry(activeProfile, {
        body,
        journal:  fd.get('journal') || activeJournal,
        project:  fd.get('project')?.trim() || '',
        tags:     fd.get('tags')?.trim() || '',
        priority: fd.get('priority') || '',
      });
      showToast('Entry added');
    }
    textarea.value = '';
    updateWordCount();
    await loadJournal();
  });

  textarea?.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+S saves in Twain mode
    if (journalTheme === 'twain' && (e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
      return;
    }
    // In Twain mode Enter never submits
    if (journalTheme === 'twain') return;
    const enterToSubmit = document.getElementById('jrnl-enter-toggle')?.checked;
    if (enterToSubmit && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  document.getElementById('jrnl-enter-indicator')?.addEventListener('click', () => {
    const cb = document.getElementById('jrnl-enter-toggle');
    if (cb) { cb.checked = !cb.checked; }
    document.getElementById('jrnl-enter-indicator')?.classList.toggle('jrnl-enter-off', !cb?.checked);
  });

  // Word/character count in status bar
  function updateWordCount() {
    const el = document.getElementById('twain-word-count');
    if (!el) return;
    const text = textarea?.value || '';
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    el.textContent = `${words} words · ${chars} chars`;
  }
  textarea?.addEventListener('input', updateWordCount);
  updateWordCount();

  document.getElementById('journal-search')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadJournal();
  });

  document.getElementById('journal-name-select')?.addEventListener('change', (e) => {
    activeJournal = e.target.value;
    loadJournal();
  });

  document.getElementById('btn-new-journal')?.addEventListener('click', async () => {
    const name = await promptText('Journal name (e.g. work, personal):');
    if (!name) return;
    await addJournal(activeProfile, name);
    activeJournal = name;
    showToast(`Journal "${name}" created`);
    await loadJournal();
  });

  document.getElementById('journal-md-toggle')?.addEventListener('click', (e) => {
    journalShowMd = !journalShowMd;
    e.currentTarget.classList.toggle('active', journalShowMd);
    loadJournal();
  });

  document.getElementById('btn-journal-show-archived')?.addEventListener('click', (e) => {
    journalShowArchived = !journalShowArchived;
    e.currentTarget.classList.toggle('active', journalShowArchived);
    loadJournal();
  });

  // Filter tabs
  document.querySelectorAll('.jrnl-filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.jrnl-filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      journalFilterMode = btn.dataset.mode;
      loadJournal();
    });
  });

  // Delegated clicks on journal list
  document.getElementById('journal-list')?.addEventListener('click', async (e) => {
    // Collapsible date group toggle
    if (e.target.closest('[data-action="toggle-group"]')) {
      e.target.closest('.journal-date-group')?.classList.toggle('collapsed');
      return;
    }
    // Show more / show less
    const showMore = e.target.closest('[data-action="expand-entry"]');
    if (showMore) {
      const entryEl = showMore.closest('.journal-entry');
      const bodyEl  = entryEl?.querySelector('.journal-entry-body');
      if (!bodyEl) return;
      const expanded = bodyEl.dataset.expanded === 'true';
      if (expanded) {
        bodyEl.innerHTML = bodyEl.dataset.truncatedHtml || bodyEl.innerHTML;
        bodyEl.dataset.expanded = 'false';
        showMore.textContent = 'show more';
      } else {
        bodyEl.dataset.truncatedHtml = bodyEl.innerHTML;
        bodyEl.innerHTML = bodyEl.dataset.full || bodyEl.innerHTML;
        bodyEl.dataset.expanded = 'true';
        showMore.textContent = 'show less';
      }
      return;
    }
    // Inline panel submit / cancel
    const panelBtn = e.target.closest('[data-panel-action]');
    if (panelBtn) { await handleJournalPanelAction(panelBtn); return; }
    // Action pills — open inline panel or execute immediately
    const pill = e.target.closest('.jrnl-action-pill[data-action]');
    if (pill) { await openJournalInlinePanel(pill); return; }
  });

  // ── Twain theme wiring ──────────────────────────────────────
  document.getElementById('journal-theme-select')?.addEventListener('change', (e) => {
    const theme = e.target.value;
    activateJournalTheme(theme);
    updateThemeModeSelect(theme);
    // Leaving Twain → also exit river mode
    if (theme !== 'twain' && document.body.classList.contains('river-mode')) {
      document.body.classList.remove('river-mode');
    }
    if (theme === 'twain') loadJournal();
  });

  // ── Theme mode selector (river, etc.) ───────────────────────
  document.getElementById('global-mode-select')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    document.body.classList.toggle('river-mode', mode === 'river');
  });

  document.getElementById('btn-twain-save')?.addEventListener('click', () => {
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  // Clicking anywhere on entries bar opens drawer and focuses search
  function openEntriesDrawer() {
    const bar    = document.getElementById('twain-entries-bar');
    const drawer = document.getElementById('twain-entries-drawer');
    const search = document.getElementById('twain-entries-search');
    if (drawer?.classList.contains('hidden')) {
      drawer.classList.remove('hidden');
      bar?.classList.add('open');
      search?.focus();
    }
  }
  function closeEntriesDrawer() {
    const bar    = document.getElementById('twain-entries-bar');
    const drawer = document.getElementById('twain-entries-drawer');
    drawer?.classList.add('hidden');
    bar?.classList.remove('open');
  }
  function toggleEntriesDrawer() {
    const drawer = document.getElementById('twain-entries-drawer');
    if (drawer?.classList.contains('hidden')) openEntriesDrawer();
    else closeEntriesDrawer();
  }

  document.getElementById('twain-entries-bar')?.addEventListener('click', (e) => {
    toggleEntriesDrawer();
  });

  // Focusing search bar also opens drawer
  document.getElementById('twain-entries-search')?.addEventListener('focus', openEntriesDrawer);

  // Search filters entries list in real time
  document.getElementById('twain-entries-search')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    const entries = document.querySelectorAll('#journal-list .journal-entry');
    entries.forEach(el => {
      if (!q) { el.style.display = ''; return; }
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
    // Also hide empty date groups
    document.querySelectorAll('#journal-list .journal-date-group').forEach(g => {
      const visible = g.querySelectorAll('.journal-entry:not([style*="display: none"])');
      g.style.display = visible.length > 0 || !q ? '' : 'none';
    });
  });

  // Click in writing textarea closes entries drawer
  document.getElementById('journal-entry-textarea')?.addEventListener('focus', closeEntriesDrawer);

  // ── Focus mode: full-window journal ─────────────────────────
  document.getElementById('btn-twain-focus')?.addEventListener('click', () => {
    const active = document.body.classList.toggle('twain-focus-mode');
    document.getElementById('btn-twain-focus')?.classList.toggle('active', active);
  });

  // ── Twain task bar ──────────────────────────────────────────
  async function populateTwainTaskList() {
    const lists = await getTaskLists(activeProfile);
    const sel = document.getElementById('twain-task-list');
    if (sel) sel.innerHTML = lists.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }
  populateTwainTaskList();

  async function submitTwainTask() {
    const desc = document.getElementById('twain-task-desc')?.value.trim();
    if (!desc) return;
    await Tasks.addTask(activeProfile, {
      taskList:    document.getElementById('twain-task-list')?.value || 'main',
      description: desc,
      project:     document.getElementById('twain-task-project')?.value.trim() || '',
      tags:        document.getElementById('twain-task-tags')?.value.trim() || '',
      priority:    document.getElementById('twain-task-priority')?.value || '',
    });
    document.getElementById('twain-task-desc').value = '';
    showToast('Task added');
  }

  document.getElementById('btn-twain-task-add')?.addEventListener('click', submitTwainTask);
  document.getElementById('twain-task-bar')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitTwainTask();
    }
  });

  // ── Twain list input ────────────────────────────────────────
  async function populateTwainListSelect() {
    const lists = await Lists.getLists(activeProfile);
    const sel = document.getElementById('twain-list-select');
    if (sel) sel.innerHTML = lists.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }
  populateTwainListSelect();

  document.getElementById('twain-list-input')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    const listName = document.getElementById('twain-list-select')?.value || 'main';
    await Lists.addItem(activeProfile, text, listName);
    e.target.value = '';
    showToast('Item added');
  });

  document.getElementById('btn-twain-list-show')?.addEventListener('click', async () => {
    const popup = document.getElementById('twain-list-popup');
    if (!popup) return;
    if (!popup.classList.contains('hidden')) { popup.classList.add('hidden'); return; }
    const listName = document.getElementById('twain-list-select')?.value || 'main';
    const items = await Lists.getItems(activeProfile, { list: listName });
    if (!items || items.length === 0) {
      popup.innerHTML = '<div class="twain-list-popup-empty">No items</div>';
    } else {
      popup.innerHTML = items.map(i => `<div class="twain-list-popup-item">${esc(i.text)}</div>`).join('');
    }
    popup.classList.remove('hidden');
  });

  // New list button
  document.getElementById('btn-twain-list-add')?.addEventListener('click', async () => {
    const name = await promptText('New list name:');
    if (!name?.trim()) return;
    await Lists.addList(activeProfile, name.trim());
    await populateTwainListSelect();
    document.getElementById('twain-list-select').value = name.trim();
    showToast(`List "${name.trim()}" created`);
  });

  // Close list popup when clicking elsewhere
  document.addEventListener('click', (e) => {
    const popup = document.getElementById('twain-list-popup');
    if (popup && !popup.classList.contains('hidden') &&
        !e.target.closest('#twain-list-popup') && !e.target.closest('#btn-twain-list-show')) {
      popup.classList.add('hidden');
    }
  });

  // ── Click entry to edit in main window ──────────────────────
  document.getElementById('journal-list')?.addEventListener('click', async (e) => {
    if (journalTheme !== 'twain') return;
    // Don't intercept pill clicks, panel actions, toggles, or show-more
    if (e.target.closest('.jrnl-action-pill') || e.target.closest('[data-panel-action]') ||
        e.target.closest('[data-action="toggle-group"]') || e.target.closest('[data-action="expand-entry"]') ||
        e.target.closest('.jrnl-inline-panel')) return;
    const entryEl = e.target.closest('.journal-entry[data-id]');
    if (!entryEl) return;
    const id = parseInt(entryEl.dataset.id);
    if (!id) return;
    const entries = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
    const entry = entries.find(x => x.id === id);
    if (!entry) return;

    // Populate main textarea with entry body for editing
    const ta = document.getElementById('journal-entry-textarea');
    if (ta) ta.value = entry.body || '';
    const proj = document.getElementById('journal-project-input');
    if (proj) proj.value = entry.project || '';
    const tags = document.getElementById('journal-tags-input');
    if (tags) tags.value = (entry.tags || []).join(', ');
    const pri = document.getElementById('journal-priority-select');
    if (pri) pri.value = entry.priority || '';

    // Mark form as editing this entry
    form.dataset.editingId = id;

    // Highlight the entry in the list
    document.querySelectorAll('.journal-entry.twain-entry-editing').forEach(el => el.classList.remove('twain-entry-editing'));
    entryEl.classList.add('twain-entry-editing');

    // Highlight matching section in ink panel
    updateTwainInkPanel();

    // Update word count
    updateWordCount();

    // Focus textarea
    ta?.focus();
  });

  // Collapse/expand scratch pad (from both sides)
  function toggleScratch() {
    const sec = document.getElementById('section-journal');
    if (!sec) return;
    const collapsed = sec.classList.toggle('scratch-collapsed');
    if (collapsed) sec.classList.remove('scratch-expanded');
    const btn = document.getElementById('btn-scratch-collapse');
    if (btn) btn.textContent = collapsed ? '›' : '‹';
  }
  document.getElementById('btn-scratch-collapse')?.addEventListener('click', toggleScratch);
  document.getElementById('btn-twain-expand')?.addEventListener('click', toggleScratch);

  // Expand scratch pad to 3 columns
  document.getElementById('btn-scratch-expand')?.addEventListener('click', () => {
    const sec = document.getElementById('section-journal');
    if (!sec) return;
    const expanded = sec.classList.toggle('scratch-expanded');
    if (expanded) {
      sec.classList.remove('scratch-collapsed');
      const btn = document.getElementById('btn-scratch-collapse');
      if (btn) btn.textContent = '‹';
      document.querySelectorAll('.twain-scratch-extra').forEach(el => el.classList.remove('hidden'));
    } else {
      document.querySelectorAll('.twain-scratch-extra').forEach(el => el.classList.add('hidden'));
    }
    const btn = document.getElementById('btn-scratch-expand');
    if (btn) btn.textContent = expanded ? '⇤' : '⇥';
  });

  // Persist scratch pad content
  document.getElementById('twain-scratch')?.addEventListener('input', (e) => {
    localStorage.setItem('ww_twain_scratch', e.target.value);
  });

  // Update save-to label when journal changes
  document.getElementById('journal-name-select')?.addEventListener('change', () => {
    const saveTo = document.getElementById('twain-save-to');
    if (saveTo) saveTo.textContent = activeJournal;
  });

  // @sections field: Enter adds to ink panel
  document.getElementById('journal-project-input')?.addEventListener('keydown', (e) => {
    if (journalTheme !== 'twain' || e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (val) addTwainSection(val);
  });
  document.getElementById('journal-project-input')?.addEventListener('input', () => {
    if (journalTheme === 'twain') updateTwainInkPanel();
  });

  // @tags field: Enter adds chip
  document.getElementById('journal-tags-input')?.addEventListener('keydown', (e) => {
    if (journalTheme !== 'twain' || e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim().replace(/,\s*$/, '');
    if (val) { addTwainTag(val); e.target.value = ''; }
  });
  document.getElementById('journal-tags-input')?.addEventListener('input', () => {
    if (journalTheme === 'twain') updateTwainInkPanel();
  });

  // Ink panel clicks
  document.getElementById('twain-ink-panel')?.addEventListener('click', (e) => {
    // Remove a section
    const rBtn = e.target.closest('[data-remove-section]');
    if (rBtn) {
      const s = rBtn.dataset.removeSection;
      twainHiddenSections.add(s);
      localStorage.setItem('ww_twain_sections_hidden', JSON.stringify([...twainHiddenSections]));
      twainRecentSections = twainRecentSections.filter(x => x !== s);
      localStorage.setItem('ww_twain_sections', JSON.stringify(twainRecentSections));
      updateTwainInkPanel();
      return;
    }
    const sBtn = e.target.closest('[data-ctx-section]');
    if (sBtn) {
      const inp = document.getElementById('journal-project-input');
      if (inp) inp.value = sBtn.dataset.ctxSection;
      updateTwainInkPanel();
      return;
    }
    const tBtn = e.target.closest('[data-ctx-tag]');
    if (tBtn) { addTwainTag(tBtn.dataset.ctxTag); return; }

    if (e.target.closest('#btn-collapse-sections')) {
      twainSectionsCollapsed = !twainSectionsCollapsed;
      const b = document.getElementById('btn-collapse-sections');
      if (b) b.textContent = twainSectionsCollapsed ? '+' : '−';
      updateTwainInkPanel();
      return;
    }
    if (e.target.closest('#btn-collapse-tags')) {
      twainTagsCollapsed = !twainTagsCollapsed;
      const b = document.getElementById('btn-collapse-tags');
      if (b) b.textContent = twainTagsCollapsed ? '+' : '−';
      updateTwainInkPanel();
      return;
    }
  });

  // Drag-to-reorder sections
  (() => {
    const secList = document.getElementById('twain-section-list');
    if (!secList) return;
    let dragSrc = null;

    secList.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[data-section-index]');
      if (!row) return;
      dragSrc = parseInt(row.dataset.sectionIndex, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    secList.addEventListener('dragend', () => {
      secList.querySelectorAll('.twain-ink-section-row').forEach(r =>
        r.classList.remove('dragging', 'drag-over'));
      dragSrc = null;
    });

    secList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-section-index]');
      if (!row) return;
      secList.querySelectorAll('.twain-ink-section-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });

    secList.addEventListener('dragleave', (e) => {
      if (!secList.contains(e.relatedTarget))
        secList.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    });

    secList.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-section-index]');
      if (!row || dragSrc === null) return;
      const dest = parseInt(row.dataset.sectionIndex, 10);
      if (dragSrc === dest) return;
      const visible = twainRecentSections.filter(s => !twainHiddenSections.has(s));
      const [moved] = visible.splice(dragSrc, 1);
      visible.splice(dest, 0, moved);
      twainRecentSections = visible;
      localStorage.setItem('ww_twain_sections', JSON.stringify(twainRecentSections));
      updateTwainInkPanel();
    });
  })();

  // River mode button
  document.getElementById('btn-twain-river')?.addEventListener('click', () => {
    document.body.classList.toggle('river-mode');
    syncThemeModeSelectToRiver();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('river-mode')) {
      document.body.classList.remove('river-mode');
      e.stopPropagation();
    }
  }, true);

  // Apply persisted theme on load
  if (journalTheme === 'twain') {
    activateJournalTheme('twain');
    updateThemeModeSelect('twain', false);
  } else {
    updateThemeModeSelect('default');
  }
}

// ── Journal inline panel ──────────────────────────────────────────────────────

function closeAllJournalPanels() {
  document.querySelectorAll('.jrnl-inline-panel.open').forEach(p => {
    p.classList.remove('open');
    p.innerHTML = '';
  });
  document.querySelectorAll('.jrnl-action-pill.pill-active').forEach(b => b.classList.remove('pill-active'));
}

async function openJournalInlinePanel(pill) {
  const action = pill.dataset.action;
  const id     = pill.dataset.id;
  const numId  = parseInt(id);
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="${id}"]`);

  // Immediate actions — no panel
  if (action === 'metadata-entry') { await openJournalDrawer(numId); return; }

  // Toggle: clicking the active pill closes the panel
  if (pill.classList.contains('pill-active')) {
    closeAllJournalPanels();
    return;
  }

  closeAllJournalPanels();
  if (!panel) return;

  pill.classList.add('pill-active');
  panel.classList.add('open');
  panel.innerHTML = `<div class="jrnl-inline-panel-inner">${await buildPanelHtml(action, id)}</div>`;

  // Auto-focus first input
  const first = panel.querySelector('input, textarea');
  if (first) { first.focus(); first.select?.(); }
}

async function buildPanelHtml(action, id) {
  const journals = await getJournals(activeProfile);
  const jrnlOptions = journals.map(j =>
    `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`
  ).join('');

  switch (action) {
    case 'annotate-entry':
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" placeholder="annotation text…" data-field="ann-text">
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-annotate" data-id="${id}">add</button>
      </div>`;

    case 'new-entry-from':
      return `<div>
        <textarea class="jrnl-panel-textarea" placeholder="New journal entry…" data-field="new-body" rows="3"></textarea>
        <div class="jrnl-panel-row" style="border-top:none;padding-top:0">
          <select class="jrnl-panel-select" data-field="new-journal">${jrnlOptions}</select>
          <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-new-entry" data-id="${id}">add</button>
          <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
        </div>
      </div>`;

    case 'community-entry': {
      const collections = await Community.listCollections();
      const active = collections.filter(c => !c.archived_at);
      if (active.length === 0) {
        return `<div class="jrnl-panel-row"><span class="jrnl-panel-confirm">No collections yet — create one in <strong>Community</strong> first.</span>
          <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">close</button></div>`;
      }
      const collOptions = active.map(c =>
        `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`
      ).join('');
      return `<div class="jrnl-panel-row">
        <select class="jrnl-panel-select" data-field="coll-id">${collOptions}</select>
        <input class="jrnl-panel-input" data-field="comm-note" placeholder="optional note…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-community" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'archive-entry': {
      const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
      const entry = all.find(e => e.id === parseInt(id));
      const label = entry?.archived ? 'Unarchive this entry?' : 'Archive this entry?';
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">${label}</span>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-archive" data-id="${id}">yes</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'delete-entry':
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm"><strong>Delete</strong> this entry? This cannot be undone.</span>
        <button class="btn-inline-submit tdr-btn-sm" style="background:var(--error);border-color:var(--error)" data-panel-action="submit-delete" data-id="${id}">delete</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;

    default:
      return '';
  }
}

async function handleJournalPanelAction(btn) {
  const action = btn.dataset.panelAction;
  const numId  = parseInt(btn.dataset.id);
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="${btn.dataset.id}"]`);

  const field = (key) => panel?.querySelector(`[data-field="${key}"]`)?.value ?? '';

  switch (action) {
    case 'cancel':
      closeAllJournalPanels();
      return;

    case 'submit-annotate': {
      const text = field('ann-text').trim();
      if (!text) return;
      await Journal.annotateEntry(activeProfile, numId, text);
      showToast('Annotated');
      closeAllJournalPanels();
      await loadJournal();
      return;
    }

    case 'submit-new-entry': {
      const body = field('new-body').trim();
      if (!body) return;
      const jname = field('new-journal') || activeJournal;
      await Journal.addEntry(activeProfile, { body, journal: jname });
      showToast('Entry added');
      closeAllJournalPanels();
      await loadJournal();
      return;
    }

    case 'submit-community': {
      const collId = parseInt(field('coll-id'));
      if (!collId) return;
      const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
      const entry = all.find(e => e.id === numId);
      if (!entry) return;
      await Community.addEntry(collId, { type: 'journal', profile: activeProfile, content: entry });
      showToast('Added to community');
      closeAllJournalPanels();
      return;
    }

    case 'submit-archive': {
      const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
      const entry = all.find(e => e.id === numId);
      await Journal.archiveEntry(activeProfile, numId, !entry?.archived);
      showToast(entry?.archived ? 'Unarchived' : 'Archived');
      closeAllJournalPanels();
      await loadJournal();
      return;
    }

    case 'submit-delete':
      await Journal.deleteEntry(activeProfile, numId);
      showToast('Deleted');
      closeAllJournalPanels();
      await loadJournal();
      return;
  }
}

// ── Journal Detail Drawer ────────────────────────────────────────────────────

let _jdrId   = null;
let _jdrEntry = null;

async function openJournalDrawer(id) {
  const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
  _jdrEntry = all.find(e => e.id === id);
  if (!_jdrEntry) return;
  _jdrId = id;

  const drawer = document.getElementById('journal-drawer');
  drawer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  populateJournalDrawer(_jdrEntry);
}

function closeJournalDrawer() {
  document.getElementById('journal-drawer')?.classList.add('hidden');
  document.body.style.overflow = '';
  _jdrId = null; _jdrEntry = null;
}

async function populateJournalDrawer(e) {
  const journals = await getJournals(activeProfile);
  const sel = document.getElementById('jdr-journal-select');
  if (sel) sel.innerHTML = journals.map(j => `<option value="${esc(j)}" ${j === e.journal ? 'selected' : ''}>${esc(j)}</option>`).join('');

  document.getElementById('jdr-journal-badge').textContent = e.journal || 'main';
  document.getElementById('jdr-date-title').textContent =
    new Date(e.date).toLocaleString('en', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('jdr-body').value    = e.body || '';
  document.getElementById('jdr-project').value = e.project || '';
  document.getElementById('jdr-tags').value    = (e.tags || []).join(', ');
  document.getElementById('jdr-priority').value = e.priority || '';
  document.getElementById('jdr-created').textContent =
    new Date(e.date).toLocaleDateString('en', { year:'numeric', month:'short', day:'numeric' });

  // Header actions
  document.getElementById('jdr-header-actions').innerHTML = `
    <button data-jdr-action="archive">${e.archived ? '# unarchive' : '# archive'}</button>
    <button data-jdr-action="delete" style="color:var(--error);border-color:var(--error)">✗ delete</button>
  `;

  // Annotations
  const anns = e.annotations || [];
  const annEl = document.getElementById('jdr-annotations');
  if (annEl) {
    annEl.innerHTML = `
      <div class="tdr-section-header">ANNOTATIONS</div>
      ${anns.length === 0 ? '<div style="font-size:11px;color:var(--muted);padding:3px 0">None.</div>' : ''}
      <div class="tdr-ann-list">${anns.map((a, i) => `
        <div class="tdr-ann-item">
          <span class="tdr-ann-date">${a.entry ? new Date(a.entry).toLocaleDateString('en',{month:'short',day:'numeric'}) : ''}</span>
          <span class="tdr-ann-text">${esc(a.text)}</span>
          <button class="tdr-ann-del" data-jdr-ann-del="${i}">✗</button>
        </div>
      `).join('')}</div>
    `;
  }
}

function wireJournalDrawer() {
  document.getElementById('jdr-backdrop')?.addEventListener('click', closeJournalDrawer);
  document.getElementById('jdr-close')?.addEventListener('click', closeJournalDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('journal-drawer')?.classList.contains('hidden')) {
      closeJournalDrawer();
    }
  });

  document.getElementById('btn-jdr-save')?.addEventListener('click', async () => {
    if (!_jdrId) return;
    await Journal.updateEntry(activeProfile, _jdrId, {
      body:     document.getElementById('jdr-body').value,
      journal:  document.getElementById('jdr-journal-select').value || activeJournal,
      project:  document.getElementById('jdr-project').value.trim(),
      tags:     document.getElementById('jdr-tags').value,
      priority: document.getElementById('jdr-priority').value,
    });
    showToast('Entry saved');
    closeJournalDrawer();
    await loadJournal();
  });

  document.getElementById('jdr-header-actions')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-jdr-action]');
    if (!btn || !_jdrId) return;
    if (btn.dataset.jdrAction === 'archive') {
      await Journal.archiveEntry(activeProfile, _jdrId, !_jdrEntry?.archived);
      showToast(_jdrEntry?.archived ? 'Unarchived' : 'Archived');
      closeJournalDrawer();
      await loadJournal();
    } else if (btn.dataset.jdrAction === 'delete') {
      if (!await confirm('Delete this journal entry?')) return;
      await Journal.deleteEntry(activeProfile, _jdrId);
      showToast('Deleted');
      closeJournalDrawer();
      await loadJournal();
    }
  });

  document.getElementById('btn-jdr-annotate')?.addEventListener('click', async () => {
    const text = document.getElementById('jdr-ann-text').value.trim();
    if (!text || !_jdrId) return;
    await Journal.annotateEntry(activeProfile, _jdrId, text);
    document.getElementById('jdr-ann-text').value = '';
    const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
    _jdrEntry = all.find(e => e.id === _jdrId);
    if (_jdrEntry) populateJournalDrawer(_jdrEntry);
    showToast('Annotation added');
  });
  document.getElementById('jdr-ann-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-jdr-annotate').click(); }
  });

  document.getElementById('jdr-annotations')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-jdr-ann-del]');
    if (!btn || !_jdrEntry) return;
    const idx = parseInt(btn.dataset.jdrAnnDel);
    const anns = [...(_jdrEntry.annotations || [])];
    anns.splice(idx, 1);
    await Journal.updateEntry(activeProfile, _jdrId, { annotations: anns });
    const all = await Journal.getEntries(activeProfile, { showArchived: true, limit: 10000 });
    _jdrEntry = all.find(e => e.id === _jdrId);
    if (_jdrEntry) populateJournalDrawer(_jdrEntry);
    showToast('Annotation removed');
  });
}

// ── Ledger ───────────────────────────────────────────────────────────────────

async function loadLedger() {
  const ledgers = await getLedgers(activeProfile);
  populateLedgerSelect(ledgers);
  const searchEl = document.getElementById('ledger-search');
  if (searchEl && searchEl.value !== ledgerSearchText) searchEl.value = ledgerSearchText;
  await refreshLedgerReport();
  const [txns, balances] = await Promise.all([
    Ledger.getTransactions(activeProfile, { ledger: activeLedger, search: ledgerSearchText }),
    Ledger.balanceReport(activeProfile, { ledger: activeLedger }),
  ]);
  Render.renderTransactions(txns);
  Render.renderLedgerSummary(balances);
  populateAccountDatalist();
}

function populateLedgerSelect(ledgers) {
  const sel = document.getElementById('ledger-name-select');
  if (!sel) return;
  sel.innerHTML = ledgers.map(l =>
    `<option value="${l}" ${l === activeLedger ? 'selected' : ''}>${l}</option>`
  ).join('');
}

async function refreshLedgerReport() {
  const filter = document.getElementById('hl-filter')?.value?.trim() || '';
  switch (activeReport) {
    case 'balance': {
      const rows = await Ledger.balanceReport(activeProfile, { ledger: activeLedger, accountFilter: filter });
      Render.renderBalance(rows);
      break;
    }
    case 'register': {
      const rows = await Ledger.registerReport(activeProfile, { ledger: activeLedger, accountFilter: filter });
      Render.renderRegister(rows);
      break;
    }
    case 'income': {
      const report = await Ledger.incomeReport(activeProfile, { ledger: activeLedger });
      Render.renderIncomeReport(report);
      break;
    }
  }
}

async function populateAccountDatalist() {
  const accounts = await Ledger.getAccounts(activeProfile);
  const dl = document.getElementById('account-list');
  if (dl) dl.innerHTML = accounts.map(a => `<option value="${a.name}">`).join('');
}

function wireLedgerSection() {
  const form = document.getElementById('add-ledger-form');
  const dateInput = form?.querySelector('[name="date"]');
  const descInput = form?.querySelector('[name="description"]');
  const accountInput = form?.querySelector('[name="account"]');
  const amountInput = form?.querySelector('[name="amount"]');
  const saveBtn = form?.querySelector('button[type="submit"]');

  const ensureLedgerDate = () => {
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  };

  const updateLedgerSaveState = () => {
    if (!saveBtn) return;
    const desc = descInput?.value.trim() || '';
    const account = accountInput?.value.trim() || '';
    const amtRaw = amountInput?.value.trim() || '';
    const amt = parseFloat(amtRaw.replace(/[$,]/g, ''));
    const hasValidAmount = amtRaw !== '' && !isNaN(amt);
    saveBtn.disabled = !(desc && account && hasValidAmount);
  };

  ensureLedgerDate();
  updateLedgerSaveState();
  form?.addEventListener('input', () => {
    ensureLedgerDate();
    updateLedgerSaveState();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    try {
      await Ledger.addTransaction(activeProfile, {
        date:        fd.get('date') || new Date().toISOString().slice(0, 10),
        description: fd.get('description')?.trim(),
        account:     fd.get('account')?.trim(),
        amount:      fd.get('amount')?.trim(),
        comment:     fd.get('comment')?.trim() || '',
        ledger:      activeLedger,
      });
      formEl.reset();
      ensureLedgerDate();
      updateLedgerSaveState();
      showToast('Transaction saved');
      await loadLedger();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-add-account')?.addEventListener('click', async () => {
    const name = document.getElementById('add-account-input')?.value.trim();
    if (!name) { showToast('Enter account name', 'warning'); return; }
    await Ledger.addAccount(activeProfile, name);
    document.getElementById('add-account-input').value = '';
    showToast(`Account "${name}" added`);
    await populateAccountDatalist();
  });

  document.getElementById('ledger-name-select')?.addEventListener('change', (e) => {
    activeLedger = e.target.value;
    loadLedger();
  });

  document.getElementById('btn-new-ledger')?.addEventListener('click', async () => {
    const name = await promptText('Ledger name (e.g. personal, business):');
    if (!name) return;
    await addLedger(activeProfile, name);
    activeLedger = name;
    showToast(`Ledger "${name}" created`);
    await loadLedger();
  });

  document.querySelectorAll('.hl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.hl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeReport = btn.dataset.cmd;
      await refreshLedgerReport();
    });
  });

  document.getElementById('hl-filter')?.addEventListener('input', () => refreshLedgerReport());

  document.getElementById('ledger-search')?.addEventListener('input', async (e) => {
    ledgerSearchText = e.target.value;
    const txns = await Ledger.getTransactions(activeProfile, { ledger: activeLedger, search: ledgerSearchText });
    Render.renderTransactions(txns);
  });

  // Summary chips → set account filter + switch to register
  document.getElementById('ledger-summary')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-acct-filter]');
    if (!chip) return;
    const filterEl = document.getElementById('hl-filter');
    if (filterEl) filterEl.value = chip.dataset.acctFilter;
    document.querySelectorAll('.hl-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.hl-btn[data-cmd="register"]')?.classList.add('active');
    activeReport = 'register';
    refreshLedgerReport();
  });

  document.getElementById('ledger-recent')?.addEventListener('click', async (e) => {
    // Group collapse
    if (e.target.closest('[data-action="toggle-ledger-group"]')) {
      e.target.closest('.ledger-date-group')?.classList.toggle('collapsed');
      return;
    }
    // Inline panel submit/cancel
    const panelBtn = e.target.closest('[data-panel-action]');
    if (panelBtn) { await handleLedgerPanelAction(panelBtn); return; }
    // Action pills
    const pill = e.target.closest('.jrnl-action-pill[data-action]');
    if (pill) { await openLedgerInlinePanel(pill); return; }
    // Row click → drawer (but not on pills/buttons)
    const txnRow = e.target.closest('.ledger-txn[data-action="open-ledger-drawer"]');
    if (txnRow && !e.target.closest('button')) {
      await openLedgerDrawer(parseInt(txnRow.dataset.id));
    }
  });
}

// ── Ledger inline panel ───────────────────────────────────────────────────────

function closeAllLedgerPanels() {
  document.querySelectorAll('.ledger-txn .jrnl-inline-panel.open').forEach(p => {
    p.classList.remove('open'); p.innerHTML = '';
  });
  document.querySelectorAll('.ledger-txn .jrnl-action-pill.pill-active').forEach(b => b.classList.remove('pill-active'));
}

async function openLedgerInlinePanel(pill) {
  const action = pill.dataset.action;
  const id     = pill.dataset.id;
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="txn-${id}"]`);

  if (action === 'open-ledger-drawer') { await openLedgerDrawer(parseInt(id)); return; }

  if (pill.classList.contains('pill-active')) { closeAllLedgerPanels(); return; }
  closeAllLedgerPanels();
  if (!panel) return;

  pill.classList.add('pill-active');
  panel.classList.add('open');
  panel.innerHTML = `<div class="jrnl-inline-panel-inner">${await buildLedgerPanelHtml(action, id)}</div>`;
  panel.querySelector('input, textarea, select')?.focus();
}

async function buildLedgerPanelHtml(action, id) {
  const numId = parseInt(id);
  switch (action) {
    case 'edit-txn': {
      const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
      const t = txns.find(x => x.id === numId);
      if (!t) return '';
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" type="date" data-field="edit-date" value="${esc(t.date)}" style="flex:0 0 130px">
        <input class="jrnl-panel-input" data-field="edit-desc" value="${esc(t.description)}" placeholder="description" style="flex:2">
        <input class="jrnl-panel-input" data-field="edit-comment" value="${esc(t.comment||'')}" placeholder="; note…" style="flex:1">
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-edit-txn" data-id="${id}">save</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'add-posting': {
      const accounts = await Ledger.getAccounts(activeProfile);
      const opts = accounts.map(a => `<option value="${esc(a.name)}">`).join('');
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="post-account" placeholder="account" list="account-list" style="flex:1.5" autocomplete="off">
        <datalist>${opts}</datalist>
        <input class="jrnl-panel-input" data-field="post-amount" placeholder="amount (e.g. -45.00)" style="flex:0.8">
        <input class="jrnl-panel-input" data-field="post-comment" placeholder="; note…" style="flex:1">
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-add-posting" data-id="${id}">+ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'txn-journal': {
      const journals = await getJournals(activeProfile);
      const opts = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="jrnl-text" placeholder="note to journal…" style="flex:2">
        <select class="jrnl-panel-select" data-field="jrnl-name">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-txn-journal" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'txn-community': {
      const collections = await Community.listCollections();
      const active = collections.filter(c => !c.archived_at);
      if (!active.length) return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">No collections — create one in Community first.</span>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">close</button>
      </div>`;
      const opts = active.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">Add to:</span>
        <select class="jrnl-panel-select" data-field="coll-id">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-panel-action="submit-txn-community" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'delete-txn':
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm"><strong>Delete</strong> this transaction? Cannot be undone.</span>
        <button class="btn-inline-submit tdr-btn-sm" style="background:var(--error);border-color:var(--error)" data-panel-action="submit-delete-txn" data-id="${id}">delete</button>
        <button class="btn-inline-alt tdr-btn-sm" data-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;

    default: return '';
  }
}

async function handleLedgerPanelAction(btn) {
  const action = btn.dataset.panelAction;
  const numId  = parseInt(btn.dataset.id);
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="txn-${btn.dataset.id}"]`);
  const field  = (key) => panel?.querySelector(`[data-field="${key}"]`)?.value ?? '';

  switch (action) {
    case 'cancel':
      closeAllLedgerPanels(); return;

    case 'submit-edit-txn': {
      const date = field('edit-date');
      const desc = field('edit-desc').trim();
      const comment = field('edit-comment').trim();
      if (!desc) { showToast('Description required', 'warning'); return; }
      await Ledger.updateTransaction(activeProfile, numId, { date, description: desc, comment });
      showToast('Updated'); closeAllLedgerPanels(); await loadLedger(); return;
    }

    case 'submit-add-posting': {
      const account = field('post-account').trim();
      const rawAmt  = field('post-amount').trim();
      const amount  = parseFloat(rawAmt.replace(/[$,]/g, ''));
      if (!account || isNaN(amount)) { showToast('Account and valid amount required', 'warning'); return; }
      const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
      const t = txns.find(x => x.id === numId);
      if (!t) return;
      const postings = [...t.postings, { account, amount, comment: field('post-comment').trim() }];
      await Ledger.updateTransaction(activeProfile, numId, { postings });
      showToast('Posting added'); closeAllLedgerPanels(); await loadLedger(); return;
    }

    case 'submit-txn-journal': {
      const text = field('jrnl-text').trim();
      if (!text) return;
      const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
      const t = txns.find(x => x.id === numId);
      const body = `${text}\n[ledger: ${t?.date} ${t?.description}]`;
      await Journal.addEntry(activeProfile, { body, journal: field('jrnl-name') || activeJournal });
      showToast('Added to journal'); closeAllLedgerPanels(); return;
    }

    case 'submit-txn-community': {
      const collId = parseInt(field('coll-id'));
      if (!collId) return;
      const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
      const t = txns.find(x => x.id === numId);
      await Community.addEntry(collId, { type: 'ledger', profile: activeProfile, content: t });
      showToast('Added to community'); closeAllLedgerPanels(); return;
    }

    case 'submit-delete-txn':
      await Ledger.deleteTransaction(activeProfile, numId);
      showToast('Deleted'); closeAllLedgerPanels(); await loadLedger(); return;
  }
}

// ── Ledger Transaction Drawer ─────────────────────────────────────────────────

let _ldrId  = null;
let _ldrTxn = null;

async function openLedgerDrawer(id) {
  const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
  _ldrTxn = txns.find(t => t.id === id);
  if (!_ldrTxn) return;
  _ldrId = id;
  document.getElementById('ledger-drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  await populateLedgerDrawer(_ldrTxn);
}

function closeLedgerDrawer() {
  document.getElementById('ledger-drawer')?.classList.add('hidden');
  document.body.style.overflow = '';
  _ldrId = null; _ldrTxn = null;
}

async function populateLedgerDrawer(t) {
  document.getElementById('ldr-date-badge').textContent = t.date;
  document.getElementById('ldr-desc-title').textContent = t.description;
  document.getElementById('ldr-date').value    = t.date;
  document.getElementById('ldr-desc').value    = t.description;
  document.getElementById('ldr-comment').value = t.comment || '';

  const ledgers = await getLedgers(activeProfile);
  const lsel = document.getElementById('ldr-ledger-select');
  if (lsel) lsel.innerHTML = ledgers.map(l => `<option value="${esc(l)}" ${l === (t.ledger || activeLedger) ? 'selected' : ''}>${esc(l)}</option>`).join('');

  const journals = await getJournals(activeProfile);
  const jsel = document.getElementById('ldr-journal-select');
  if (jsel) jsel.innerHTML = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');

  renderDrawerPostings(t.postings);
}

function renderDrawerPostings(postings) {
  const el = document.getElementById('ldr-postings');
  if (!el) return;
  el.innerHTML = postings.map((p, i) => `
    <div class="ldr-posting-edit-row" data-idx="${i}">
      <input class="tdr-input ldr-posting-edit-acct" value="${esc(p.account)}" data-field="acct" list="account-list" autocomplete="off">
      <input class="tdr-input ldr-posting-edit-amt" value="${p.amount}" data-field="amt">
      <input class="tdr-input ldr-posting-edit-cmt" value="${esc(p.comment||'')}" data-field="cmt" placeholder="; note">
      <button class="ldr-posting-del" data-posting-del="${i}">✗</button>
    </div>
  `).join('');
}

function wireLedgerDrawer() {
  document.getElementById('ldr-backdrop')?.addEventListener('click', closeLedgerDrawer);
  document.getElementById('ldr-close')?.addEventListener('click', closeLedgerDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('ledger-drawer')?.classList.contains('hidden'))
      closeLedgerDrawer();
  });

  // Save header fields
  document.getElementById('btn-ldr-save')?.addEventListener('click', async () => {
    if (!_ldrId) return;
    await Ledger.updateTransaction(activeProfile, _ldrId, {
      date:        document.getElementById('ldr-date').value,
      description: document.getElementById('ldr-desc').value.trim(),
      ledger:      document.getElementById('ldr-ledger-select').value || activeLedger,
      comment:     document.getElementById('ldr-comment').value.trim(),
    });
    showToast('Saved');
    const txns = await Ledger.getTransactions(activeProfile, { limit: 10000 });
    _ldrTxn = txns.find(t => t.id === _ldrId);
    if (_ldrTxn) {
      document.getElementById('ldr-date-badge').textContent = _ldrTxn.date;
      document.getElementById('ldr-desc-title').textContent = _ldrTxn.description;
    }
    await loadLedger();
  });

  // Save individual posting on blur
  document.getElementById('ldr-postings')?.addEventListener('change', async (e) => {
    if (!_ldrTxn) return;
    const row = e.target.closest('.ldr-posting-edit-row');
    if (!row) return;
    const idx = parseInt(row.dataset.idx);
    const postings = [..._ldrTxn.postings];
    postings[idx] = {
      account: row.querySelector('[data-field="acct"]').value.trim(),
      amount:  parseFloat(row.querySelector('[data-field="amt"]').value) || 0,
      comment: row.querySelector('[data-field="cmt"]').value.trim(),
    };
    await Ledger.updateTransaction(activeProfile, _ldrId, { postings });
    _ldrTxn = { ..._ldrTxn, postings };
    renderDrawerPostings(postings);
    await loadLedger();
  });

  // Delete posting
  document.getElementById('ldr-postings')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-posting-del]');
    if (!btn || !_ldrTxn) return;
    const idx = parseInt(btn.dataset.postingDel);
    const postings = _ldrTxn.postings.filter((_, i) => i !== idx);
    await Ledger.updateTransaction(activeProfile, _ldrId, { postings });
    _ldrTxn = { ..._ldrTxn, postings };
    renderDrawerPostings(postings);
    await loadLedger();
  });

  // Add posting
  document.getElementById('btn-ldr-add-posting')?.addEventListener('click', async () => {
    if (!_ldrTxn) return;
    const account = document.getElementById('ldr-new-account').value.trim();
    const amount  = parseFloat(document.getElementById('ldr-new-amount').value.replace(/[$,]/g, ''));
    const comment = document.getElementById('ldr-new-comment').value.trim();
    if (!account || isNaN(amount)) { showToast('Account and amount required', 'warning'); return; }
    const postings = [..._ldrTxn.postings, { account, amount, comment }];
    await Ledger.updateTransaction(activeProfile, _ldrId, { postings });
    _ldrTxn = { ..._ldrTxn, postings };
    renderDrawerPostings(postings);
    document.getElementById('ldr-new-account').value = '';
    document.getElementById('ldr-new-amount').value  = '';
    document.getElementById('ldr-new-comment').value = '';
    showToast('Posting added');
    await loadLedger();
  });

  // Note to journal
  document.getElementById('btn-ldr-to-journal')?.addEventListener('click', async () => {
    if (!_ldrTxn) return;
    const text = document.getElementById('ldr-journal-text').value.trim();
    if (!text) return;
    const jname = document.getElementById('ldr-journal-select').value || activeJournal;
    const body = `${text}\n[ledger: ${_ldrTxn.date} ${_ldrTxn.description}]`;
    await Journal.addEntry(activeProfile, { body, journal: jname });
    document.getElementById('ldr-journal-text').value = '';
    showToast(`Added to ${jname} journal`);
  });

  // Delete from header actions
  document.querySelector('#ledger-drawer .tdr-header-actions')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ldr-action="delete"]');
    if (!btn || !_ldrId) return;
    if (!await confirm('Delete this transaction?')) return;
    await Ledger.deleteTransaction(activeProfile, _ldrId);
    showToast('Deleted');
    closeLedgerDrawer();
    await loadLedger();
  });
}

// ── Tags ─────────────────────────────────────────────────────────────────────

async function loadTags() {
  const tags = await Tasks.getTags(activeProfile);
  const sort = document.getElementById('tags-sort')?.value || 'name';
  const sorted = sortTags(tags, sort);
  Render.renderTags(sorted, filterText);
}

function sortTags(tags, sort) {
  if (sort === 'count-desc') return [...tags].sort((a, b) => b.count - a.count);
  if (sort === 'count-asc')  return [...tags].sort((a, b) => a.count - b.count);
  return [...tags].sort((a, b) => a.name.localeCompare(b.name));
}

function wireTagsSection() {
  document.getElementById('tags-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadTags();
  });
  document.getElementById('tags-sort')?.addEventListener('change', () => loadTags());
}

// ── Projects ─────────────────────────────────────────────────────────────────

async function loadProjects() {
  const projects = await Tasks.getProjects(activeProfile);
  Render.renderProjects(projects, filterText);
}

function wireProjectsSection() {
  document.getElementById('project-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name')?.trim();
    if (!name) return;
    // Projects in Webwarrior are implicit (from tasks) but we can pre-define them via a meta key
    showToast(`Project "${name}" defined — add tasks with this project name`);
    e.currentTarget.reset();
    await loadProjects();
  });

  document.getElementById('project-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadProjects();
  });
}

// ── Import ────────────────────────────────────────────────────────────────────

function wireImportSection() {
  document.getElementById('btn-import-folder')?.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      showToast('File System Access API not available in this browser', 'error');
      return;
    }
    const progress = document.getElementById('import-progress');
    if (progress) progress.innerHTML = '';

    try {
      const results = await importFromFolder(({ msg, type }) => {
        if (!progress) return;
        const line = document.createElement('div');
        line.className = `import-line ${type === 'ok' ? 'import-ok' : type === 'error' ? 'import-err' : ''}`;
        line.textContent = msg;
        progress.appendChild(line);
      });

      showToast(`Imported ${results.profiles.length} profile(s)`);
      // Reload profile list
      const newActive = listProfiles()[0];
      if (newActive) { activeProfile = newActive; setActive(newActive); }
      await refreshProfileUI();
      await showSection(activeSection);
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled picker
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-import-demo')?.addEventListener('click', async () => {
    await loadDemoData(activeProfile);
    showToast('Demo data loaded');
    await showSection('tasks');
  });
}

// ── Profile ──────────────────────────────────────────────────────────────────

async function loadProfile() {
  const profiles = listProfiles();
  Render.renderProfileList(profiles, activeProfile);
}

function wireProfileSection() {
  document.getElementById('profile-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const name = fd.get('name')?.trim();
    if (!name) return;
    try {
      await createProfile(name);
      formEl.reset();
      showToast(`Profile "${name}" created`);
      await refreshProfileUI();
      await loadProfile();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('profile-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const name = btn.dataset.name;
    if (btn.dataset.action === 'switch-profile') {
      await switchProfile(name);
    } else if (btn.dataset.action === 'delete-profile') {
      if (!await confirm(`Delete profile "${name}" and all its data?`)) return;
      await deleteProfile(name);
      showToast(`Profile "${name}" deleted`);
      await refreshProfileUI();
      await loadProfile();
    }
  });
}

async function switchProfile(name) {
  activeProfile = name;
  setActive(name);
  activeJournal = 'main';
  activeLedger  = 'main';
  bulkSelected.clear();
  await refreshProfileUI();
  await showSection(activeSection);
  showToast(`Switched to ${name}`);
}

async function refreshProfileUI() {
  const profiles = listProfiles();
  activeProfile = getActive() || profiles[0];
  document.getElementById('profile-pill').textContent = activeProfile || '—';
  document.getElementById('header-profile').textContent = activeProfile || '—';
  terminal.setProfile(activeProfile);
  Render.renderProfileSwitcher(profiles, activeProfile);
}

// ── CTRL ──────────────────────────────────────────────────────────────────────

async function loadCtrl() {
  const el = document.getElementById('ctrl-storage-info');
  if (!el) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const used = (est.usage / 1048576).toFixed(2);
      const quota = (est.quota / 1048576).toFixed(0);
      el.textContent = `${used} MB used of ~${quota} MB available`;
    } else {
      el.textContent = 'Storage estimate unavailable';
    }
  } catch { el.textContent = 'IndexedDB — locally stored'; }
}

function wireCtrlSection() {
  document.getElementById('btn-ctrl-clear-profile')?.addEventListener('click', async () => {
    if (!await confirm(`Clear ALL data for profile "${activeProfile}"? This cannot be undone.`)) return;
    const { deleteDb, openDb } = await import('./storage/db.js');
    await deleteDb(activeProfile);
    await openDb(activeProfile);
    showToast('Profile data cleared');
    await showSection(activeSection);
  });
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function wireSidebar() {
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('sidebar-peek')?.classList.remove('hidden');
  });
  document.getElementById('sidebar-peek')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('collapsed');
    document.getElementById('sidebar-peek')?.classList.add('hidden');
  });

  document.getElementById('sidebar-nav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn) showSection(btn.dataset.section);
  });

  document.getElementById('btn-nav-import')?.addEventListener('click', () => showSection('import'));
  document.getElementById('btn-nav-ctrl')?.addEventListener('click', () => showSection('ctrl'));
  document.getElementById('btn-profile-screen')?.addEventListener('click', () => showSection('profile'));
  document.getElementById('btn-nav-warrior')?.addEventListener('click', () => showSection('tasks'));

  // Profile pill click = open switcher
  document.getElementById('profile-pill')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-switcher')?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('profile-switcher')?.classList.add('hidden'));

  // Header profile click = open switcher
  document.getElementById('header-profile')?.addEventListener('click', () => showSection('profile'));

  // Fullscreen: hide sidebar entirely, content fills the window
  document.getElementById('btn-sidebar-fullscreen')?.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('sidebar-hidden');
    document.getElementById('btn-sidebar-fullscreen')?.classList.toggle('active', hidden);
  });
}

function wireProfileSwitcher() {
  document.getElementById('profile-switcher')?.addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-profile]');
    if (!li) return;
    await switchProfile(li.dataset.profile);
    document.getElementById('profile-switcher')?.classList.add('hidden');
  });
}

// ── Density ──────────────────────────────────────────────────────────────────

function wireDensity() {
  const saved = localStorage.getItem('ww_density') || 'normal';
  document.body.dataset.density = saved;
  document.querySelector(`.density-btn[data-density="${saved}"]`)?.classList.add('active');

  document.querySelectorAll('.density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const d = btn.dataset.density;
      document.body.dataset.density = d;
      localStorage.setItem('ww_density', d);
    });
  });
}

// ── Help ─────────────────────────────────────────────────────────────────────

function wireHelpClose() {
  document.getElementById('btn-ww-help-close')?.addEventListener('click', () => {
    document.getElementById('ww-help-overlay')?.classList.add('hidden');
  });
  document.getElementById('ww-help-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('ww-help-overlay').classList.add('hidden');
  });
}

// ── Terminal commands ─────────────────────────────────────────────────────────

async function handleCommand(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const verb = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');

  try {
    if (verb === 't' || verb === 'task' || verb === 'add') {
      if (!rest) { terminal.showOutput('Usage: t <description>', true); return; }
      await Tasks.addTask(activeProfile, { description: rest });
      terminal.showOutput(`Task added: ${rest}`);
      if (activeSection === 'tasks') await loadTasks();
      return;
    }

    if (verb === 'j' || verb === 'journal') {
      if (!rest) { terminal.showOutput('Usage: j <text>', true); return; }
      await Journal.addEntry(activeProfile, { body: rest, journal: activeJournal });
      terminal.showOutput(`Journal entry added`);
      if (activeSection === 'journal') await loadJournal();
      return;
    }

    if (verb === 'start') {
      const tags = rest || 'work';
      await Time.startTracking(activeProfile, tags);
      terminal.showOutput(`Started tracking: ${tags}`);
      if (activeSection === 'time') await loadTime();
      return;
    }

    if (verb === 'stop') {
      const i = await Time.stopTracking(activeProfile);
      if (!i) { terminal.showOutput('No active tracking', true); return; }
      const dur = Time.formatDuration(Time.intervalDuration(i));
      terminal.showOutput(`Stopped. Duration: ${dur}`);
      if (activeSection === 'time') await loadTime();
      return;
    }

    if (verb === 'profile') {
      if (rest) { await switchProfile(rest); return; }
      terminal.showOutput(`Active profile: ${activeProfile}`);
      return;
    }

    terminal.showOutput(`Unknown command: ${verb}. Try: t, j, start, stop, profile`, true);
  } catch (err) {
    terminal.showOutput(err.message, true);
  }
}

function applyFilter(query) {
  filterText = query;
  if (activeSection === 'tasks')   loadTasks();
  if (activeSection === 'journal') loadJournal();
  if (activeSection === 'tags')    loadTags();
  if (activeSection === 'projects') loadProjects();
}

// ── Header helpers ───────────────────────────────────────────────────────────

function updateHeader() {
  const profiles = listProfiles();
  document.getElementById('profile-pill').textContent = activeProfile || '—';
  document.getElementById('header-profile').textContent = activeProfile || '—';
  document.getElementById('stat-date').textContent = new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
  Render.renderProfileSwitcher(profiles, activeProfile);
}

function updateTaskStats(count) {
  const el = document.getElementById('stat-tasks-count');
  if (!el) return;
  el.textContent = `${count} tasks`;
  el.classList.toggle('hidden', count === 0);
}

function updateTimeStat(secs) {
  const el = document.getElementById('stat-time-today');
  if (!el) return;
  if (secs < 60) { el.classList.add('hidden'); return; }
  el.textContent = Time.formatDuration(secs);
  el.classList.remove('hidden');
}

async function updateStat() {
  const tasks = await Tasks.getTasks(activeProfile);
  updateTaskStats(tasks.length);
}

// ── Lists ─────────────────────────────────────────────────────────────────────

let activeList = 'default';
let listShowDone = false;

let listFilterText = '';

async function loadLists() {
  const allLists = await Lists.getLists(activeProfile);
  populateListSelect(allLists);
  let items = await Lists.getItems(activeProfile, { list: activeList, showDone: listShowDone });
  if (listFilterText) {
    const q = listFilterText.toLowerCase();
    items = items.filter(i => i.text.toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q));
  }
  renderListItems(items);
}

function populateListSelect(lists) {
  const sel = document.getElementById('list-name-select');
  if (!sel) return;
  sel.innerHTML = lists.map(l =>
    `<option value="${l}" ${l === activeList ? 'selected' : ''}>${l}</option>`
  ).join('');
}

function renderListItems(items) {
  const el = document.getElementById('list-items');
  if (!el) return;
  if (items.length === 0) {
    el.innerHTML = `<div class="skeleton-msg">${listShowDone ? 'No items.' : 'No pending items. Add one above.'}</div>`;
    return;
  }
  el.innerHTML = items.map(i => {
    const done     = i.done;
    const noteHtml = i.note ? `<div class="list-item-note">${esc(i.note)}</div>` : '';
    const date     = new Date(i.created).toLocaleDateString('en', { month: 'short', day: 'numeric' });
    return `
      <div class="list-item" data-list-id="${i.id}">
        <div class="list-item-row">
          <input type="checkbox" class="list-item-check" data-list-action="check" data-id="${i.id}" ${done ? 'checked' : ''} ${done ? 'disabled' : ''}>
          <span class="list-item-text ${done ? 'done-text' : ''}">${esc(i.text)}</span>
          <span class="list-item-meta">${date}</span>
          <span class="list-item-actions">
            ${!done ? `<button class="list-action-pill" data-list-action="edit" data-id="${i.id}">✎ edit</button>` : ''}
            <button class="list-action-pill" data-list-action="note" data-id="${i.id}">📝 note</button>
            <button class="list-action-pill" data-list-action="to-task" data-id="${i.id}">→ task</button>
            <button class="list-action-pill" data-list-action="to-journal" data-id="${i.id}">→ journal</button>
            <button class="list-action-pill" data-list-action="to-community" data-id="${i.id}">→ community</button>
            <button class="list-action-pill danger" data-list-action="delete" data-id="${i.id}">✗</button>
          </span>
        </div>
        ${noteHtml}
        <div class="jrnl-inline-panel" data-panel="list-${i.id}"></div>
      </div>`;
  }).join('');
}

function closeAllListPanels() {
  document.querySelectorAll('#list-items .jrnl-inline-panel.open').forEach(p => {
    p.classList.remove('open'); p.innerHTML = '';
  });
  document.querySelectorAll('#list-items .list-action-pill.pill-active').forEach(b => b.classList.remove('pill-active'));
}

async function openListInlinePanel(btn, action, id) {
  const panel = document.querySelector(`.jrnl-inline-panel[data-panel="list-${id}"]`);
  if (!panel) return;
  if (panel.classList.contains('open') && btn.classList.contains('pill-active')) {
    closeAllListPanels(); return;
  }
  closeAllListPanels();
  btn.classList.add('pill-active');
  panel.classList.add('open');
  panel.innerHTML = `<div class="jrnl-inline-panel-inner">${await buildListPanelHtml(action, id)}</div>`;
  panel.querySelector('input, textarea')?.focus();
}

async function buildListPanelHtml(action, id) {
  const numId = parseInt(id);
  switch (action) {
    case 'edit': {
      const all  = await Lists.getItems(activeProfile, { list: activeList, showDone: true });
      const item = all.find(i => i.id === numId);
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="edit-text" value="${esc(item?.text || '')}" style="flex:2" placeholder="item text…">
        <button class="btn-inline-submit tdr-btn-sm" data-list-panel-action="submit-edit" data-id="${id}">save</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'note': {
      const all  = await Lists.getItems(activeProfile, { list: activeList, showDone: true });
      const item = all.find(i => i.id === numId);
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="note-text" value="${esc(item?.note || '')}" placeholder="add note…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-list-panel-action="submit-note" data-id="${id}">save</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'to-task': {
      const all  = await Lists.getItems(activeProfile, { list: activeList, showDone: true });
      const item = all.find(i => i.id === numId);
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="task-desc" value="${esc(item?.text || '')}" placeholder="task description…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-list-panel-action="submit-to-task" data-id="${id}">+ task</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'to-journal': {
      const journals = await getJournals(activeProfile);
      const opts = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
      const all  = await Lists.getItems(activeProfile, { list: activeList, showDone: true });
      const item = all.find(i => i.id === numId);
      return `<div class="jrnl-panel-row">
        <input class="jrnl-panel-input" data-field="jrnl-body" value="${esc(item?.text || '')}" placeholder="journal entry body…" style="flex:2">
        <select class="jrnl-panel-select" data-field="jrnl-name">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-list-panel-action="submit-to-journal" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'to-community': {
      const collections = await Community.listCollections();
      const active = collections.filter(c => !c.archived_at);
      if (!active.length) return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm">No collections — create one in Community first.</span>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">close</button>
      </div>`;
      const opts = active.map(c => `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
      return `<div class="jrnl-panel-row">
        <select class="jrnl-panel-select" data-field="coll-id">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-list-panel-action="submit-to-community" data-id="${id}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;
    }

    case 'delete':
      return `<div class="jrnl-panel-row">
        <span class="jrnl-panel-confirm"><strong>Delete</strong> this item?</span>
        <button class="btn-inline-submit tdr-btn-sm" style="background:var(--error);border-color:var(--error)" data-list-panel-action="submit-delete" data-id="${id}">delete</button>
        <button class="btn-inline-alt tdr-btn-sm" data-list-panel-action="cancel" data-id="${id}">cancel</button>
      </div>`;

    default: return '';
  }
}

async function handleListPanelAction(btn) {
  const action = btn.dataset.listPanelAction;
  const numId  = parseInt(btn.dataset.id);
  const panel  = document.querySelector(`.jrnl-inline-panel[data-panel="list-${btn.dataset.id}"]`);
  const field  = (key) => panel?.querySelector(`[data-field="${key}"]`)?.value ?? '';

  switch (action) {
    case 'cancel':
      closeAllListPanels(); return;

    case 'submit-edit': {
      const text = field('edit-text').trim();
      if (!text) return;
      await Lists.editItem(activeProfile, numId, text);
      showToast('Updated'); closeAllListPanels(); await loadLists(); return;
    }

    case 'submit-note': {
      await Lists.setNote(activeProfile, numId, field('note-text').trim());
      showToast('Note saved'); closeAllListPanels(); await loadLists(); return;
    }

    case 'submit-to-task': {
      const desc = field('task-desc').trim();
      if (!desc) return;
      const task = await Tasks.addTask(activeProfile, { description: desc, tags: 'list', project: '' });
      const today = new Date().toISOString().slice(0, 10);
      await Tasks.annotateTask(activeProfile, task.uuid,
        `created from list/${activeList} (${today})`
      );
      showToast('Task created'); closeAllListPanels(); return;
    }

    case 'submit-to-journal': {
      const body  = field('jrnl-body').trim();
      const jname = field('jrnl-name') || activeJournal;
      if (!body) return;
      await Journal.addEntry(activeProfile, {
        body: `${body}\n[list: ${activeList}]`,
        journal: jname,
      });
      showToast(`Added to ${jname}`); closeAllListPanels(); return;
    }

    case 'submit-to-community': {
      const collSel  = panel?.querySelector('[data-field="coll-id"]');
      const collId   = parseInt(collSel?.value);
      const collName = collSel?.options[collSel.selectedIndex]?.dataset.name || '';
      if (!collId) return;
      const all  = await Lists.getItems(activeProfile, { list: activeList, showDone: true });
      const item = all.find(i => i.id === numId);
      await Community.addEntry(collId, {
        type:    'list',
        profile: activeProfile,
        content: item,
      });
      showToast(`Added to ${collName}`); closeAllListPanels(); return;
    }

    case 'submit-delete': {
      await Lists.deleteItem(activeProfile, numId);
      showToast('Deleted'); closeAllListPanels(); await loadLists(); return;
    }
  }
}

function wireListsSection() {
  document.getElementById('add-list-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd   = new FormData(e.currentTarget);
    const text = fd.get('text')?.trim();
    if (!text) return;
    await Lists.addItem(activeProfile, text, activeList);
    document.getElementById('list-item-text').value = '';
    showToast('Item added');
    await loadLists();
  });

  document.getElementById('btn-new-list')?.addEventListener('click', async () => {
    const name = await promptText('List name:');
    if (!name || !/\S/.test(name)) return;
    await Lists.addList(activeProfile, name.trim());
    activeList = name.trim();
    showToast(`List "${name.trim()}" created`);
    await loadLists();
  });

  document.getElementById('btn-delete-list')?.addEventListener('click', async () => {
    if (!await confirm(`Delete list "${activeList}" and all its items?`)) return;
    await Lists.deleteList(activeProfile, activeList);
    activeList = 'default';
    showToast('List deleted');
    await loadLists();
  });

  document.getElementById('list-name-select')?.addEventListener('change', (e) => {
    activeList = e.target.value;
    closeAllListPanels();
    loadLists();
  });

  document.getElementById('list-filter')?.addEventListener('input', (e) => {
    listFilterText = e.target.value.trim();
    loadLists();
  });

  document.getElementById('btn-list-show-done')?.addEventListener('click', () => {
    listShowDone = !listShowDone;
    document.getElementById('btn-list-show-done')?.classList.toggle('active', listShowDone);
    loadLists();
  });

  document.getElementById('list-items')?.addEventListener('click', async (e) => {
    // Panel submit/cancel
    const panelBtn = e.target.closest('[data-list-panel-action]');
    if (panelBtn) { await handleListPanelAction(panelBtn); return; }

    const btn = e.target.closest('[data-list-action]');
    if (!btn) return;
    const action = btn.dataset.listAction;
    const id     = parseInt(btn.dataset.id);

    if (action === 'check') {
      if (btn.checked) {
        await Lists.finishItem(activeProfile, id);
        showToast('Done');
        await loadLists();
      }
      return;
    }

    // Pill actions → inline panels
    if (['edit','note','to-task','to-journal','to-community','delete'].includes(action)) {
      await openListInlinePanel(btn, action, id);
      return;
    }
  });
}

// ── Next ──────────────────────────────────────────────────────────────────────

async function loadNext() {
  const [next, upcoming, overdue] = await Promise.all([
    Next.getNext(activeProfile),
    Next.getUpcoming(activeProfile, 7),
    Next.getOverdue(activeProfile),
  ]);

  const card = document.getElementById('next-card');
  if (card) {
    if (!next) {
      card.innerHTML = '<div class="skeleton-msg" style="color:var(--success)">✓ Nothing urgent — all clear.</div>';
    } else {
      const t = next.task;
      card.innerHTML = `
        <div class="next-card-main">
          <div class="next-card-label">recommended</div>
          <div class="next-card-desc">${esc(t.description)}</div>
          ${t.project ? `<span class="task-project-badge">${esc(t.project)}</span>` : ''}
          ${(t.tags||[]).map(g => `<span class="task-tag">${esc(g)}</span>`).join('')}
          ${t.priority ? `<span class="task-priority pri-${t.priority.toLowerCase()}">${t.priority}</span>` : ''}
          <div class="next-card-rationale">${esc(next.rationale)}</div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn-inline-submit" data-action="start" data-uuid="${t.uuid}">▶ start</button>
            <button class="btn-inline-alt" data-action="done" data-uuid="${t.uuid}">✓ done</button>
          </div>
        </div>`;
    }
  }

  const upEl = document.getElementById('next-upcoming');
  if (upEl) {
    upEl.innerHTML = upcoming.length === 0
      ? '<div style="font-size:11px;color:var(--muted)">None</div>'
      : upcoming.map(t => `<div class="task-row"><span class="task-desc">${esc(t.description)}</span><span class="task-due task-due-soon">${new Date(t.due).toLocaleDateString()}</span></div>`).join('');
  }

  const ovEl = document.getElementById('next-overdue');
  if (ovEl) {
    ovEl.innerHTML = overdue.length === 0
      ? '<div style="font-size:11px;color:var(--muted)">None</div>'
      : overdue.map(t => `<div class="task-row"><span class="task-desc">${esc(t.description)}</span><span class="task-due task-due-overdue">overdue</span></div>`).join('');
  }
}

function wireNextSection() {
  document.getElementById('next-card')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'start') await Tasks.startTask(activeProfile, btn.dataset.uuid);
    if (btn.dataset.action === 'done')  await Tasks.completeTask(activeProfile, btn.dataset.uuid);
    showToast('Done');
    await loadNext();
  });
}

// ── Warrior ───────────────────────────────────────────────────────────────────

async function loadWarrior() {
  const { profiles, totals } = await Warrior.getWarriorStats();

  const totalsEl = document.getElementById('warrior-totals');
  if (totalsEl) {
    totalsEl.innerHTML = [
      statChip('tasks', totals.tasks, 'var(--clr-tasks)'),
      statChip('active', totals.active, 'var(--success)'),
      statChip('overdue', totals.overdue, 'var(--error)'),
      statChip('journal', totals.journal, 'var(--clr-journal)'),
      statChip('ledger', totals.ledger, 'var(--clr-ledger)'),
    ].join('');
  }

  const profEl = document.getElementById('warrior-profiles');
  if (profEl) {
    profEl.innerHTML = profiles.map(p => `
      <div class="task-row" style="align-items:center">
        <span class="task-desc" style="font-weight:bold">${esc(p.profile)}</span>
        <span class="task-project-badge">${p.tasks} tasks</span>
        ${p.overdue > 0 ? `<span style="font-size:11px;color:var(--error)">${p.overdue} overdue</span>` : ''}
        ${p.active  > 0 ? `<span style="font-size:11px;color:var(--success)">${p.active} active</span>` : ''}
        ${p.topTask ? `<span style="font-size:11px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.topTask.description)}">→ ${esc(p.topTask.description)}</span>` : ''}
        <button class="btn-inline-alt" style="font-size:10px;padding:1px 8px" data-action="switch-to" data-profile="${esc(p.profile)}">switch</button>
      </div>
    `).join('');
  }
}

function statChip(label, value, color) {
  return `<span style="font-size:12px;padding:4px 10px;border:1px solid ${color};border-radius:4px;color:${color}">${value} ${label}</span>`;
}

function wireWarriorSection() {
  document.getElementById('warrior-profiles')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="switch-to"]');
    if (btn) await switchProfile(btn.dataset.profile);
  });
}

// ── Community ─────────────────────────────────────────────────────────────────

let activeCommunity = null;
let communityView   = 'unified';
let communitySearch = '';

async function loadCommunity() {
  const collections = await Community.listCollections();
  const active = collections.filter(c => !c.archived_at);

  const sel = document.getElementById('community-select');
  if (sel) {
    sel.innerHTML = active.length === 0
      ? '<option value="">no collections</option>'
      : active.map(c => `<option value="${c.id}" ${c.id === activeCommunity ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    if (!activeCommunity && active.length > 0) activeCommunity = active[0].id;
  }

  await renderCommunityBody();
}

async function renderCommunityBody() {
  const body = document.getElementById('community-body');
  if (!body) return;
  if (!activeCommunity) {
    body.innerHTML = '<div class="skeleton-msg">Select or create a collection above.</div>';
    return;
  }

  let entries = await Community.getEntries(activeCommunity, { view: communityView });

  if (communitySearch) {
    const q = communitySearch.toLowerCase();
    entries = entries.filter(e => {
      const c = e.content || {};
      const text = [c.description, c.body, ...(c.tags || []), ...(e.tags || [])].join(' ').toLowerCase();
      return text.includes(q) || (e.source_ref || '').toLowerCase().includes(q);
    });
  }

  if (entries.length === 0) {
    body.innerHTML = '<div class="skeleton-msg">No entries in this collection.</div>';
    return;
  }

  body.innerHTML = entries.map(e => renderCommEntry(e)).join('');
}

function renderCommEntry(e) {
  const c = e.content || {};
  const ts = fmtShortDate(e.added_at);

  // Build content block based on type
  let contentHtml = '';
  let metaHtml    = '';
  let actionsHtml = '';

  if (e.type === 'task') {
    const tags    = (c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`).join('');
    const project = c.project ? `<span class="task-project-badge">${esc(c.project)}</span>` : '';
    const pri     = c.priority ? `<span class="comm-status-badge">${esc(c.priority)}</span>` : '';
    const status  = c.status   ? `<span class="comm-status-badge">${esc(c.status)}</span>`   : '';
    contentHtml = `<div class="comm-content"><strong>${esc(c.description || '(task)')}</strong></div>`;
    metaHtml    = `<div class="comm-entry-meta">${project}${pri}${tags}${status}</div>`;
    actionsHtml = `
      <button class="comm-action-sm" data-comm-action="open-comment"   data-id="${e.id}">✎ comment</button>
      <button class="comm-action-sm" data-comm-action="annotate-task"  data-id="${e.id}">✎ annotate task</button>
      <button class="comm-action-sm" data-comm-action="copy-to-journal" data-id="${e.id}">→ journal</button>
      <button class="comm-action-sm" data-comm-action="refresh-entry"  data-id="${e.id}">↺ refresh</button>`;
  } else if (e.type === 'journal') {
    const body    = c.body || '';
    const trunc   = body.length > 200 ? body.slice(0, 200) + '…' : body;
    const tags    = (c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`).join('');
    const project = c.project ? `<span class="task-project-badge">${esc(c.project)}</span>` : '';
    contentHtml = `<div class="comm-content">${esc(trunc)}</div>`;
    metaHtml    = `<div class="comm-entry-meta">${project}${tags}</div>`;
    actionsHtml = `
      <button class="comm-action-sm" data-comm-action="open-comment"    data-id="${e.id}">✎ comment</button>
      <button class="comm-action-sm" data-comm-action="annotate-source" data-id="${e.id}">✎ annotate source</button>
      <button class="comm-action-sm" data-comm-action="journal-back"    data-id="${e.id}">→ journal</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task"    data-id="${e.id}">→ task</button>`;
  } else if (e.type === 'ledger') {
    contentHtml = `<div class="comm-content"><strong>${esc(c.description || '')}</strong> <span style="color:var(--muted);font-size:11px">${esc(c.date || '')}</span></div>`;
    actionsHtml = `<button class="comm-action-sm" data-comm-action="open-comment" data-id="${e.id}">✎ comment</button>`;
  } else if (e.type === 'time') {
    const tags = ((c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`)).join('');
    const dur  = c.end ? Time.formatDuration(Time.intervalDuration(c)) : '(active)';
    contentHtml = `<div class="comm-content">${tags || '<em style="color:var(--muted)">untagged</em>'} <span style="color:var(--muted)">${esc(dur)}</span></div>`;
    actionsHtml = `<button class="comm-action-sm" data-comm-action="open-comment" data-id="${e.id}">✎ comment</button>`;
  } else if (e.type === 'list') {
    const status = c.done ? '<span class="comm-status-badge">done</span>' : '';
    contentHtml = `<div class="comm-content">${esc(c.text || '')} ${status}</div>`;
    if (c.note) metaHtml = `<div class="comm-entry-meta" style="font-style:italic;color:var(--muted);font-size:11px">${esc(c.note)}</div>`;
    actionsHtml = `
      <button class="comm-action-sm" data-comm-action="open-comment"   data-id="${e.id}">✎ comment</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task"   data-id="${e.id}">→ task</button>
      <button class="comm-action-sm" data-comm-action="copy-to-journal" data-id="${e.id}">→ journal</button>`;
  }

  const commentsHtml = e.comments.length ? `<div class="comm-comments">${e.comments.map(c => `
    <div class="comm-comment-item">
      <span class="comm-comment-body">${esc(c.body)}</span>
      <span class="comm-comment-meta">${esc(c.profile)} · ${fmtShortDate(c.created_at)}</span>
      <button class="comm-comment-del" data-comm-action="del-comment" data-id="${c.id}" title="delete">✗</button>
    </div>`).join('')}</div>` : '';

  return `
    <div class="comm-entry" data-comm-id="${e.id}" data-comm-type="${esc(e.type)}">
      <div class="comm-entry-header">
        <span class="comm-source-ref" title="${esc(e.source_ref||'')}">${esc(e.source_ref || e.profile)}</span>
        <span class="comm-entry-ts">${ts}</span>
        <div class="comm-header-actions">
          <button class="comm-action-sm danger" data-comm-action="remove-entry" data-id="${e.id}">✗ remove</button>
        </div>
      </div>
      <span class="comm-type-badge type-${esc(e.type)}">${esc(e.type)}</span>
      ${contentHtml}
      ${metaHtml}
      ${commentsHtml}
      <div class="comm-inline-panel" data-comm-panel="${e.id}"></div>
      <div class="comm-actions-row">${actionsHtml}</div>
    </div>`;
}

function wireCommunitySection() {
  // Toggle create form
  document.getElementById('btn-comm-show-create')?.addEventListener('click', () => {
    document.getElementById('community-create-form')?.classList.remove('hidden');
  });
  document.getElementById('btn-comm-hide-create')?.addEventListener('click', () => {
    document.getElementById('community-create-form')?.classList.add('hidden');
  });

  document.getElementById('community-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd   = new FormData(formEl);
    const name = fd.get('name')?.trim();
    if (!name) return;
    const id = await Community.createCollection(name, fd.get('description')?.trim() || '');
    activeCommunity = id;
    formEl.reset();
    document.getElementById('community-create-form')?.classList.add('hidden');
    showToast(`Collection "${name}" created`);
    await loadCommunity();
  });

  document.getElementById('community-select')?.addEventListener('change', (e) => {
    activeCommunity = parseInt(e.target.value);
    renderCommunityBody();
  });

  document.getElementById('btn-community-archive')?.addEventListener('click', async () => {
    if (!activeCommunity) return;
    if (!await confirm('Archive this collection?')) return;
    await Community.archiveCollection(activeCommunity);
    activeCommunity = null;
    showToast('Archived');
    await loadCommunity();
  });

  // View tabs
  document.getElementById('section-community')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.community-tab');
    if (tab) {
      document.querySelectorAll('.community-tab').forEach(b => b.classList.remove('active'));
      tab.classList.add('active');
      communityView = tab.dataset.view;
      renderCommunityBody();
    }
  });

  // Search
  document.getElementById('comm-search')?.addEventListener('input', (e) => {
    communitySearch = e.target.value.trim();
    renderCommunityBody();
  });

  // Entry actions (delegated)
  document.getElementById('community-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-comm-action]');
    if (!btn) return;
    const action = btn.dataset.commAction;
    const id     = parseInt(btn.dataset.id);
    const entry  = btn.closest('.comm-entry');
    const entryId = entry ? parseInt(entry.dataset.commId) : null;

    switch (action) {
      case 'remove-entry': {
        if (!await confirm('Remove from collection?')) return;
        await Community.removeEntry(id);
        showToast('Removed');
        await renderCommunityBody();
        return;
      }

      case 'del-comment': {
        await Community.deleteComment(id);
        showToast('Deleted');
        await renderCommunityBody();
        return;
      }

      case 'refresh-entry': {
        if (!entryId) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === entryId);
        if (!ce) return;
        let freshContent = null;
        if (ce.type === 'task') {
          freshContent = await Tasks.getTask(activeProfile, ce.content?.uuid);
        } else if (ce.type === 'journal') {
          const all = await Journal.getEntries(activeProfile, { limit: 10000 });
          freshContent = all.find(x => x.id === ce.content?.id);
        }
        if (!freshContent) { showToast('Source not found', 'warning'); return; }
        await Community.refreshEntry(entryId, freshContent);
        showToast('Refreshed');
        await renderCommunityBody();
        return;
      }

      // ── Inline panels ─────────────────────────────────────────────────────
      case 'open-comment':
      case 'annotate-task':
      case 'copy-to-journal':
      case 'journal-back':
      case 'annotate-source':
      case 'copy-to-task': {
        await openCommInlinePanel(btn, action, entryId);
        return;
      }

      // ── Panel submits ──────────────────────────────────────────────────────
      case 'submit-comment': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text  = panel?.querySelector('[data-field="comment-text"]')?.value?.trim();
        if (!text) return;
        await Community.addComment(entryId, text, activeProfile);
        showToast('Comment added');
        closeAllCommPanels();
        await renderCommunityBody();
        return;
      }

      case 'submit-copy-to-journal': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text  = panel?.querySelector('[data-field="jrnl-text"]')?.value?.trim();
        const jname = panel?.querySelector('[data-field="jrnl-name"]')?.value || activeJournal;
        if (!text) return;
        // Fetch entry to build context
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce   = allE.find(x => x.id === entryId);
        const body = `${text}\n[community: ${ce?.source_ref || ''}]`;
        await Journal.addEntry(activeProfile, { body, journal: jname });
        showToast(`Added to ${jname}`);
        closeAllCommPanels();
        return;
      }

      case 'submit-annotate-task': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text  = panel?.querySelector('[data-field="ann-text"]')?.value?.trim();
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce   = allE.find(x => x.id === entryId);
        if (!ce?.content?.uuid) { showToast('Source task not found', 'warning'); return; }
        await Tasks.annotateTask(activeProfile, ce.content.uuid, text);
        // Refresh snapshot so annotation shows in community
        const fresh = await Tasks.getTask(activeProfile, ce.content.uuid);
        if (fresh) await Community.refreshEntry(entryId, fresh);
        showToast('Task annotated');
        closeAllCommPanels();
        await renderCommunityBody();
        return;
      }

      case 'submit-annotate-source': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text  = panel?.querySelector('[data-field="ann-text"]')?.value?.trim();
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce   = allE.find(x => x.id === entryId);
        if (!ce?.content?.id) { showToast('Source entry not found', 'warning'); return; }
        await Journal.annotateEntry(activeProfile, ce.content.id, text);
        const all = await Journal.getEntries(activeProfile, { limit: 10000 });
        const fresh = all.find(x => x.id === ce.content.id);
        if (fresh) await Community.refreshEntry(entryId, fresh);
        showToast('Journal entry annotated');
        closeAllCommPanels();
        await renderCommunityBody();
        return;
      }

      case 'submit-journal-back': {
        const panel  = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const jname  = panel?.querySelector('[data-field="jrnl-name"]')?.value || activeJournal;
        const allE   = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce     = allE.find(x => x.id === entryId);
        if (!ce?.content) { showToast('Source not found', 'warning'); return; }
        // Reconstruct the body from the snapshot, tagging it with origin
        const srcBody = ce.content.body || '';
        const body    = `${srcBody}\n[from community: ${ce.source_ref || ''}]`;
        await Journal.addEntry(activeProfile, {
          body,
          journal:  jname,
          project:  ce.content.project  || '',
          tags:     (ce.content.tags || []).join(' '),
          priority: ce.content.priority || '',
        });
        showToast(`Added to ${jname}`);
        closeAllCommPanels();
        return;
      }

      case 'submit-copy-to-task': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const desc  = panel?.querySelector('[data-field="task-desc"]')?.value?.trim();
        if (!desc) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce   = allE.find(x => x.id === entryId);
        const task = await Tasks.addTask(activeProfile, {
          description: desc,
          tags:    [...(ce?.content?.tags || []), 'community'].join(' '),
          project: ce?.content?.project || '',
        });
        // Annotate with source and creation action
        const today    = new Date().toISOString().slice(0, 10);
        const collName = (await Community.listCollections()).find(c => c.id === activeCommunity)?.name || '';
        await Tasks.annotateTask(activeProfile, task.uuid,
          `created from community/${collName} — ${ce?.source_ref || 'unknown'} (${today})`
        );
        showToast('Task created');
        closeAllCommPanels();
        return;
      }

      case 'cancel-comm-panel':
        closeAllCommPanels();
        return;
    }
  });
}

function closeAllCommPanels() {
  document.querySelectorAll('.comm-inline-panel.open').forEach(p => {
    p.classList.remove('open'); p.innerHTML = '';
  });
  document.querySelectorAll('.comm-action-sm.pill-active').forEach(b => b.classList.remove('pill-active'));
}

async function openCommInlinePanel(btn, action, entryId) {
  if (btn.classList.contains('pill-active')) { closeAllCommPanels(); return; }
  closeAllCommPanels();
  const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
  if (!panel) return;

  btn.classList.add('pill-active');
  panel.classList.add('open');
  panel.innerHTML = `<div class="comm-inline-panel-inner">${await buildCommPanelHtml(action, entryId)}</div>`;
  panel.querySelector('input, textarea')?.focus();
}

async function buildCommPanelHtml(action, entryId) {
  switch (action) {
    case 'open-comment':
      return `<div class="comm-panel-row">
        <input class="comm-panel-input" data-field="comment-text" placeholder="add comment…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-comment" data-id="${entryId}">+ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;

    case 'copy-to-journal': {
      const journals = await getJournals(activeProfile);
      const opts = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
      return `<div class="comm-panel-row">
        <input class="comm-panel-input" data-field="jrnl-text" placeholder="note to journal…" style="flex:2">
        <select class="jrnl-panel-select" data-field="jrnl-name">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-copy-to-journal" data-id="${entryId}">→ add</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;
    }

    case 'annotate-task':
      return `<div class="comm-panel-row">
        <input class="comm-panel-input" data-field="ann-text" placeholder="annotation for task…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-annotate-task" data-id="${entryId}">✎ annotate</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;

    case 'journal-back': {
      const journals = await getJournals(activeProfile);
      const opts = journals.map(j => `<option value="${esc(j)}" ${j === activeJournal ? 'selected' : ''}>${esc(j)}</option>`).join('');
      return `<div class="comm-panel-row">
        <span class="jrnl-panel-confirm" style="flex:0 0 auto">Send to:</span>
        <select class="jrnl-panel-select" data-field="jrnl-name">${opts}</select>
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-journal-back" data-id="${entryId}">→ journal</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;
    }

    case 'annotate-source':
      return `<div class="comm-panel-row">
        <input class="comm-panel-input" data-field="ann-text" placeholder="annotate source entry…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-annotate-source" data-id="${entryId}">✎ annotate</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;

    case 'copy-to-task':
      return `<div class="comm-panel-row">
        <input class="comm-panel-input" data-field="task-desc" placeholder="task description…" style="flex:2">
        <button class="btn-inline-submit tdr-btn-sm" data-comm-action="submit-copy-to-task" data-id="${entryId}">+ task</button>
        <button class="btn-inline-alt tdr-btn-sm" data-comm-action="cancel-comm-panel" data-id="${entryId}">cancel</button>
      </div>`;

    default: return '';
  }
}

// ── Questions ─────────────────────────────────────────────────────────────────

let activeTemplate = null;

async function loadQuestions() {
  const templates = await Questions.getTemplates(activeProfile);
  const el = document.getElementById('questions-templates');
  if (!el) return;
  el.innerHTML = templates.map(t => `
    <div class="task-row">
      <span class="task-desc">${esc(t.name)}</span>
      <span style="font-size:11px;color:var(--muted);flex:1">${esc(t.description || '')}</span>
      <span class="task-project-badge">${esc(t.service)}</span>
      <button class="btn-inline-submit" style="font-size:10px;padding:2px 10px" data-action="run-template" data-id="${esc(t.id)}">run</button>
    </div>
  `).join('');
}

function wireQuestionsSection() {
  document.getElementById('questions-templates')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="run-template"]');
    if (!btn) return;
    const templates = await Questions.getTemplates(activeProfile);
    const template = templates.find(t => t.id === btn.dataset.id);
    if (!template) return;
    activeTemplate = template;
    renderQuestionForm(template);
  });

  document.getElementById('btn-questions-submit')?.addEventListener('click', async () => {
    if (!activeTemplate) return;
    const form = document.getElementById('questions-answer-form');
    const fd = new FormData(form);
    const answers = {};
    for (const [k, v] of fd.entries()) answers[k] = v;
    const action = Questions.buildAction(activeTemplate, answers);
    if (!action) { showToast('Cannot dispatch this template', 'error'); return; }

    try {
      await dispatchQuestionAction(action);
      showToast(`${activeTemplate.name} — submitted`);
      document.getElementById('questions-active-form')?.classList.add('hidden');
      activeTemplate = null;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-questions-cancel')?.addEventListener('click', () => {
    document.getElementById('questions-active-form')?.classList.add('hidden');
    activeTemplate = null;
  });
}

function renderQuestionForm(template) {
  document.getElementById('questions-form-title').textContent = template.name;
  const form = document.getElementById('questions-answer-form');
  form.innerHTML = template.fields.map(f => `
    <div style="margin-bottom:8px">
      <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:3px">${esc(f.label)}</label>
      ${f.type === 'textarea'
        ? `<textarea name="${f.key}" rows="4" style="width:100%;box-sizing:border-box" class="inline-filter">${esc(f.default||'')}</textarea>`
        : f.type === 'select'
          ? `<select name="${f.key}" class="resource-select">${(f.options||[]).map(o => `<option ${o===f.default?'selected':''}>${o}</option>`).join('')}</select>`
          : `<input type="${f.type==='date'?'date':'text'}" name="${f.key}" value="${esc(f.default||'')}" class="inline-filter" style="width:100%">`
      }
    </div>
  `).join('');
  document.getElementById('questions-active-form')?.classList.remove('hidden');
}

async function dispatchQuestionAction(action) {
  switch (action.service) {
    case 'tasks':   return Tasks.addTask(activeProfile, action.args);
    case 'journal': return Journal.addEntry(activeProfile, action.args);
    case 'time':    return Time.startTracking(activeProfile, action.args.tags, action.args.annotation);
    case 'ledger':  return Ledger.addTransaction(activeProfile, action.args);
    default: throw new Error(`Unknown service: ${action.service}`);
  }
}

// ── Export (expanded) ─────────────────────────────────────────────────────────

function wireExportSection() {
  document.getElementById('btn-export-json')?.addEventListener('click', async () => {
    const data = await Export.exportJSON(activeProfile);
    downloadText(data, `webwarrior-${activeProfile}-${today()}.json`, 'application/json');
  });

  document.getElementById('btn-export-tasks-csv')?.addEventListener('click', async () => {
    const data = await Export.exportTasksCSV(activeProfile);
    downloadText(data, `tasks-${activeProfile}-${today()}.csv`, 'text/csv');
  });

  document.getElementById('btn-export-journal-md')?.addEventListener('click', async () => {
    const data = await Export.exportJournalMarkdown(activeProfile);
    downloadText(data, `journal-${activeProfile}-${today()}.md`, 'text/markdown');
  });

  document.getElementById('btn-export-hledger')?.addEventListener('click', async () => {
    const data = await Export.exportHledger(activeProfile);
    downloadText(data, `${activeProfile}-${today()}.journal`, 'text/plain');
  });
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Broadcast Channel ─────────────────────────────────────────────────────────

let _channel = null;

function initBroadcastChannel() {
  if (!window.BroadcastChannel) return;
  _channel = new BroadcastChannel('ww-sync');
  _channel.onmessage = ({ data }) => {
    if (data.profile !== activeProfile) return;
    // Another tab mutated data — reload affected section
    const affected = { tasks: 'tasks', journal: 'journal', time: 'time', ledger: 'ledger',
                       lists: 'lists', community: 'community' };
    if (affected[data.store] === activeSection) loadSection(activeSection);
  };
}

function broadcast(store) {
  _channel?.postMessage({ profile: activeProfile, store, ts: Date.now() });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtShortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch(err => {
  document.body.innerHTML = `<div style="padding:20px;color:#f85149;font-family:monospace">Boot error: ${err.message}</div>`;
  console.error(err);
});
