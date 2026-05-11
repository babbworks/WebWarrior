// app.js — Webwarrior entry point
// All data stays in the browser. No network requests after page load.

import { ensureDefaultProfile, listProfiles, createProfile, deleteProfile, getActive, setActive, getJournals, addJournal, getLedgers, addLedger, getUdaKeys, addUdaKey, getTaskLists, addTaskList, removeTaskList, getTimeLogs, addTimeLog, removeTimeLog, getQuestionLists, addQuestionList, removeQuestionList } from './storage/profiles.js';
import * as _Tasks     from './services/tasks/index.js';
import * as _Time      from './services/time/index.js';
import * as _Journal   from './services/journal/index.js';
import * as _Ledger    from './services/ledger/index.js';
import * as _Lists     from './services/lists/index.js';
import * as Next      from './services/next/index.js';
import * as Warrior   from './services/warrior/index.js';
import * as _Questions from './services/questions/index.js';
import * as _Community from './services/community/index.js';
import * as Export    from './services/export/index.js';
import * as _Attributes from './services/attributes/index.js';
import * as Render    from './ui/render.js';
import { Terminal }   from './ui/terminal.js';
import { showToast, confirm, promptText } from './ui/modals.js';
import { importFromFolder, loadDemoData } from './storage/import.js';
import * as Stream    from './services/stream/index.js';
import { renderLens, setAsciiMode, renderComparison } from './services/stream/render.js';
import { registerAll as streamRegisterAll } from './services/stream/intercept.js';
import { computeRegeneration } from './services/stream/regen.js';
import * as Viz from './services/viz/index.js';
import * as Gallery from './services/viz/gallery.js';
import { initWorksListener, notifyProfileChange, closeWorksListener } from './services/works-bridge/listener.js';

// ── Service proxies (intercepted when Stream is active) ──────────────────────
// These start as the raw modules, then get replaced with intercepted versions at boot.
let Tasks = _Tasks;
let Time = _Time;
let Journal = _Journal;
let Ledger = _Ledger;
let Lists = _Lists;
let Questions = _Questions;
let Community = _Community;
let Attributes = _Attributes;

// ── State ────────────────────────────────────────────────────────────────────

let activeSection = 'tasks';
let activeProfile = null;
let taskGroupMode = false;
let taskShowDone  = false;
let taskShowAnns  = true;
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
let streamActiveFilter = null;
let streamCustomFrom = null;
let streamCustomTo = null;
let tagsSort      = 'name';
let functionsLocked = false;

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
  wireVizSection();
  wireAttributesSection();
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
  wireWelcome();
  await showSection(activeSection, { noScroll: true });
  updateStat();
  // Initialize Stream service (non-blocking — stream is additive)
  try {
    await Stream.init(activeProfile);
    // Load config to pass gap_threshold to intercept layer
    const streamConfig = await Stream.getConfig(activeProfile);
    // Replace service references with intercepted versions
    const wrapped = streamRegisterAll(activeProfile, {
      tasks: _Tasks, time: _Time, journal: _Journal, ledger: _Ledger,
      lists: _Lists, questions: _Questions, community: _Community, attributes: _Attributes,
    }, { gapThreshold: streamConfig.gap_threshold || 300 });
    if (wrapped.tasks) Tasks = wrapped.tasks;
    if (wrapped.time) Time = wrapped.time;
    if (wrapped.journal) Journal = wrapped.journal;
    if (wrapped.ledger) Ledger = wrapped.ledger;
    if (wrapped.lists) Lists = wrapped.lists;
    if (wrapped.questions) Questions = wrapped.questions;
    if (wrapped.community) Community = wrapped.community;
    if (wrapped.attributes) Attributes = wrapped.attributes;
    // Set up live mini waveform subscription
    initMiniWaveform();
    // Task 31: Check if read-only (another tab owns the stream)
    if (Stream.isReadOnly()) {
      showToast('Stream active in another tab (read-only)');
    }
  } catch (err) {
    console.warn('[Stream] Init skipped:', err.message);
  }
  updateStreamUI();

  // Initialize Works Bridge listener
  try {
    initWorksListener({
      getTasksFn: (profile) => Tasks.getTasks(profile),
      getTimeFn: (profile) => Time.getIntervals(profile),
      getJournalFn: (profile) => Journal.getEntries(profile),
      getLedgerFn: (profile) => Ledger.getTransactions(profile),
      streamBus: Stream.bus,
    });
    updateBridgeUI();
  } catch (err) {
    console.warn('[WorksBridge] Init skipped:', err.message);
  }
}

// ── Section navigation ───────────────────────────────────────────────────────

const SECTION_TITLES = {
  tasks:     'Tasks',
  time:      'Times',
  journal:   'Journals',
  ledger:    'Ledgers',
  lists:     'Lists',
  tags:      'Tags',
  attributes: 'Atts',
  next:      'Next',
  warrior:   'Warrior',
  community: 'Communities',
  questions: 'Questions',
  projects:  'Projects',
  stream:    'Stream',
  bridge:    'Bridge',
  viz:       'Viz',
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

  const previousSection = activeSection;
  activeSection = name;
  filterText = '';

  // Emit navigation event to stream if active
  if (previousSection !== name) {
    try {
      Stream.emitNavEvent(activeProfile, previousSection, name);
    } catch (e) { /* stream may not be initialized */ }
  }

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

  // Hide scrollbar for community section
  if (name === 'community') {
    contentArea?.classList.add('comm-no-scrollbar');
  } else {
    contentArea?.classList.remove('comm-no-scrollbar');
  }

  if (!noScroll) {
    const area = document.getElementById('content-area');
    if (area) area.scrollTop = scrollPositions.get(name) || 0;
  }

  // Auto-sync sub-lists when not locked
  if (!functionsLocked && !noScroll) {
    const syncName = activeTaskList !== 'main' ? activeTaskList : (activeTimeLog !== 'main' ? activeTimeLog : activeJournal);
    if (syncName && syncName !== 'main') {
      if (name === 'tasks') activeTaskList = syncName;
      else if (name === 'time') activeTimeLog = syncName;
      else if (name === 'journal') activeJournal = syncName;
    }
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
    case 'attributes': return loadAttributes();
    case 'next':      return loadNext();
    case 'warrior':   return loadWarrior();
    case 'community': return loadCommunity();
    case 'questions': return loadQuestions();
    case 'projects':  return loadProjects();
    case 'stream':    return loadStream();
    case 'viz':       return loadViz();
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

  document.getElementById('btn-compact-toggle')?.addEventListener('click', () => {
    const taskList = document.getElementById('task-list');
    const isCompact = taskList?.classList.toggle('task-list-compact');
    document.getElementById('btn-compact-toggle')?.classList.toggle('active', isCompact);
    // Toggle full/compact action buttons
    taskList?.querySelectorAll('.task-actions-full').forEach(el => el.classList.toggle('hidden', isCompact));
    taskList?.querySelectorAll('.task-actions-compact').forEach(el => el.classList.toggle('hidden', !isCompact));
  });

  document.getElementById('task-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadTasks();
  });

  // Delegate task action clicks
  document.getElementById('task-list')?.addEventListener('click', async (e) => {
    // Annotation hover action buttons
    const annBtn = e.target.closest('.ann-hover-btn');
    if (annBtn) {
      e.stopPropagation();
      const action = annBtn.dataset.annAction;
      const uuid = annBtn.dataset.uuid || annBtn.dataset.id;
      const idx = parseInt(annBtn.dataset.idx);
      await openAnnInlineDrop(annBtn, action, uuid, idx);
      return;
    }

    // Inline drop panel submit buttons
    const dropBtn = e.target.closest('[data-drop-action]');
    if (dropBtn) { await handleTaskDropAction(dropBtn); return; }

    // Inline drop list item click (for dep)
    const dropItem = e.target.closest('.task-inline-drop-list-item[data-dep-uuid]');
    if (dropItem) return; // handled by dep-specific buttons inside

    // Inline panel submit/cancel (must check before data-action routing)
    const panelBtn = e.target.closest('[data-panel-action]');
    if (panelBtn) { await handleTaskInlinePanelAction(panelBtn); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, uuid } = el.dataset;
    if (action === 'select') { toggleBulkSelect(uuid, el.checked); return; }
    if (action === 'inline-annotate') { openTaskInlineDrop(uuid, 'annotate'); return; }
    if (action === 'inline-journal') { openTaskInlineDrop(uuid, 'journal'); return; }
    if (action === 'inline-dep') { openTaskInlineDrop(uuid, 'dep'); return; }
    if (action === 'inline-comm') { openTaskInlineDrop(uuid, 'comm'); return; }
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

// ── Task inline drop panels ──────────────────────────────────────────────────

function closeAllTaskDrops() {
  document.querySelectorAll('.task-inline-drop.open').forEach(d => { d.classList.remove('open'); d.innerHTML = ''; });
}

async function openTaskInlineDrop(uuid, mode) {
  closeAllTaskDrops();
  const drop = document.querySelector(`.task-inline-drop[data-drop="task-${uuid}"]`);
  if (!drop) return;

  let html = '';
  if (mode === 'annotate') {
    html = `<div class="task-inline-drop-row">
      <input type="text" class="task-inline-drop-input" data-drop-field="ann-text" placeholder="annotation…" autofocus />
      <button class="task-inline-drop-btn" data-drop-action="submit-ann" data-uuid="${uuid}">add</button>
    </div>`;
  } else if (mode === 'journal') {
    const journals = await getJournals(activeProfile);
    const opts = journals.map(j => `<option value="${j}"${j === activeJournal ? ' selected' : ''}>${j}</option>`).join('');
    html = `<div class="task-inline-drop-row">
      <input type="text" class="task-inline-drop-input" data-drop-field="jrnl-text" placeholder="note to journal…" autofocus />
      <select class="task-inline-drop-select" data-drop-field="jrnl-name">${opts}</select>
      <button class="task-inline-drop-btn" data-drop-action="submit-jrnl" data-uuid="${uuid}">add</button>
    </div>`;
  } else if (mode === 'dep') {
    const allTasks = await Tasks.getTasks(activeProfile, { includeDone: false });
    const filtered = allTasks.filter(t => t.uuid !== uuid);
    html = `<div class="task-inline-drop-row">
      <input type="text" class="task-inline-drop-input" data-drop-field="dep-search" placeholder="search tasks…" autofocus />
    </div>
    <div class="task-inline-drop-list" data-drop-field="dep-list">
      ${filtered.slice(0, 20).map(t => `
        <div class="task-inline-drop-list-item" data-dep-uuid="${t.uuid}">
          <span class="task-desc">${esc(t.description)}</span>
          <button class="task-inline-drop-btn" data-drop-action="dep-blocked-by" data-uuid="${uuid}" data-dep="${t.uuid}">← blocked by</button>
          <button class="task-inline-drop-btn" data-drop-action="dep-blocks" data-uuid="${uuid}" data-dep="${t.uuid}">→ blocks</button>
        </div>
      `).join('')}
    </div>`;
  } else if (mode === 'comm') {
    const collections = await Community.listCollections();
    const active = collections.filter(c => !c.archived_at);
    if (active.length === 0) {
      html = `<div class="task-inline-drop-row"><span style="color:var(--muted);font-size:11px">No community collections — create one in Community first.</span></div>`;
    } else {
      const opts = active.map(c => `<option value="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('');
      html = `<div class="task-inline-drop-row">
        <input type="text" class="task-inline-drop-input" data-drop-field="comm-note" placeholder="optional note…" autofocus />
        <select class="task-inline-drop-select" data-drop-field="comm-coll">${opts}</select>
        <button class="task-inline-drop-btn" data-drop-action="submit-comm" data-uuid="${uuid}">→ add</button>
      </div>`;
    }
  }

  drop.innerHTML = html;
  drop.classList.add('open');
  drop.querySelector('input')?.focus();

  // Wire dep search filtering
  if (mode === 'dep') {
    const searchInput = drop.querySelector('[data-drop-field="dep-search"]');
    const allTasks = await Tasks.getTasks(activeProfile, { includeDone: false });
    const filtered = allTasks.filter(t => t.uuid !== uuid);
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      const listEl = drop.querySelector('[data-drop-field="dep-list"]');
      const matches = q ? filtered.filter(t => t.description.toLowerCase().includes(q)) : filtered.slice(0, 20);
      listEl.innerHTML = matches.slice(0, 20).map(t => `
        <div class="task-inline-drop-list-item" data-dep-uuid="${t.uuid}">
          <span class="task-desc">${esc(t.description)}</span>
          <button class="task-inline-drop-btn" data-drop-action="dep-blocked-by" data-uuid="${uuid}" data-dep="${t.uuid}">← blocked by</button>
          <button class="task-inline-drop-btn" data-drop-action="dep-blocks" data-uuid="${uuid}" data-dep="${t.uuid}">→ blocks</button>
        </div>
      `).join('');
    });
  }

  // Enter key submits for annotate/journal/comm
  if (mode === 'annotate' || mode === 'journal' || mode === 'comm') {
    drop.querySelector('input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        drop.querySelector('[data-drop-action]')?.click();
      }
    });
  }
}

async function handleTaskDropAction(btn) {
  const action = btn.dataset.dropAction;
  const uuid = btn.dataset.uuid;
  const drop = btn.closest('.task-inline-drop');

  if (action === 'submit-ann') {
    const text = drop?.querySelector('[data-drop-field="ann-text"]')?.value.trim();
    if (!text) return;
    await Tasks.annotateTask(activeProfile, uuid, text);
    showToast('Annotated');
    closeAllTaskDrops();
    await loadTasks();
  } else if (action === 'submit-jrnl') {
    const text = drop?.querySelector('[data-drop-field="jrnl-text"]')?.value.trim();
    if (!text) return;
    const jname = drop?.querySelector('[data-drop-field="jrnl-name"]')?.value || activeJournal;
    const task = await Tasks.getTask(activeProfile, uuid);
    const body = `${text}\n[task: ${task?.description || uuid}]`;
    await Journal.addEntry(activeProfile, { body, journal: jname });
    await Tasks.annotateTask(activeProfile, uuid, `journaled: ${new Date().toISOString().slice(0, 10)}`);
    showToast(`Added to ${jname}`);
    closeAllTaskDrops();
    await loadTasks();
  } else if (action === 'dep-blocked-by' || action === 'dep-blocks') {
    const depUuid = btn.dataset.dep;
    const task = await Tasks.getTask(activeProfile, uuid);
    if (!task) return;
    const deps = [...(task.depends || [])];
    const direction = action === 'dep-blocked-by' ? 'blocked-by' : 'blocks';
    deps.push({ uuid: depUuid, direction });
    await Tasks.updateTask(activeProfile, uuid, { depends: deps });
    showToast(`Dependency added (${direction})`);
    closeAllTaskDrops();
    await loadTasks();
  } else if (action === 'submit-comm') {
    const drop = btn.closest('.task-inline-drop');
    const collSel = drop?.querySelector('[data-drop-field="comm-coll"]');
    const collId = parseInt(collSel?.value);
    const collName = collSel?.options[collSel.selectedIndex]?.dataset.name || '';
    const note = drop?.querySelector('[data-drop-field="comm-note"]')?.value.trim();
    if (!collId) return;
    const task = await Tasks.getTask(activeProfile, uuid);
    if (!task) return;
    await Community.addEntry(collId, { type: 'task', profile: activeProfile, content: task });
    const today = new Date().toISOString().slice(0, 10);
    const ann = note
      ? `shared to community/${collName} — "${note}" (${today})`
      : `shared to community/${collName} (${today})`;
    await Tasks.annotateTask(activeProfile, uuid, ann);
    showToast(`Added to ${collName}`);
    closeAllTaskDrops();
    await loadTasks();
  }
}

// ── Annotation hover inline drop ──────────────────────────────────────────────

function closeAllAnnDrops() {
  document.querySelectorAll('.ann-inline-drop.open').forEach(d => { d.classList.remove('open'); d.innerHTML = ''; });
}

async function openAnnInlineDrop(btn, action, sourceId, annIdx) {
  closeAllAnnDrops();

  // Get the annotation text from the parent annotation div
  const annDiv = btn.closest('.task-ann, .journal-annotation');
  if (!annDiv) return;
  const textEl = annDiv.querySelector('.task-ann-text, .journal-ann-text');
  const rawText = textEl ? textEl.textContent.replace(/^↳\s*/, '').trim() : '';

  // Find or create the inline drop element after the annotation div
  let drop = annDiv.nextElementSibling;
  if (!drop || !drop.classList.contains('ann-inline-drop')) {
    drop = document.createElement('div');
    drop.className = 'ann-inline-drop';
    annDiv.after(drop);
  }

  let html = '';

  if (action === 'to-journal' || action === 'jrnl-to-journal') {
    const journals = await getJournals(activeProfile);
    const opts = journals.map(j => `<option value="${j}"${j === activeJournal ? ' selected' : ''}>${j}</option>`).join('');
    html = `<input type="text" class="ann-inline-drop-input" data-field="ann-drop-text" value="${esc(rawText)}" />
      <select class="ann-inline-drop-select" data-field="ann-drop-journal">${opts}</select>
      <button class="ann-inline-drop-btn" data-ann-drop-submit="${action}" data-source="${sourceId}" data-idx="${annIdx}">send</button>`;
  } else if (action === 'to-community' || action === 'jrnl-to-community') {
    const collections = await Community.listCollections();
    const active = collections.filter(c => !c.archived_at);
    if (!active.length) {
      html = `<span style="color:var(--muted);font-size:11px">No community collections.</span>`;
    } else {
      const opts = active.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      html = `<input type="text" class="ann-inline-drop-input" data-field="ann-drop-text" value="${esc(rawText)}" />
        <select class="ann-inline-drop-select" data-field="ann-drop-coll">${opts}</select>
        <button class="ann-inline-drop-btn" data-ann-drop-submit="${action}" data-source="${sourceId}" data-idx="${annIdx}">send</button>`;
    }
  } else if (action === 'to-list' || action === 'jrnl-to-list') {
    const lists = await Lists.getLists(activeProfile);
    const opts = lists.map(l => `<option value="${l}"${l === activeList ? ' selected' : ''}>${l}</option>`).join('');
    html = `<input type="text" class="ann-inline-drop-input" data-field="ann-drop-text" value="${esc(rawText)}" />
      <select class="ann-inline-drop-select" data-field="ann-drop-list">${opts}</select>
      <button class="ann-inline-drop-btn" data-ann-drop-submit="${action}" data-source="${sourceId}" data-idx="${annIdx}">send</button>`;
  } else if (action === 'to-task' || action === 'jrnl-to-task') {
    html = `<input type="text" class="ann-inline-drop-input" data-field="ann-drop-text" value="${esc(rawText)}" placeholder="task description…" />
      <button class="ann-inline-drop-btn" data-ann-drop-submit="${action}" data-source="${sourceId}" data-idx="${annIdx}">create</button>`;
  }

  drop.innerHTML = html;
  drop.classList.add('open');
  const input = drop.querySelector('input');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // Enter key submits
  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      drop.querySelector('[data-ann-drop-submit]')?.click();
    }
    if (ev.key === 'Escape') {
      closeAllAnnDrops();
    }
  });

  // Wire submit button
  const submitBtn = drop.querySelector('[data-ann-drop-submit]');
  submitBtn?.addEventListener('click', async () => {
    await handleAnnDropSubmit(drop, submitBtn.dataset.annDropSubmit, submitBtn.dataset.source, parseInt(submitBtn.dataset.idx));
  });
}

async function handleAnnDropSubmit(drop, action, sourceId, annIdx) {
  const text = drop.querySelector('[data-field="ann-drop-text"]')?.value.trim();
  if (!text) return;

  if (action === 'to-journal' || action === 'jrnl-to-journal') {
    const jname = drop.querySelector('[data-field="ann-drop-journal"]')?.value || activeJournal;
    await Journal.addEntry(activeProfile, { body: text, journal: jname });
    showToast(`Added to ${jname}`);
  } else if (action === 'to-community' || action === 'jrnl-to-community') {
    const collId = parseInt(drop.querySelector('[data-field="ann-drop-coll"]')?.value);
    if (!collId) return;
    await Community.addEntry(collId, { type: 'note', profile: activeProfile, content: { text, source: `annotation:${sourceId}` } });
    showToast('Added to community');
  } else if (action === 'to-list' || action === 'jrnl-to-list') {
    const list = drop.querySelector('[data-field="ann-drop-list"]')?.value || 'default';
    await Lists.addItem(activeProfile, text, list);
    showToast(`Added to ${list}`);
  } else if (action === 'to-task' || action === 'jrnl-to-task') {
    await Tasks.addTask(activeProfile, { description: text });
    showToast('Task created');
  }

  closeAllAnnDrops();
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
  document.getElementById('tdr-header-title').textContent = '';
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
  populateProjectDatalist();
}

async function populateProjectDatalist() {
  const projects = await Tasks.getProjects(activeProfile);
  const dl = document.getElementById('tdr-project-datalist');
  if (dl) dl.innerHTML = projects.map(p => `<option value="${esc(p.name)}">`).join('');
}

async function populateUdaDatalist() {
  const keys = await getUdaKeys(activeProfile);
  const dl = document.getElementById('tdr-uda-datalist');
  if (dl) dl.innerHTML = keys.map(k => `<option value="${esc(k)}">`).join('');
}

async function populateUdas(t) {
  const udas = Object.entries(t).filter(([k]) => !TASK_CORE_KEYS.has(k));
  const el = document.getElementById('tdr-uda-list');
  if (!el) return;
  if (udas.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:3px 0">No attributes.</div>';
    return;
  }

  let definitions = [];
  try {
    definitions = await Attributes.getAttributes(activeProfile);
  } catch { /* fallback to empty */ }

  el.innerHTML = udas.map(([k, v]) => {
    const def = definitions.find(d => d.name === k);
    let valueHtml;
    if (def) {
      valueHtml = Render.renderUdaInput(def, v, def.readOnly);
    } else {
      valueHtml = `<input type="text" class="tdr-uda-typed-input" data-uda-key="${esc(k)}" value="${esc(String(v))}" />`;
    }
    return `
      <div class="tdr-uda-row" data-uda-name="${esc(k)}">
        <span class="tdr-uda-key">${esc(k)}</span>
        <span class="tdr-uda-val">${valueHtml}</span>
        <button class="tdr-uda-del" data-tdr-uda-del="${esc(k)}">✗</button>
      </div>
    `;
  }).join('');
}

function populateAnnotations(t) {
  const el = document.getElementById('tdr-annotations');
  if (!el) return;
  const anns = t.annotations || [];
  el.innerHTML = `
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

  // Collect current UDAs (re-read from DOM — type-enforced inputs)
  const udaRows = document.querySelectorAll('.tdr-uda-row');
  const udas = {};
  udaRows.forEach(row => {
    const key = row.querySelector('.tdr-uda-key')?.textContent?.trim();
    if (!key) return;
    // Skip read-only fields
    const readonlySpan = row.querySelector('.tdr-uda-val-readonly');
    if (readonlySpan) return;
    // Check for typed inputs
    const typedInput = row.querySelector('.tdr-uda-typed-input');
    const typedSelect = row.querySelector('.tdr-uda-typed-select');
    if (typedInput) {
      udas[key] = typedInput.value;
    } else if (typedSelect) {
      udas[key] = typedSelect.value;
    } else {
      // Fallback: plain text content
      const val = row.querySelector('.tdr-uda-val')?.textContent?.trim();
      if (val) udas[key] = val;
    }
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

  // Collapsible UDA section toggle
  document.getElementById('tdr-uda-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('tdr-uda-body');
    const caret = document.getElementById('tdr-uda-caret');
    body?.classList.toggle('collapsed');
    caret?.classList.toggle('collapsed');
  });

  // Collapsible Annotations section toggle
  document.getElementById('tdr-ann-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('tdr-ann-body');
    const caret = document.getElementById('tdr-ann-caret');
    body?.classList.toggle('collapsed');
    caret?.classList.toggle('collapsed');
  });

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
    if (!key) { showToast('Enter an attribute key', 'warning'); return; }
    await Tasks.updateTask(activeProfile, _drawerUuid, { [key]: val });
    await addUdaKey(activeProfile, key);
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateUdas(_drawerTask);
    populateUdaDatalist();
    document.getElementById('tdr-uda-key').value = '';
    document.getElementById('tdr-uda-val').value = '';
    showToast(`Attribute "${key}" set`);
  });

  // Delete UDA (delegated)
  document.getElementById('tdr-uda-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tdr-uda-del]');
    if (!btn || !_drawerUuid) return;
    const key = btn.dataset.tdrUdaDel;
    if (!await confirm(`Remove attribute "${key}" from this task?`)) return;
    const patch = { [key]: undefined };
    await Tasks.updateTask(activeProfile, _drawerUuid, patch);
    _drawerTask = await Tasks.getTask(activeProfile, _drawerUuid);
    populateUdas(_drawerTask);
    showToast(`"${key}" removed`);
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
    // Annotation hover action buttons
    const annBtn = e.target.closest('.ann-hover-btn');
    if (annBtn) {
      e.stopPropagation();
      const action = annBtn.dataset.annAction;
      const id = annBtn.dataset.uuid || annBtn.dataset.id;
      const idx = parseInt(annBtn.dataset.idx);
      await openAnnInlineDrop(annBtn, action, id, idx);
      return;
    }
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
  const allTasks = await Tasks.getTasks(activeProfile, { includeDone: true });
  Render.renderTags(sorted, filterText, allTasks);
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

  // Expand/collapse tag bars and click task items
  document.getElementById('tags-body')?.addEventListener('click', async (e) => {
    const header = e.target.closest('[data-action="toggle-tag"]');
    if (header) {
      const bar = header.closest('.tag-bar');
      const tasks = bar?.querySelector('.tag-bar-tasks');
      const caret = bar?.querySelector('.tag-bar-caret');
      tasks?.classList.toggle('hidden');
      if (caret) caret.textContent = tasks?.classList.contains('hidden') ? '▸' : '▾';
      return;
    }
    const taskItem = e.target.closest('[data-uuid]');
    if (taskItem) {
      await showSection('tasks');
      openTaskDrawer(taskItem.dataset.uuid);
    }
  });
}

// ── Attributes ───────────────────────────────────────────────────────────────

let _attrEditMode = null; // null or the name being edited
let _atdName = null; // currently open attribute in drawer

async function loadAttributes() {
  let definitions = await Attributes.getAttributes(activeProfile);
  
  // If no formal definitions exist, discover UDA keys from tasks
  if (definitions.length === 0) {
    const allTasks = await Tasks.getTasks(activeProfile, { includeDone: true });
    const CORE_KEYS = new Set(['uuid','status','description','project','tags','priority','due','scheduled','wait','start','end','depends','annotations','urgency','modified','entry','taskList']);
    const discovered = new Map();
    for (const t of allTasks) {
      for (const [k, v] of Object.entries(t)) {
        if (CORE_KEYS.has(k) || discovered.has(k)) continue;
        const type = typeof v === 'number' ? 'numeric' : 'string';
        discovered.set(k, { name: k, label: k.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), type, defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false, group: 'Discovered from Tasks' });
      }
    }
    if (discovered.size > 0) {
      definitions = [...discovered.values()];
    }
  }
  
  Render.renderAttributes(definitions);
}

async function openAttrDrawer(name) {
  const definitions = await Attributes.getAttributes(activeProfile);
  const def = definitions.find(d => d.name === name);
  if (!def) return;
  _atdName = name;
  document.getElementById('attr-drawer-title').textContent = def.label || def.name;
  document.getElementById('atd-name').value = def.name;
  document.getElementById('atd-label').value = def.label || '';
  document.getElementById('atd-type').value = def.type;
  document.getElementById('atd-default').value = def.defaultValue || '';
  document.getElementById('atd-allowed').value = (def.allowedValues || []).join(', ');
  document.getElementById('atd-group').value = def.group || '';
  document.getElementById('atd-urgency').value = def.urgencyCoefficient || 0;
  document.getElementById('atd-readonly').checked = def.readOnly || false;
  const drawer = document.getElementById('attr-drawer');
  if (drawer) { drawer.classList.remove('hidden'); drawer.setAttribute('aria-hidden', 'false'); }

  // Populate tasks that have this attribute, grouped by subprofile (task list)
  await populateAttrDrawerTasks(name);
}

function closeAttrDrawer() {
  const drawer = document.getElementById('attr-drawer');
  if (drawer) { drawer.classList.add('hidden'); drawer.setAttribute('aria-hidden', 'true'); }
  _atdName = null;
}

async function populateAttrDrawerTasks(attrName) {
  const container = document.getElementById('atd-tasks-container');
  if (!container) return;

  // Get all tasks across all task lists (subprofiles) in the current profile
  const allTasks = await Tasks.getTasks(activeProfile, { includeDone: false, taskList: null });
  const taskLists = await getTaskLists(activeProfile);

  // Filter tasks that have this attribute
  const tasksWithAttr = allTasks.filter(t => t[attrName] !== undefined && t[attrName] !== null && t[attrName] !== '');

  if (tasksWithAttr.length === 0) {
    container.innerHTML = `<div class="atd-tasks-header">TASKS WITH THIS ATTRIBUTE</div><div class="atd-no-tasks">No tasks use this attribute.</div>`;
    return;
  }

  // Group by task list (subprofile)
  const grouped = new Map();
  for (const t of tasksWithAttr) {
    const list = t.taskList || 'main';
    if (!grouped.has(list)) grouped.set(list, []);
    grouped.get(list).push(t);
  }

  let html = `<div class="atd-tasks-header">TASKS WITH THIS ATTRIBUTE <span style="font-size:10px;color:var(--muted)">(${tasksWithAttr.length})</span></div>`;

  for (const [listName, tasks] of grouped) {
    html += `
      <div class="atd-subprofile-group" data-atd-subprofile="${esc(listName)}">
        <div class="atd-subprofile-header" data-action="toggle-atd-subprofile">
          <span class="atd-subprofile-caret">▾</span>
          <span class="atd-subprofile-name">${esc(listName)}</span>
          <span class="atd-subprofile-count">${tasks.length}</span>
        </div>
        <div class="atd-subprofile-tasks">
          ${tasks.map(t => `
            <div class="atd-task-item">
              <span class="atd-task-desc">${esc(t.description)}</span>
              <span class="atd-task-val">${esc(String(t[attrName]))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Wire collapse toggles for subprofile groups
  container.querySelectorAll('[data-action="toggle-atd-subprofile"]').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.closest('.atd-subprofile-group');
      const tasks = group?.querySelector('.atd-subprofile-tasks');
      const caret = header.querySelector('.atd-subprofile-caret');
      tasks?.classList.toggle('collapsed');
      caret?.classList.toggle('collapsed');
    });
  });
}

let _packName = null; // currently open template pack in drawer

function openPackDrawer(packName) {
  const pack = Attributes.TEMPLATE_PACKS[packName];
  if (!pack) return;
  _packName = packName;
  document.getElementById('attr-pack-title').textContent = pack.label;
  document.getElementById('attr-pack-desc').textContent = pack.description;
  const itemsEl = document.getElementById('attr-pack-items');
  if (itemsEl) {
    itemsEl.innerHTML = pack.definitions.map(d => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:500;min-width:120px">${esc(d.name)}</span>
        <span style="color:var(--muted);font-size:11px">${esc(d.type)}</span>
        ${d.label ? `<span style="color:var(--muted);font-size:11px">— ${esc(d.label)}</span>` : ''}
        ${d.urgencyCoefficient ? `<span style="color:var(--warning);font-size:11px">⚡${d.urgencyCoefficient}</span>` : ''}
      </div>
    `).join('');
  }
  // Reset edit form state
  document.getElementById('attr-pack-edit-form')?.classList.add('hidden');
  document.getElementById('attr-pack-edit-warning')?.classList.add('hidden');
  const drawer = document.getElementById('attr-pack-drawer');
  if (drawer) { drawer.classList.remove('hidden'); drawer.setAttribute('aria-hidden', 'false'); }
}

function closePackDrawer() {
  const drawer = document.getElementById('attr-pack-drawer');
  if (drawer) { drawer.classList.add('hidden'); drawer.setAttribute('aria-hidden', 'true'); }
  _packName = null;
}

function wireAttributesSection() {
  // Add Attribute button — show/hide form
  document.getElementById('btn-add-attr')?.addEventListener('click', () => {
    _attrEditMode = null;
    const form = document.getElementById('attr-add-form');
    if (form) {
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) clearAttrForm();
    }
  });

  // Cancel button
  document.getElementById('btn-attr-cancel')?.addEventListener('click', () => {
    _attrEditMode = null;
    document.getElementById('attr-add-form')?.classList.add('hidden');
    clearAttrForm();
  });

  // Save button
  document.getElementById('btn-attr-save')?.addEventListener('click', async () => {
    const name = document.getElementById('attr-name')?.value.trim();
    const label = document.getElementById('attr-label')?.value.trim();
    const type = document.getElementById('attr-type')?.value || 'string';
    const defaultValue = document.getElementById('attr-default')?.value.trim();
    const allowedRaw = document.getElementById('attr-allowed')?.value.trim();
    const urgencyCoefficient = parseFloat(document.getElementById('attr-urgency')?.value) || 0;
    const readOnly = document.getElementById('attr-readonly')?.checked || false;

    if (!name) { showToast('Name is required', 'warning'); return; }

    const allowedValues = allowedRaw ? allowedRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    try {
      if (_attrEditMode) {
        await Attributes.updateAttribute(activeProfile, _attrEditMode, { name, label, type, defaultValue, allowedValues, urgencyCoefficient, readOnly });
        showToast(`Attribute "${name}" updated`);
      } else {
        await Attributes.addAttribute(activeProfile, { name, label, type, defaultValue, allowedValues, urgencyCoefficient, readOnly });
        showToast(`Attribute "${name}" added`);
      }
      _attrEditMode = null;
      document.getElementById('attr-add-form')?.classList.add('hidden');
      clearAttrForm();
      await loadAttributes();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Import CSV button
  document.getElementById('btn-import-attr-csv')?.addEventListener('click', async () => {
    const csv = await promptText('Paste CSV lines (one attribute per line):');
    if (!csv) return;
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    let imported = 0;
    for (const line of lines) {
      try {
        await Attributes.importAttribute(activeProfile, line);
        imported++;
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    }
    showToast(`Imported ${imported} attribute(s)`);
    await loadAttributes();
  });

  // Export All button
  document.getElementById('btn-export-attr-csv')?.addEventListener('click', async () => {
    const definitions = await Attributes.getAttributes(activeProfile);
    if (definitions.length === 0) { showToast('No attributes to export', 'warning'); return; }
    const csv = definitions.map(d => Attributes.formatAttribute(d)).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attributes_${activeProfile}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported attributes CSV');
  });

  // Edit/Delete buttons on cards (delegated) — opens drawer
  document.getElementById('attr-list')?.addEventListener('click', async (e) => {
    // Duplicate button — opens drawer in duplicate mode
    const dupBtn = e.target.closest('[data-attr-duplicate]');
    if (dupBtn) {
      const name = dupBtn.dataset.attrDuplicate;
      const definitions = await Attributes.getAttributes(activeProfile);
      const def = definitions.find(d => d.name === name);
      if (!def) return;
      // Open drawer pre-filled with this attribute's data but in "new" mode
      _atdName = null; // null = creating new, not editing
      document.getElementById('attr-drawer-title').textContent = `Duplicate: ${def.label || def.name}`;
      document.getElementById('atd-name').value = def.name + '_copy';
      document.getElementById('atd-label').value = def.label || '';
      document.getElementById('atd-type').value = def.type;
      document.getElementById('atd-default').value = def.defaultValue || '';
      document.getElementById('atd-allowed').value = (def.allowedValues || []).join(', ');
      document.getElementById('atd-group').value = '';
      document.getElementById('atd-urgency').value = def.urgencyCoefficient || 0;
      document.getElementById('atd-readonly').checked = def.readOnly || false;
      document.getElementById('attr-drawer')?.classList.remove('hidden');
      document.getElementById('atd-group')?.focus();
      return;
    }

    // Don't open drawer when interacting with dropdown or buttons
    if (e.target.closest('.attr-group-assign') || e.target.closest('[data-attr-duplicate]') || e.target.closest('[data-assign-attr]') || e.target.closest('[data-assign-group]')) return;

    const editBtn = e.target.closest('[data-attr-edit]');
    const card = e.target.closest('.attr-card');
    if (editBtn) {
      openAttrDrawer(editBtn.dataset.attrEdit);
      return;
    }
    if (card && !e.target.closest('[data-attr-delete]')) {
      openAttrDrawer(card.dataset.attrName);
      return;
    }

    const delBtn = e.target.closest('[data-attr-delete]');
    if (delBtn) {
      const name = delBtn.dataset.attrDelete;
      if (!await confirm(`Delete attribute "${name}"?`)) return;
      try {
        await Attributes.removeAttribute(activeProfile, name);
        showToast(`Attribute "${name}" deleted`);
        await loadAttributes();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // Group assignment dropdown
  document.getElementById('attr-list')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('.attr-group-assign');
    if (!sel) return;
    const name = sel.dataset.attrAssign;
    let newGroup = sel.value;
    if (newGroup === '__new__') {
      newGroup = await promptText('New group name:');
      if (!newGroup?.trim()) { await loadAttributes(); return; }
      newGroup = newGroup.trim();
    }
    // Confirm deselection (moving to Ungrouped)
    if (newGroup === 'Ungrouped') {
      if (!await confirm(`Remove "${name}" from its current group?`)) { await loadAttributes(); return; }
      newGroup = '';
    }
    try {
      await Attributes.updateAttribute(activeProfile, name, { group: newGroup });
      showToast(`Moved to "${newGroup || 'Ungrouped'}"`);
      await loadAttributes();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Assign attribute(s) to another profile — popup
  let _assignDefs = []; // definitions to assign

  async function showProfilePopup(defs, label) {
    _assignDefs = defs;
    const profiles = listProfiles();
    const popup = document.getElementById('attr-profile-popup');
    const info = document.getElementById('attr-profile-popup-info');
    const list = document.getElementById('attr-profile-popup-list');
    if (!popup || !list) return;
    info.textContent = label;

    // Check which profiles already have all the attributes
    const defNames = defs.map(d => d.name);
    const items = [];
    for (const p of profiles) {
      const isCurrent = p === activeProfile;
      let alreadyHas = false;
      if (!isCurrent) {
        try {
          const existing = await Attributes.getAttributes(p);
          const existingNames = new Set(existing.map(d => d.name));
          alreadyHas = defNames.every(n => existingNames.has(n));
        } catch { /* ignore */ }
      }
      items.push({ profile: p, isCurrent, alreadyHas });
    }

    list.innerHTML = items.map(({ profile, isCurrent, alreadyHas }) => `
      <label class="attr-profile-popup-item${isCurrent ? ' current' : ''}${alreadyHas ? ' assigned' : ''}">
        <input type="checkbox" value="${esc(profile)}" ${isCurrent ? 'disabled' : ''} ${alreadyHas ? 'checked' : ''} />
        ${esc(profile)} ${isCurrent ? '(current)' : ''}${alreadyHas ? ' ✓' : ''}
      </label>
    `).join('');
    popup.classList.remove('hidden');
  }

  function hideProfilePopup() {
    document.getElementById('attr-profile-popup')?.classList.add('hidden');
    _assignDefs = [];
  }

  // Quick-click on a profile item assigns immediately
  document.getElementById('attr-profile-popup-list')?.addEventListener('click', async (e) => {
    const item = e.target.closest('.attr-profile-popup-item:not(.current)');
    if (!item || e.target.type === 'checkbox') return;
    const checkbox = item.querySelector('input[type="checkbox"]');
    const profile = checkbox?.value;
    if (!profile) return;
    let imported = 0, skipped = 0;
    for (const def of _assignDefs) {
      try { await Attributes.addAttribute(profile, { ...def }); imported++; }
      catch (err) { if (err.message.includes('already exists')) skipped++; }
    }
    showToast(`Assigned ${imported} to ${profile}${skipped ? `, ${skipped} skipped` : ''}`);
    hideProfilePopup();
  });

  // "Assign Selected" button — assigns to checked profiles, removes from unchecked (if previously assigned)
  document.getElementById('btn-attr-profile-assign')?.addEventListener('click', async () => {
    const allItems = document.querySelectorAll('#attr-profile-popup-list .attr-profile-popup-item:not(.current)');
    const toAssign = [];
    const toRemove = [];
    allItems.forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (!cb) return;
      const profile = cb.value;
      const wasAssigned = item.classList.contains('assigned');
      if (cb.checked && !wasAssigned) toAssign.push(profile);
      if (!cb.checked && wasAssigned) toRemove.push(profile);
    });

    if (toAssign.length === 0 && toRemove.length === 0) { showToast('No changes to apply', 'warning'); return; }

    // Confirm removals
    if (toRemove.length > 0) {
      if (!await confirm(`Remove attributes from ${toRemove.length} profile(s)? (${toRemove.join(', ')})`)) return;
    }

    let totalImported = 0, totalSkipped = 0, totalRemoved = 0;
    // Assign
    for (const profile of toAssign) {
      for (const def of _assignDefs) {
        try { await Attributes.addAttribute(profile, { ...def }); totalImported++; }
        catch (err) { if (err.message.includes('already exists')) totalSkipped++; }
      }
    }
    // Remove
    for (const profile of toRemove) {
      for (const def of _assignDefs) {
        try { await Attributes.removeAttribute(profile, def.name); totalRemoved++; }
        catch (err) { /* ignore not found */ }
      }
    }

    const parts = [];
    if (totalImported) parts.push(`${totalImported} assigned`);
    if (totalRemoved) parts.push(`${totalRemoved} removed`);
    if (totalSkipped) parts.push(`${totalSkipped} skipped`);
    showToast(parts.join(', ') || 'Done');
    hideProfilePopup();
  });

  document.getElementById('btn-attr-profile-cancel')?.addEventListener('click', hideProfilePopup);
  document.getElementById('attr-profile-popup')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideProfilePopup();
  });

  document.getElementById('attr-list')?.addEventListener('click', async (e) => {
    // Single attribute assign
    const attrBtn = e.target.closest('[data-assign-attr]');
    if (attrBtn) {
      e.stopPropagation();
      const name = attrBtn.dataset.assignAttr;
      const definitions = await Attributes.getAttributes(activeProfile);
      const def = definitions.find(d => d.name === name);
      if (!def) return;
      showProfilePopup([def], `Assign "${def.label || def.name}"`);
      return;
    }
    // Group assign
    const groupBtn = e.target.closest('[data-assign-group]');
    if (groupBtn) {
      e.stopPropagation();
      const groupName = groupBtn.dataset.assignGroup;
      const definitions = await Attributes.getAttributes(activeProfile);
      const groupDefs = definitions.filter(d => (d.group || 'Ungrouped') === groupName);
      if (groupDefs.length === 0) return;
      showProfilePopup(groupDefs, `Assign group "${groupName}" (${groupDefs.length} attributes)`);
      return;
    }
  });

  // Attribute detail drawer — close handlers
  document.getElementById('attr-drawer-backdrop')?.addEventListener('click', closeAttrDrawer);
  document.getElementById('attr-drawer-close')?.addEventListener('click', closeAttrDrawer);

  // Attribute detail drawer — save
  document.getElementById('btn-atd-save')?.addEventListener('click', async () => {
    const name = document.getElementById('atd-name')?.value.trim();
    const label = document.getElementById('atd-label')?.value.trim();
    const type = document.getElementById('atd-type')?.value || 'string';
    const defaultValue = document.getElementById('atd-default')?.value.trim();
    const allowedRaw = document.getElementById('atd-allowed')?.value.trim();
    const group = document.getElementById('atd-group')?.value.trim();
    const urgencyCoefficient = parseFloat(document.getElementById('atd-urgency')?.value) || 0;
    const readOnly = document.getElementById('atd-readonly')?.checked || false;
    const allowedValues = allowedRaw ? allowedRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    try {
      if (_atdName) {
        // Edit mode
        await Attributes.updateAttribute(activeProfile, _atdName, { name, label, type, defaultValue, allowedValues, group, urgencyCoefficient, readOnly });
        showToast(`Attribute "${name}" updated`);
      } else {
        // Create/duplicate mode
        if (!name) { showToast('Name is required', 'warning'); return; }
        await Attributes.addAttribute(activeProfile, { name, label, type, defaultValue, allowedValues, group, urgencyCoefficient, readOnly });
        showToast(`Attribute "${name}" created`);
      }
      closeAttrDrawer();
      await loadAttributes();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Attribute detail drawer — delete
  document.getElementById('btn-atd-delete')?.addEventListener('click', async () => {
    if (!_atdName) { closeAttrDrawer(); return; }
    if (!await confirm(`Delete attribute "${_atdName}"?`)) return;
    try {
      await Attributes.removeAttribute(activeProfile, _atdName);
      showToast(`Attribute "${_atdName}" deleted`);
      closeAttrDrawer();
      await loadAttributes();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Urgency help icon
  document.getElementById('btn-attr-urgency-help')?.addEventListener('click', () => {
    document.getElementById('attr-urgency-overlay')?.classList.remove('hidden');
  });

  // Close urgency overlay
  document.getElementById('btn-attr-urgency-close')?.addEventListener('click', () => {
    document.getElementById('attr-urgency-overlay')?.classList.add('hidden');
  });

  // Main help overlay
  document.getElementById('btn-attr-help')?.addEventListener('click', () => {
    document.getElementById('attr-help-overlay')?.classList.remove('hidden');
  });
  document.getElementById('btn-attr-help-close')?.addEventListener('click', () => {
    document.getElementById('attr-help-overlay')?.classList.add('hidden');
  });
  document.getElementById('attr-help-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('attr-help-overlay')?.classList.add('hidden');
  });

  // Tab switching
  document.querySelectorAll('.attr-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.attr-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.attrView;
      document.getElementById('attr-view-current')?.classList.toggle('hidden', view !== 'current');
      document.getElementById('attr-view-templates')?.classList.toggle('hidden', view !== 'templates');
      if (view === 'templates') {
        const packs = Attributes.listTemplatePacks();
        const list = document.getElementById('attr-templates-list');
        if (list) {
          list.innerHTML = packs.filter(p => p.count > 0).map(p => `
            <div class="attr-template-card" data-pack-view="${esc(p.name)}" style="cursor:pointer">
              <div class="attr-template-info">
                <span class="attr-template-name">${esc(p.label)}</span>
                <span class="attr-template-desc">${esc(p.description)}</span>
                <span class="attr-template-count">${p.count} attributes · <span style="color:var(--accent)">▸ View</span></span>
              </div>
              <button class="btn-inline-alt attr-template-import-btn" data-pack="${esc(p.name)}">Import</button>
            </div>
          `).join('');
        }
      }
    });
  });

  // Import a template pack (Import button only)
  document.getElementById('attr-templates-list')?.addEventListener('click', async (e) => {
    // Import button
    const importBtn = e.target.closest('.attr-template-import-btn[data-pack]');
    if (importBtn) {
      e.stopPropagation();
      const packName = importBtn.dataset.pack;
      try {
        const { imported, skipped } = await Attributes.importTemplatePack(activeProfile, packName);
        showToast(`Imported ${imported} attribute(s)${skipped ? `, ${skipped} skipped (already exist)` : ''}`);
        // Switch to current view to show imported
        document.querySelectorAll('.attr-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.attr-tab[data-attr-view="current"]')?.classList.add('active');
        document.getElementById('attr-view-current')?.classList.remove('hidden');
        document.getElementById('attr-view-templates')?.classList.add('hidden');
        await loadAttributes();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    // Clicking the card itself opens the pack drawer
    const card = e.target.closest('[data-pack-view]');
    if (card) {
      openPackDrawer(card.dataset.packView);
    }
  });

  // Template pack drawer — close handlers
  document.getElementById('attr-pack-backdrop')?.addEventListener('click', closePackDrawer);
  document.getElementById('attr-pack-close')?.addEventListener('click', closePackDrawer);

  // Template pack drawer — edit button
  document.getElementById('btn-pack-edit')?.addEventListener('click', () => {
    document.getElementById('attr-pack-edit-warning')?.classList.remove('hidden');
    const editForm = document.getElementById('attr-pack-edit-form');
    if (editForm) editForm.classList.remove('hidden');
    // Populate textarea with CSV of all definitions
    if (_packName) {
      const pack = Attributes.TEMPLATE_PACKS[_packName];
      if (pack) {
        const csv = pack.definitions.map(d => Attributes.formatAttribute(d)).join('\n');
        const ta = document.getElementById('attr-pack-csv');
        if (ta) ta.value = csv;
      }
    }
  });

  // Template pack drawer — save edits
  document.getElementById('btn-pack-save-edits')?.addEventListener('click', async () => {
    if (!_packName) return;
    const csv = document.getElementById('attr-pack-csv')?.value || '';
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    const definitions = [];
    for (const line of lines) {
      const fields = line.split(',').map(f => f.trim());
      const name = fields[0] || '';
      if (!name) continue;
      definitions.push({
        name,
        label: fields[1] || '',
        type: fields[2] || 'string',
        defaultValue: fields[3] || '',
        allowedValues: fields[4] ? fields[4].split('|').map(s => s.trim()).filter(Boolean) : [],
        urgencyCoefficient: fields[5] ? parseFloat(fields[5]) : 0,
        readOnly: fields[6] === 'true',
      });
    }
    try {
      await Attributes.saveCustomPack(activeProfile, _packName, definitions);
      showToast(`Template pack "${_packName}" saved`);
      closePackDrawer();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Template pack drawer — cancel edits
  document.getElementById('btn-pack-cancel-edits')?.addEventListener('click', () => {
    document.getElementById('attr-pack-edit-form')?.classList.add('hidden');
    document.getElementById('attr-pack-edit-warning')?.classList.add('hidden');
  });

  // Group collapse/expand
  document.getElementById('attr-list')?.addEventListener('click', (e) => {
    const header = e.target.closest('[data-action="toggle-attr-group"]');
    if (header) {
      const group = header.closest('.attr-group');
      group?.classList.toggle('collapsed');
      const caret = header.querySelector('.attr-group-caret');
      if (caret) caret.textContent = group?.classList.contains('collapsed') ? '▸' : '▾';
    }
  });

  // Search filter
  document.getElementById('attr-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#attr-list .attr-card').forEach(card => {
      const name = card.dataset.attrName || '';
      const text = card.textContent.toLowerCase();
      card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
    // Show groups that have visible cards, hide empty ones
    document.querySelectorAll('#attr-list .attr-group').forEach(group => {
      const visible = group.querySelectorAll('.attr-card:not([style*="display: none"])');
      group.style.display = visible.length > 0 || !q ? '' : 'none';
    });
  });

  // ── Group Builder ─────────────────────────────────────────────
  let _gbMode = 'quick';
  let _gbItems = [];

  function openGroupBuilder() {
    _gbItems = [];
    _gbMode = 'quick';
    document.getElementById('attr-gb-group-name').value = '';
    document.getElementById('attr-gb-quick-name').value = '';
    document.getElementById('attr-gb-count').textContent = '0 added';
    document.getElementById('attr-gb-list').innerHTML = '';
    document.getElementById('attr-gb-quick')?.classList.remove('hidden');
    document.getElementById('attr-gb-detailed')?.classList.add('hidden');
    document.querySelectorAll('.attr-gb-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.gbMode === 'quick'));
    document.getElementById('attr-group-builder')?.classList.remove('hidden');
    document.getElementById('attr-gb-group-name')?.focus();
  }

  function closeGroupBuilder() {
    document.getElementById('attr-group-builder')?.classList.add('hidden');
    _gbItems = [];
  }

  function renderGbList() {
    const el = document.getElementById('attr-gb-list');
    if (!el) return;
    el.innerHTML = _gbItems.map((item, i) => `
      <div class="attr-gb-item">
        <span class="attr-gb-item-name">${esc(item.name)}</span>
        <span class="attr-gb-item-type">${esc(item.type)}</span>
        <button class="attr-gb-item-remove" data-gb-remove="${i}">✗</button>
      </div>
    `).join('');
    document.getElementById('attr-gb-count').textContent = `${_gbItems.length} added`;
  }

  function addGbItem() {
    if (_gbMode === 'quick') {
      const nameEl = document.getElementById('attr-gb-quick-name');
      const name = nameEl?.value.trim();
      if (!name) return;
      const label = name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      _gbItems.push({ name, label, type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false });
      nameEl.value = '';
      nameEl.focus();
    } else {
      const name = document.getElementById('attr-gb-d-name')?.value.trim();
      if (!name) return;
      _gbItems.push({
        name,
        label: document.getElementById('attr-gb-d-label')?.value.trim() || '',
        type: document.getElementById('attr-gb-d-type')?.value || 'string',
        defaultValue: document.getElementById('attr-gb-d-default')?.value.trim() || '',
        allowedValues: (document.getElementById('attr-gb-d-allowed')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
        urgencyCoefficient: parseFloat(document.getElementById('attr-gb-d-urgency')?.value) || 0,
        readOnly: document.getElementById('attr-gb-d-readonly')?.checked || false,
      });
      // Clear detailed form
      ['attr-gb-d-name','attr-gb-d-label','attr-gb-d-default','attr-gb-d-allowed'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('attr-gb-d-type').value = 'string';
      document.getElementById('attr-gb-d-urgency').value = '0';
      document.getElementById('attr-gb-d-readonly').checked = false;
      document.getElementById('attr-gb-d-name')?.focus();
    }
    renderGbList();
  }

  document.getElementById('btn-build-group')?.addEventListener('click', openGroupBuilder);
  document.getElementById('attr-gb-backdrop')?.addEventListener('click', closeGroupBuilder);
  document.getElementById('attr-gb-close')?.addEventListener('click', closeGroupBuilder);

  // Mode toggle
  document.querySelectorAll('.attr-gb-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _gbMode = btn.dataset.gbMode;
      document.querySelectorAll('.attr-gb-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.gbMode === _gbMode));
      document.getElementById('attr-gb-quick')?.classList.toggle('hidden', _gbMode !== 'quick');
      document.getElementById('attr-gb-detailed')?.classList.toggle('hidden', _gbMode !== 'detailed');
    });
  });

  // Add Next button
  document.getElementById('btn-gb-add-next')?.addEventListener('click', addGbItem);

  // Enter in quick mode adds item
  document.getElementById('attr-gb-quick-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGbItem(); }
  });

  // Enter in detailed mode name field adds item
  document.getElementById('attr-gb-d-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGbItem(); }
  });

  // Remove item from list
  document.getElementById('attr-gb-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gb-remove]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.gbRemove);
    _gbItems.splice(idx, 1);
    renderGbList();
  });

  // Save & Close
  document.getElementById('btn-gb-save-close')?.addEventListener('click', async () => {
    const groupName = document.getElementById('attr-gb-group-name')?.value.trim();
    if (!groupName) { showToast('Enter a group name', 'warning'); return; }
    if (_gbItems.length === 0) { showToast('Add at least one attribute', 'warning'); return; }
    let imported = 0, skipped = 0;
    for (const item of _gbItems) {
      try {
        await Attributes.addAttribute(activeProfile, { ...item, group: groupName });
        imported++;
      } catch (err) {
        if (err.message.includes('already exists')) skipped++;
        else showToast(err.message, 'error');
      }
    }
    showToast(`Group "${groupName}" created with ${imported} attribute(s)${skipped ? `, ${skipped} skipped` : ''}`);
    closeGroupBuilder();
    await loadAttributes();
  });
}

function clearAttrForm() {
  const ids = ['attr-name', 'attr-label', 'attr-default', 'attr-allowed'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const typeEl = document.getElementById('attr-type');
  if (typeEl) typeEl.value = 'string';
  const urgEl = document.getElementById('attr-urgency');
  if (urgEl) urgEl.value = '0';
  const roEl = document.getElementById('attr-readonly');
  if (roEl) roEl.checked = false;
}

// ── Projects ─────────────────────────────────────────────────────────────────

async function loadProjects() {
  const projects = await Tasks.getProjects(activeProfile);
  const allTasks = await Tasks.getTasks(activeProfile, { includeDone: true });
  const journalEntries = await Journal.getEntries(activeProfile, { showArchived: false, limit: 500 });
  const ledgerTxns = await Ledger.getTransactions(activeProfile, { limit: 500 });
  const timeIntervals = await Time.getIntervals(activeProfile, {});
  Render.renderProjects(projects, filterText, { allTasks, journalEntries, ledgerTxns, timeIntervals });
}

function wireProjectsSection() {
  document.getElementById('project-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name')?.trim();
    if (!name) return;
    showToast(`Project "${name}" defined — add tasks with this project name`);
    e.currentTarget.reset();
    await loadProjects();
  });

  document.getElementById('project-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    loadProjects();
  });

  // Expand/collapse project cards and click task items
  document.getElementById('projects-body')?.addEventListener('click', async (e) => {
    const header = e.target.closest('[data-action="toggle-project"]');
    if (header) {
      const card = header.closest('.project-card');
      const body = card?.querySelector('.project-card-body');
      const caret = card?.querySelector('.project-card-caret');
      body?.classList.toggle('hidden');
      if (caret) caret.textContent = body?.classList.contains('hidden') ? '▸' : '▾';
      return;
    }

    // Open task drawer
    const taskAction = e.target.closest('[data-action="project-open-task"]');
    if (taskAction) {
      const uuid = taskAction.dataset.uuid;
      if (uuid) { await showSection('tasks'); openTaskDrawer(uuid); }
      return;
    }

    // Open journal drawer
    const journalAction = e.target.closest('[data-action="project-open-journal"]');
    if (journalAction) {
      const id = parseInt(journalAction.dataset.id);
      if (id) { await showSection('journal'); openJournalDrawer(id); }
      return;
    }

    // Open ledger drawer
    const ledgerAction = e.target.closest('[data-action="project-open-ledger"]');
    if (ledgerAction) {
      const id = parseInt(ledgerAction.dataset.id);
      if (id) { await showSection('ledger'); openLedgerDrawer(id); }
      return;
    }

    // Open time drawer
    const timeAction = e.target.closest('[data-action="project-open-time"]');
    if (timeAction) {
      const id = parseInt(timeAction.dataset.id);
      if (id) { await showSection('time'); openTimeDrawer(id); }
      return;
    }

    // Fallback: legacy data-uuid click
    const taskItem = e.target.closest('[data-uuid]');
    if (taskItem) {
      await showSection('tasks');
      openTaskDrawer(taskItem.dataset.uuid);
    }
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
  // Task 33: Shutdown stream before switching
  try {
    await Stream.shutdown();
  } catch { /* best-effort */ }

  activeProfile = name;
  setActive(name);
  notifyProfileChange(name);
  activeJournal = 'main';
  activeLedger  = 'main';
  bulkSelected.clear();

  // Task 33: Re-initialize stream for new profile
  try {
    await Stream.init(name);
    const streamConfig = await Stream.getConfig(name);
    const wrapped = streamRegisterAll(name, {
      tasks: _Tasks, time: _Time, journal: _Journal, ledger: _Ledger,
      lists: _Lists, questions: _Questions, community: _Community, attributes: _Attributes,
    }, { gapThreshold: streamConfig.gap_threshold || 300 });
    if (wrapped.tasks) Tasks = wrapped.tasks;
    if (wrapped.time) Time = wrapped.time;
    if (wrapped.journal) Journal = wrapped.journal;
    if (wrapped.ledger) Ledger = wrapped.ledger;
    if (wrapped.lists) Lists = wrapped.lists;
    if (wrapped.questions) Questions = wrapped.questions;
    if (wrapped.community) Community = wrapped.community;
    if (wrapped.attributes) Attributes = wrapped.attributes;
    updateStreamUI();
  } catch (err) {
    console.warn('[Stream] Profile switch init skipped:', err.message);
  }

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
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      document.getElementById('sidebar-peek')?.classList.add('hidden');
    } else {
      sidebar?.classList.add('collapsed');
      document.getElementById('sidebar-peek')?.classList.remove('hidden');
    }
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
  document.getElementById('btn-nav-next')?.addEventListener('click', () => showSection('next'));
  document.getElementById('warrior-stats')?.addEventListener('click', () => showSection('warrior'));

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

  // ── Header sync controls ────────────────────────────────────
  // Lock button — prevents sub-list switching when navigating between functions
  document.getElementById('btn-lock-functions')?.addEventListener('click', () => {
    functionsLocked = !functionsLocked;
    document.getElementById('btn-lock-functions')?.classList.toggle('active', functionsLocked);
    showToast(functionsLocked ? 'Functions locked' : 'Functions unlocked');
  });

  // Sync button — sets all function sub-lists to match the current one
  document.getElementById('btn-sync-functions')?.addEventListener('click', async () => {
    // Determine current sub-list name from whichever function is active
    let currentName = activeTaskList;
    if (activeSection === 'time') currentName = activeTimeLog;
    else if (activeSection === 'journal') currentName = activeJournal;

    if (!currentName || currentName === 'main') {
      showToast('Switch to a named sub-list first', 'warning');
      return;
    }

    // Sync all function sub-lists to this name
    activeTaskList = currentName;
    activeTimeLog = currentName;
    activeJournal = currentName;
    // activeLedger stays as-is (ledger doesn't have matching sub-lists typically)
    showToast(`All functions synced to "${currentName}"`);
    await loadSection(activeSection);
  });

  // Create sub-profile — creates a named list across all 5 functions
  document.getElementById('btn-create-subprofile')?.addEventListener('click', async () => {
    const name = await promptText('Sub-profile name (creates task list + journal + time log + ledger + list):');
    if (!name?.trim()) return;
    const clean = name.trim().toLowerCase().replace(/\s+/g, '_');

    // Create across all functions
    await addTaskList(activeProfile, clean);
    await addJournal(activeProfile, clean);
    await addTimeLog(activeProfile, clean);
    await addLedger(activeProfile, clean);
    // Lists are implicit (items have a list field)

    // Switch to the new sub-profile
    activeTaskList = clean;
    activeTimeLog = clean;
    activeJournal = clean;
    activeLedger = clean;

    showToast(`Sub-profile "${clean}" created across all functions`);
    await loadSection(activeSection);
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

// ── Welcome overlay ──────────────────────────────────────────────────────────

function wireWelcome() {
  // Show welcome if user hasn't dismissed it before
  if (!localStorage.getItem('ww_welcome_dismissed')) {
    document.getElementById('ww-welcome-overlay')?.classList.remove('hidden');
  }

  document.getElementById('btn-welcome-demo')?.addEventListener('click', async () => {
    document.getElementById('ww-welcome-overlay')?.classList.add('hidden');
    localStorage.setItem('ww_welcome_dismissed', '1');
    // Switch to demo profile and load demo data if not already loaded
    if (activeProfile !== 'demo') {
      try { await createProfile('demo'); } catch { /* may already exist */ }
      await switchProfile('demo');
    }
    if (!localStorage.getItem('ww_demo_loaded')) {
      showToast('Loading demo data…');
      await loadDemoData('demo');
      localStorage.setItem('ww_demo_loaded', '1');
      activeTaskList = 'web_developer';
      await showSection('tasks');
      // Ensure the select reflects the active list and glow it
      const sel = document.getElementById('task-list-select');
      if (sel) {
        sel.value = 'web_developer';
        sel.classList.add('glow-highlight');
        setTimeout(() => sel.classList.remove('glow-highlight'), 3000);
      }
      showToast('Demo loaded — explore!');
    } else {
      // Repair: ensure community collections have content (fixes earlier incomplete loads)
      try {
        const comm = await import('./services/community/index.js');
        const colls = await comm.listCollections();
        const webDevColl = colls.find(c => c.name === 'web_developer');
        const pmColl = colls.find(c => c.name === 'project_manager');
        let needsRepair = false;
        if (!webDevColl || !pmColl) needsRepair = true;
        else {
          const webEntries = await comm.getEntries(webDevColl.id);
          const pmEntries = await comm.getEntries(pmColl.id);
          if (webEntries.length === 0 && pmEntries.length === 0) needsRepair = true;
        }
        if (needsRepair) {
          await loadDemoData('demo');
        }
      } catch { /* silent */ }
    }
  });

  document.getElementById('btn-welcome-start')?.addEventListener('click', () => {
    document.getElementById('ww-welcome-overlay')?.classList.add('hidden');
    localStorage.setItem('ww_welcome_dismissed', '1');
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
    if (btn) {
      if (btn.dataset.action === 'start') await Tasks.startTask(activeProfile, btn.dataset.uuid);
      if (btn.dataset.action === 'done')  await Tasks.completeTask(activeProfile, btn.dataset.uuid);
      showToast('Done');
      await loadNext();
      return;
    }
    const row = e.target.closest('[data-uuid]');
    if (!row) return;
    await showSection('tasks');
    openTaskDrawer(row.dataset.uuid);
  });
  document.getElementById('next-upcoming')?.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-uuid]');
    if (!row) return;
    await showSection('tasks');
    openTaskDrawer(row.dataset.uuid);
  });
  document.getElementById('next-overdue')?.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-uuid]');
    if (!row) return;
    await showSection('tasks');
    openTaskDrawer(row.dataset.uuid);
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

  // Task 32: Set warrior stream toggle state
  try {
    const streamEnabled = await Stream.isEnabled(activeProfile);
    const toggle = document.getElementById('warrior-stream-toggle');
    const statusEl = document.getElementById('warrior-stream-status');
    if (toggle) toggle.checked = streamEnabled;
    if (statusEl) statusEl.textContent = streamEnabled ? 'on' : 'off';
  } catch { /* non-critical */ }
}

function statChip(label, value, color) {
  return `<span style="font-size:12px;padding:4px 10px;border:1px solid ${color};border-radius:4px;color:${color}">${value} ${label}</span>`;
}

function wireWarriorSection() {
  document.getElementById('warrior-profiles')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="switch-to"]');
    if (btn) await switchProfile(btn.dataset.profile);
  });

  // Task 32: Wire warrior stream toggle
  document.getElementById('warrior-stream-toggle')?.addEventListener('change', async (e) => {
    const checked = e.target.checked;
    await Stream.toggle(activeProfile, checked);
    const statusEl = document.getElementById('warrior-stream-status');
    if (statusEl) statusEl.textContent = checked ? 'on' : 'off';
    updateStreamUI();
  });
}

// ── Community ─────────────────────────────────────────────────────────────────

let activeCommunity = null;
let communityView   = 'unified';
let communitySearch = '';
let _commSelectedId = null;
let _commLedgerExpanded = false;
let _commLastUnit = '$';
let _commStagedLedger = new Map(); // entryId → [{acct1, amt1, unit1, acct2, amt2, unit2, desc, ledger}]
let _commLedgerDouble = true;

async function loadCommunity() {
  const collections = await Community.listCollections();
  const active = collections.filter(c => !c.archived_at);

  if (!activeCommunity && active.length > 0) activeCommunity = active[0].id;

  // Populate header selector
  const headerSel = document.getElementById('community-header-select');
  if (headerSel) {
    headerSel.innerHTML = active.length === 0
      ? '<option value="">no collections</option>'
      : active.map(c => `<option value="${c.id}" ${c.id === activeCommunity ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
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

  // Highlight selected entry
  if (_commSelectedId) {
    body.querySelector(`.comm-entry[data-comm-id="${_commSelectedId}"]`)?.classList.add('comm-entry-active');
  }
}

async function renderCommDetailPanel(entryId) {
  const panel = document.getElementById('comm-detail-panel');
  if (!panel) return;
  if (!entryId || !activeCommunity) {
    panel.classList.add('comm-right-hidden');
    _commSelectedId = null;
    return;
  }

  const entries = await Community.getEntries(activeCommunity, { view: 'unified' });
  const e = entries.find(x => x.id === entryId);
  if (!e) { panel.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Entry not found</div>'; return; }

  _commSelectedId = entryId;
  panel.classList.remove('comm-right-hidden');
  const c = e.content || {};
  const ts = fmtShortDate(e.added_at);

  // Build full content based on type
  let titleHtml = '';
  let bodyHtml = '';
  let metaHtml = '';

  if (e.type === 'task') {
    titleHtml = esc(c.description || '(task)');
    const tags = (c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`).join(' ');
    const project = c.project ? `<span class="task-project-badge">${esc(c.project)}</span>` : '';
    const pri = c.priority ? `<span class="comm-status-badge">${esc(c.priority)}</span>` : '';
    const status = c.status ? `<span class="comm-status-badge">${esc(c.status)}</span>` : '';
    metaHtml = `${project} ${pri} ${status} ${tags}`;
    // Show annotations from the task snapshot
    const anns = (c.annotations || []);
    if (anns.length > 0) {
      bodyHtml = anns.map(a => `<div style="font-size:11px;color:var(--muted);border-left:2px solid var(--border);padding-left:8px;margin:3px 0">↳ ${esc(a.description || a.text || '')}</div>`).join('');
    }
  } else if (e.type === 'journal') {
    titleHtml = 'Journal Entry';
    bodyHtml = esc(c.body || '');
    const tags = (c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`).join(' ');
    const project = c.project ? `<span class="task-project-badge">${esc(c.project)}</span>` : '';
    metaHtml = `${project} ${tags}`;
  } else if (e.type === 'ledger') {
    titleHtml = esc(c.description || '(transaction)');
    bodyHtml = c.date ? `<span style="color:var(--muted)">${esc(c.date)}</span>` : '';
  } else if (e.type === 'time') {
    titleHtml = (c.tags || []).join(', ') || 'untagged';
    bodyHtml = c.annotation ? esc(c.annotation) : '';
  } else if (e.type === 'note') {
    titleHtml = 'Note';
    bodyHtml = esc(c.text || '');
  } else {
    titleHtml = esc(e.type || 'Entry');
    bodyHtml = esc(JSON.stringify(c, null, 2));
  }

  // Comments
  const comments = e.comments || [];

  // Fetch private notes
  const privateNotes = await Community.getPrivateNotes(entryId);

  // Build project/tags for editing
  const currentProject = c.project || '';
  const currentTags = c.tags || [];

  panel.innerHTML = `
    <div class="comm-detail-header">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="comm-detail-type">${esc(e.type)} · forensics</div>
        <div style="display:flex;gap:4px">
          <button class="comm-action-sm comm-detail-refresh" data-comm-action="refresh-entry" data-id="${e.id}" style="font-size:11px;padding:2px 8px">↺</button>
          <button class="comm-action-sm" data-comm-action="close-detail" style="font-size:12px;padding:2px 8px">✕</button>
        </div>
      </div>
      <div class="comm-detail-title">${titleHtml}</div>
      <div class="comm-detail-meta">
        <span class="comm-detail-ref">${esc(e.source_ref || e.profile || '')}</span>
        <span class="comm-detail-date">${ts}</span>
      </div>
      ${metaHtml ? `<div class="comm-detail-meta">${metaHtml}</div>` : ''}
      <!-- Editable project & tags -->
      <div class="comm-detail-tags-edit">
        <div class="comm-detail-edit-row">
          <span style="font-size:10px;color:var(--muted);width:50px">project</span>
          ${currentProject ? `<span class="comm-detail-pill">${esc(currentProject)}<button class="comm-detail-pill-del" data-comm-action="remove-project" data-id="${e.id}">✗</button></span>` : ''}
          <input class="comm-forensic-input" id="comm-detail-project-input" type="text" placeholder="add project…" style="flex:1;height:22px;font-size:11px" autocomplete="off" />
          <button class="comm-forensic-submit" data-comm-action="submit-detail-project" data-id="${e.id}" style="font-size:10px;padding:2px 8px">+</button>
        </div>
        <div class="comm-detail-edit-row">
          <span style="font-size:10px;color:var(--muted);width:50px">tags</span>
          ${currentTags.map(t => `<span class="comm-detail-pill">${esc(t)}<button class="comm-detail-pill-del" data-comm-action="remove-tag" data-id="${e.id}" data-tag="${esc(t)}">✗</button></span>`).join('')}
          <input class="comm-forensic-input" id="comm-detail-tag-input" type="text" placeholder="add tag…" style="flex:1;height:22px;font-size:11px" autocomplete="off" />
          <button class="comm-forensic-submit" data-comm-action="submit-detail-tag" data-id="${e.id}" style="font-size:10px;padding:2px 8px">+</button>
        </div>
      </div>
    </div>

    ${bodyHtml ? `<div class="comm-detail-body">${bodyHtml}</div>` : ''}

    <!-- Actions -->
    <div class="comm-detail-actions">
      <button class="comm-action-sm comm-detail-refresh" data-comm-action="refresh-entry" data-id="${e.id}">↺ sync to source</button>
      <button class="comm-action-sm" data-comm-action="copy-to-journal" data-id="${e.id}">→ journal</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task" data-id="${e.id}">→ task</button>
      <button class="comm-action-sm danger" data-comm-action="remove-entry" data-id="${e.id}">✗ remove</button>
    </div>

    <!-- Ledger module — collapsed by default -->
    <div class="comm-forensic-section comm-ledger-module">
      <div class="comm-forensic-toggle" data-toggle="comm-ledger-body">
        <span class="comm-forensic-caret${_commLedgerExpanded ? '' : ' collapsed'}" id="comm-ledger-caret">▾</span>
        <span class="comm-forensic-label">Ledger</span>
        <span class="comm-ledger-mode-toggle" id="comm-ledger-mode" style="font-size:9px;color:var(--muted);margin-left:auto;cursor:pointer">${_commLedgerDouble ? 'double entry' : 'single entry'}</span>
      </div>
      <div class="comm-forensic-body${_commLedgerExpanded ? '' : ' collapsed'}" id="comm-ledger-body">
        <div class="comm-ledger-form">
          <div class="comm-ledger-row">
            <input class="comm-forensic-input" id="comm-ledger-acct1" type="text" placeholder="account (debit)" list="comm-ledger-acct-list" autocomplete="off" style="flex:2" />
            <input class="comm-forensic-input" id="comm-ledger-amt1" type="number" placeholder="amount" step="any" style="flex:1" />
            <input class="comm-forensic-input" id="comm-ledger-unit1" type="text" placeholder="$" style="width:40px;flex:0 0 40px;text-align:center" autocomplete="off" />
          </div>
          <div class="comm-ledger-row" id="comm-ledger-row2" ${_commLedgerDouble ? '' : 'style="display:none"'}>
            <input class="comm-forensic-input" id="comm-ledger-acct2" type="text" placeholder="account (credit)" list="comm-ledger-acct-list" autocomplete="off" style="flex:2" />
            <input class="comm-forensic-input" id="comm-ledger-amt2" type="number" placeholder="amount" step="any" style="flex:1" />
            <input class="comm-forensic-input" id="comm-ledger-unit2" type="text" placeholder="$" style="width:40px;flex:0 0 40px;text-align:center" autocomplete="off" />
          </div>
          <datalist id="comm-ledger-acct-list"></datalist>
          <div class="comm-ledger-row" style="margin-top:4px">
            <select class="comm-forensic-input" id="comm-ledger-select" style="flex:1"></select>
            <input class="comm-forensic-input" id="comm-ledger-desc" type="text" placeholder="description" autocomplete="off" style="flex:2" />
            <button class="comm-forensic-submit" data-comm-action="stage-ledger-entry" data-id="${e.id}">+ stage</button>
          </div>
        </div>
        ${(() => {
          const staged = _commStagedLedger.get(e.id) || [];
          if (staged.length === 0) return '';
          return `<div class="comm-ledger-staged">
            <div class="comm-ledger-staged-label">staged <span style="color:var(--warning)">●</span></div>
            ${staged.map((s, i) => `
              <div class="comm-ledger-staged-item">
                <span class="comm-ledger-staged-text">${esc(s.acct1)} ${s.unit1}${s.amt1} → ${esc(s.acct2)} ${s.unit2}${s.finalAmt2}</span>
                <span class="comm-ledger-staged-meta">${esc(s.desc || '—')} · ${esc(s.ledger)}</span>
                <button class="comm-forensic-item-del" data-comm-action="unstage-ledger" data-id="${e.id}" data-idx="${i}">✗</button>
              </div>
            `).join('')}
            <button class="comm-forensic-submit" data-comm-action="sync-ledger" data-id="${e.id}" style="margin-top:6px;width:100%">↺ sync to ledger (${staged.length})</button>
          </div>`;
        })()}
      </div>
    </div>

    <!-- Comments section — input first, list below -->
    <div class="comm-forensic-section">
      <div class="comm-forensic-input-row">
        <input class="comm-forensic-input" id="comm-detail-comment-input" type="text" placeholder="add comment…" autocomplete="off" />
        <button class="comm-forensic-submit" data-comm-action="submit-detail-comment" data-id="${e.id}">+ comment</button>
      </div>
      <div class="comm-forensic-toggle" data-toggle="comm-comments-body">
        <span class="comm-forensic-caret" id="comm-comments-caret">▾</span>
        <span class="comm-forensic-label">Comments</span>
        <span class="comm-forensic-count">${comments.length}</span>
      </div>
      <div class="comm-forensic-body" id="comm-comments-body">
        ${comments.map(cm => `
          <div class="comm-forensic-item">
            <span class="comm-forensic-item-text">${esc(cm.body)}</span>
            <span class="comm-forensic-item-meta">${esc(cm.profile)} · ${fmtShortDate(cm.created_at)}</span>
            <button class="comm-forensic-item-del" data-comm-action="del-comment" data-id="${cm.id}">✗</button>
          </div>
        `).join('')}
        ${comments.length === 0 ? '<div style="font-size:11px;color:var(--muted);padding:3px 0">No comments yet.</div>' : ''}
      </div>
    </div>

    <!-- Annotations section (for tasks and journal) — input first, list below -->
    ${(e.type === 'task' || e.type === 'journal') ? `
    <div class="comm-forensic-section">
      <div class="comm-forensic-input-row">
        <input class="comm-forensic-input" id="comm-detail-ann-input" type="text" placeholder="annotate source ${esc(e.type)}…" autocomplete="off" />
        <button class="comm-forensic-submit" data-comm-action="submit-detail-annotate" data-id="${e.id}">✎ annotate</button>
      </div>
      <div class="comm-forensic-toggle" data-toggle="comm-annotations-body">
        <span class="comm-forensic-caret" id="comm-annotations-caret">▾</span>
        <span class="comm-forensic-label">Annotations</span>
        <span class="comm-forensic-count">${(c.annotations || []).length}</span>
      </div>
      <div class="comm-forensic-body" id="comm-annotations-body">
        ${(c.annotations || []).map(a => `
          <div class="comm-forensic-item">
            <span class="comm-forensic-item-text">${esc(a.description || a.text || '')}</span>
            <span class="comm-forensic-item-meta">${a.entry ? fmtShortDate(a.entry) : ''}</span>
          </div>
        `).join('')}
        ${(c.annotations || []).length === 0 ? '<div style="font-size:11px;color:var(--muted);padding:3px 0">No annotations.</div>' : ''}
      </div>
    </div>` : ''}

    <!-- Private Notes section — never shared or exported -->
    <div class="comm-forensic-section">
      <div class="comm-forensic-input-row">
        <input class="comm-forensic-input" id="comm-detail-note-input" type="text" placeholder="private note…" autocomplete="off" />
        <button class="comm-forensic-submit" data-comm-action="submit-detail-note" data-id="${e.id}">+ note</button>
      </div>
      <div class="comm-forensic-toggle" data-toggle="comm-notes-body">
        <span class="comm-forensic-caret" id="comm-notes-caret">▾</span>
        <span class="comm-forensic-label">Private Notes</span>
        <span class="comm-forensic-count">${privateNotes.length}</span>
        <span style="font-size:9px;color:var(--muted);margin-left:auto">local only</span>
      </div>
      <div class="comm-forensic-body" id="comm-notes-body">
        ${privateNotes.map(n => `
          <div class="comm-forensic-item">
            <span class="comm-forensic-item-text">${esc(n.body)}</span>
            <span class="comm-forensic-item-meta">${fmtShortDate(n.created_at)}</span>
            <button class="comm-forensic-item-del" data-comm-action="del-private-note" data-id="${n.id}">✗</button>
          </div>
        `).join('')}
        ${privateNotes.length === 0 ? '<div style="font-size:11px;color:var(--muted);padding:3px 0">No private notes.</div>' : ''}
      </div>
    </div>
  `;

  // Wire collapsible toggles
  panel.querySelectorAll('.comm-forensic-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.dataset.toggle;
      const body = document.getElementById(targetId);
      const caret = toggle.querySelector('.comm-forensic-caret');
      body?.classList.toggle('collapsed');
      caret?.classList.toggle('collapsed');
      // Persist ledger expanded state
      if (targetId === 'comm-ledger-body') {
        _commLedgerExpanded = !body?.classList.contains('collapsed');
      }
    });
  });

  // Wire ledger mode toggle (double/single entry)
  document.getElementById('comm-ledger-mode')?.addEventListener('click', (ev) => {
    ev.stopPropagation(); // Don't trigger the parent collapse toggle
    _commLedgerDouble = !_commLedgerDouble;
    const modeEl = document.getElementById('comm-ledger-mode');
    if (modeEl) modeEl.textContent = _commLedgerDouble ? 'double entry' : 'single entry';
    const row2 = document.getElementById('comm-ledger-row2');
    if (row2) row2.style.display = _commLedgerDouble ? '' : 'none';
  });

  // Populate ledger select and account datalist
  (async () => {
    const ledgers = await getLedgers(activeProfile);
    const sel = document.getElementById('comm-ledger-select');
    if (sel) {
      sel.innerHTML = ledgers.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('') + '<option value="__new__">+ new ledger…</option>';
      // Handle "new ledger" selection immediately
      sel.addEventListener('change', async () => {
        if (sel.value === '__new__') {
          const newName = await promptText('New ledger name:');
          if (newName?.trim()) {
            const clean = newName.trim();
            await addLedger(activeProfile, clean);
            // Add the new option and select it
            const opt = document.createElement('option');
            opt.value = clean;
            opt.textContent = clean;
            sel.insertBefore(opt, sel.querySelector('[value="__new__"]'));
            sel.value = clean;
            showToast(`Ledger "${clean}" created`);
          } else {
            // Revert to first option
            sel.value = sel.options[0]?.value || '';
          }
        }
      });
    }
    // Account autocomplete
    const txns = await Ledger.getTransactions(activeProfile, { limit: 500 });
    const acctSet = new Set();
    for (const t of txns) {
      for (const p of (t.postings || [])) { if (p.account) acctSet.add(p.account); }
    }
    const dl = document.getElementById('comm-ledger-acct-list');
    if (dl) dl.innerHTML = [...acctSet].sort().map(a => `<option value="${esc(a)}">`).join('');
    // Pre-fill last used unit
    const unit1 = document.getElementById('comm-ledger-unit1');
    const unit2 = document.getElementById('comm-ledger-unit2');
    if (unit1) unit1.value = _commLastUnit;
    if (unit2) unit2.value = _commLastUnit;
  })();

  // Wire Enter key on inputs
  document.getElementById('comm-detail-comment-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-comm-action="submit-detail-comment"]')?.click(); }
  });
  document.getElementById('comm-detail-ann-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-comm-action="submit-detail-annotate"]')?.click(); }
  });
  document.getElementById('comm-detail-project-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-comm-action="submit-detail-project"]')?.click(); }
  });
  document.getElementById('comm-detail-tag-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-comm-action="submit-detail-tag"]')?.click(); }
  });
  document.getElementById('comm-detail-note-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-comm-action="submit-detail-note"]')?.click(); }
  });

  // Highlight in list
  document.querySelectorAll('#community-body .comm-entry').forEach(el => el.classList.remove('comm-entry-active'));
  document.querySelector(`#community-body .comm-entry[data-comm-id="${entryId}"]`)?.classList.add('comm-entry-active');
}

function renderCommEntry(e) {
  const c = e.content || {};
  const ts = fmtShortDate(e.added_at);

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
      <button class="comm-action-sm" data-comm-action="annotate-task"  data-id="${e.id}">✎ annotate</button>
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
      <button class="comm-action-sm" data-comm-action="annotate-source" data-id="${e.id}">✎ annotate</button>
      <button class="comm-action-sm" data-comm-action="journal-back"    data-id="${e.id}">→ journal</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task"    data-id="${e.id}">→ task</button>`;
  } else if (e.type === 'ledger') {
    contentHtml = `<div class="comm-content"><strong>${esc(c.description || '')}</strong> <span style="color:var(--muted);font-size:11px">${esc(c.date || '')}</span></div>`;
    actionsHtml = `<button class="comm-action-sm" data-comm-action="open-comment" data-id="${e.id}">✎ comment</button>`;
  } else if (e.type === 'time') {
    const tags = ((c.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`)).join('');
    contentHtml = `<div class="comm-content">${tags || '<em style="color:var(--muted)">untagged</em>'}</div>`;
    actionsHtml = `<button class="comm-action-sm" data-comm-action="open-comment" data-id="${e.id}">✎ comment</button>`;
  } else if (e.type === 'note') {
    contentHtml = `<div class="comm-content">${esc((c.text || '').slice(0, 200))}</div>`;
    actionsHtml = `
      <button class="comm-action-sm" data-comm-action="open-comment" data-id="${e.id}">✎ comment</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task" data-id="${e.id}">→ task</button>`;
  } else if (e.type === 'list') {
    const status = c.done ? '<span class="comm-status-badge">done</span>' : '';
    contentHtml = `<div class="comm-content">${esc(c.text || '')} ${status}</div>`;
    if (c.note) metaHtml = `<div class="comm-entry-meta" style="font-style:italic;color:var(--muted);font-size:11px">${esc(c.note)}</div>`;
    actionsHtml = `
      <button class="comm-action-sm" data-comm-action="open-comment"   data-id="${e.id}">✎ comment</button>
      <button class="comm-action-sm" data-comm-action="copy-to-task"   data-id="${e.id}">→ task</button>
      <button class="comm-action-sm" data-comm-action="copy-to-journal" data-id="${e.id}">→ journal</button>`;
  }

  const commentsHtml = e.comments.length ? `<div class="comm-comments">${e.comments.map(cm => `
    <div class="comm-comment-item">
      <span class="comm-comment-body">${esc(cm.body)}</span>
      <span class="comm-comment-meta">${esc(cm.profile)} · ${fmtShortDate(cm.created_at)}</span>
      <button class="comm-comment-del" data-comm-action="del-comment" data-id="${cm.id}" title="delete">✗</button>
    </div>`).join('')}</div>` : '';

  return `
    <div class="comm-entry" data-comm-id="${e.id}" data-comm-type="${esc(e.type)}">
      <div class="comm-entry-header">
        <span class="comm-source-ref" title="${esc(e.source_ref||'')}">${esc(e.source_ref || e.profile)}</span>
        <span class="comm-entry-ts">${ts}</span>
        <div class="comm-header-actions">
          <button class="comm-action-sm danger" data-comm-action="remove-entry" data-id="${e.id}">✗</button>
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

  document.getElementById('community-header-select')?.addEventListener('change', (e) => {
    activeCommunity = parseInt(e.target.value);
    _commSelectedId = null;
    const panel = document.getElementById('comm-detail-panel');
    if (panel) { panel.classList.add('comm-right-hidden'); panel.innerHTML = ''; }
    renderCommunityBody();
  });

  // Header "+ collection" button
  document.getElementById('btn-new-community-header')?.addEventListener('click', () => {
    document.getElementById('community-create-form')?.classList.remove('hidden');
  });

  // Header archive button
  document.getElementById('btn-archive-community-header')?.addEventListener('click', async () => {
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

  // Entry actions (delegated from list)
  document.getElementById('community-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-comm-action]');
    if (btn) {
      // Handle button actions
      const action = btn.dataset.commAction;
      const id     = parseInt(btn.dataset.id);
      const entry  = btn.closest('.comm-entry');
      const entryId = entry ? parseInt(entry.dataset.commId) : null;
      await handleCommListAction(action, id, entryId);
      return;
    }

    // Click on entry card (not a button) opens detail panel
    const entry = e.target.closest('.comm-entry');
    if (entry && !e.target.closest('button, input, select, a')) {
      const entryId = parseInt(entry.dataset.commId);
      if (_commSelectedId === entryId) {
        // Close
        _commSelectedId = null;
        document.getElementById('comm-detail-panel')?.classList.add('comm-right-hidden');
        document.querySelectorAll('#community-body .comm-entry').forEach(el => el.classList.remove('comm-entry-active'));
      } else {
        document.getElementById('comm-detail-panel')?.classList.remove('comm-right-hidden');
        await renderCommDetailPanel(entryId);
      }
    }
  });

  // Handle list entry button actions
  async function handleCommListAction(action, id, entryId) {
    switch (action) {
      case 'remove-entry': {
        if (!await confirm('Remove from collection?')) return;
        await Community.removeEntry(id);
        showToast('Removed');
        if (_commSelectedId === id) {
          _commSelectedId = null;
          document.getElementById('comm-detail-panel')?.classList.add('comm-right-hidden');
        }
        await renderCommunityBody();
        return;
      }
      case 'del-comment': {
        await Community.deleteComment(id);
        showToast('Deleted');
        await renderCommunityBody();
        if (_commSelectedId) await renderCommDetailPanel(_commSelectedId);
        return;
      }
      case 'refresh-entry': {
        if (!entryId) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === entryId);
        if (!ce) return;
        let freshContent = null;
        if (ce.type === 'task') freshContent = await Tasks.getTask(activeProfile, ce.content?.uuid);
        else if (ce.type === 'journal') {
          const all = await Journal.getEntries(activeProfile, { limit: 10000 });
          freshContent = all.find(x => x.id === ce.content?.id);
        }
        if (!freshContent) { showToast('Source not found', 'warning'); return; }
        await Community.refreshEntry(entryId, freshContent);
        showToast('Refreshed');
        await renderCommunityBody();
        if (_commSelectedId === entryId) await renderCommDetailPanel(entryId);
        return;
      }
      case 'open-comment':
      case 'annotate-task':
      case 'copy-to-journal':
      case 'journal-back':
      case 'annotate-source':
      case 'copy-to-task': {
        const btn = document.querySelector(`.comm-entry[data-comm-id="${entryId}"] [data-comm-action="${action}"][data-id="${id}"]`);
        if (btn) await openCommInlinePanel(btn, action, entryId);
        return;
      }
      case 'submit-comment': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text = panel?.querySelector('[data-field="comment-text"]')?.value?.trim();
        if (!text) return;
        await Community.addComment(entryId, text, activeProfile);
        showToast('Comment added');
        closeAllCommPanels();
        await renderCommunityBody();
        if (_commSelectedId === entryId) await renderCommDetailPanel(entryId);
        return;
      }
      case 'submit-copy-to-journal': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text = panel?.querySelector('[data-field="jrnl-text"]')?.value?.trim();
        const jname = panel?.querySelector('[data-field="jrnl-name"]')?.value || activeJournal;
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === entryId);
        const body = `${text}\n[community: ${ce?.source_ref || ''}]`;
        await Journal.addEntry(activeProfile, { body, journal: jname });
        showToast(`Added to ${jname}`);
        closeAllCommPanels();
        return;
      }
      case 'submit-annotate-task': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text = panel?.querySelector('[data-field="ann-text"]')?.value?.trim();
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === entryId);
        if (!ce?.content?.uuid) { showToast('Source task not found', 'warning'); return; }
        await Tasks.annotateTask(activeProfile, ce.content.uuid, text);
        const fresh = await Tasks.getTask(activeProfile, ce.content.uuid);
        if (fresh) await Community.refreshEntry(entryId, fresh);
        showToast('Task annotated');
        closeAllCommPanels();
        await renderCommunityBody();
        if (_commSelectedId === entryId) await renderCommDetailPanel(entryId);
        return;
      }
      case 'submit-annotate-source': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const text = panel?.querySelector('[data-field="ann-text"]')?.value?.trim();
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === entryId);
        if (!ce?.content?.id) { showToast('Source entry not found', 'warning'); return; }
        await Journal.annotateEntry(activeProfile, ce.content.id, text);
        const all = await Journal.getEntries(activeProfile, { limit: 10000 });
        const fresh = all.find(x => x.id === ce.content.id);
        if (fresh) await Community.refreshEntry(entryId, fresh);
        showToast('Journal entry annotated');
        closeAllCommPanels();
        await renderCommunityBody();
        if (_commSelectedId === entryId) await renderCommDetailPanel(entryId);
        return;
      }
      case 'submit-journal-back': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const jname = panel?.querySelector('[data-field="jrnl-name"]')?.value || activeJournal;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === entryId);
        if (!ce?.content) { showToast('Source not found', 'warning'); return; }
        const body = `${ce.content.body || ''}\n[from community: ${ce.source_ref || ''}]`;
        await Journal.addEntry(activeProfile, { body, journal: jname, project: ce.content.project || '', tags: (ce.content.tags || []).join(' '), priority: ce.content.priority || '' });
        showToast(`Added to ${jname}`);
        closeAllCommPanels();
        return;
      }
      case 'submit-copy-to-task': {
        const panel = document.querySelector(`.comm-inline-panel[data-comm-panel="${entryId}"]`);
        const desc = panel?.querySelector('[data-field="task-desc"]')?.value?.trim();
        if (!desc) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === entryId);
        const task = await Tasks.addTask(activeProfile, { description: desc, tags: [...(ce?.content?.tags || []), 'community'].join(' '), project: ce?.content?.project || '' });
        const today = new Date().toISOString().slice(0, 10);
        const collName = (await Community.listCollections()).find(c => c.id === activeCommunity)?.name || '';
        await Tasks.annotateTask(activeProfile, task.uuid, `created from community/${collName} — ${ce?.source_ref || 'unknown'} (${today})`);
        showToast('Task created');
        closeAllCommPanels();
        return;
      }
      case 'cancel-comm-panel':
        closeAllCommPanels();
        return;
    }
  }

  // Detail panel actions (delegated)
  document.getElementById('comm-detail-panel')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-comm-action]');
    if (!btn) return;
    const action = btn.dataset.commAction;
    const id     = parseInt(btn.dataset.id);

    switch (action) {
      case 'close-detail': {
        _commSelectedId = null;
        document.getElementById('comm-detail-panel')?.classList.add('comm-right-hidden');
        document.querySelectorAll('#community-body .comm-entry').forEach(el => el.classList.remove('comm-entry-active'));
        return;
      }

      case 'remove-entry': {
        if (!await confirm('Remove from collection?')) return;
        await Community.removeEntry(id);
        showToast('Removed');
        _commSelectedId = null;
        document.getElementById('comm-detail-panel')?.classList.add('comm-right-hidden');
        await renderCommunityBody();
        return;
      }

      case 'del-comment': {
        await Community.deleteComment(id);
        showToast('Deleted');
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'refresh-entry': {
        if (!_commSelectedId) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;
        let freshContent = null;
        if (ce.type === 'task') {
          freshContent = await Tasks.getTask(activeProfile, ce.content?.uuid);
        } else if (ce.type === 'journal') {
          const all = await Journal.getEntries(activeProfile, { limit: 10000 });
          freshContent = all.find(x => x.id === ce.content?.id);
        }
        if (!freshContent) { showToast('Source not found — may be in a different profile', 'warning'); return; }
        await Community.refreshEntry(_commSelectedId, freshContent);
        showToast('Refreshed from source');
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'submit-detail-comment': {
        const input = document.getElementById('comm-detail-comment-input');
        const text = input?.value?.trim();
        if (!text) return;
        await Community.addComment(_commSelectedId, text, activeProfile);
        input.value = '';
        showToast('Comment added');
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'submit-detail-annotate': {
        const input = document.getElementById('comm-detail-ann-input');
        const text = input?.value?.trim();
        if (!text) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;

        if (ce.type === 'task') {
          if (!ce.content?.uuid) { showToast('Source task not found', 'warning'); return; }
          await Tasks.annotateTask(activeProfile, ce.content.uuid, text);
          const fresh = await Tasks.getTask(activeProfile, ce.content.uuid);
          if (fresh) await Community.refreshEntry(_commSelectedId, fresh);
          showToast('Task annotated');
        } else if (ce.type === 'journal') {
          if (!ce.content?.id) { showToast('Source journal entry not found', 'warning'); return; }
          await Journal.annotateEntry(activeProfile, ce.content.id, text);
          const all = await Journal.getEntries(activeProfile, { limit: 10000 });
          const fresh = all.find(x => x.id === ce.content.id);
          if (fresh) await Community.refreshEntry(_commSelectedId, fresh);
          showToast('Journal entry annotated');
        }

        input.value = '';
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'copy-to-journal': {
        const text = await promptText('Note to journal:');
        if (!text) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === _commSelectedId);
        const body = `${text}\n[community: ${ce?.source_ref || ''}]`;
        await Journal.addEntry(activeProfile, { body, journal: activeJournal });
        showToast(`Added to ${activeJournal}`);
        return;
      }

      case 'copy-to-task': {
        const desc = await promptText('Task description:');
        if (!desc) return;
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === _commSelectedId);
        await Tasks.addTask(activeProfile, {
          description: desc,
          tags: [...(ce?.content?.tags || []), 'community'].join(' '),
          project: ce?.content?.project || '',
        });
        showToast('Task created');
        return;
      }

      case 'submit-detail-project': {
        const input = document.getElementById('comm-detail-project-input');
        const proj = input?.value?.trim();
        if (!proj) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;
        const updated = { ...ce.content, project: proj };
        await Community.refreshEntry(_commSelectedId, updated);
        input.value = '';
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'remove-project': {
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;
        const updated = { ...ce.content, project: '' };
        await Community.refreshEntry(_commSelectedId, updated);
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'submit-detail-tag': {
        const input = document.getElementById('comm-detail-tag-input');
        const tag = input?.value?.trim();
        if (!tag) return;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;
        const tags = [...(ce.content.tags || [])];
        if (!tags.includes(tag)) tags.push(tag);
        const updated = { ...ce.content, tags };
        await Community.refreshEntry(_commSelectedId, updated);
        input.value = '';
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'remove-tag': {
        const tag = btn.dataset.tag;
        const allEntries = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allEntries.find(x => x.id === _commSelectedId);
        if (!ce) return;
        const tags = (ce.content.tags || []).filter(t => t !== tag);
        const updated = { ...ce.content, tags };
        await Community.refreshEntry(_commSelectedId, updated);
        await renderCommDetailPanel(_commSelectedId);
        await renderCommunityBody();
        return;
      }

      case 'submit-detail-note': {
        const input = document.getElementById('comm-detail-note-input');
        const text = input?.value?.trim();
        if (!text) return;
        await Community.addPrivateNote(_commSelectedId, text, activeProfile);
        input.value = '';
        showToast('Private note added');
        await renderCommDetailPanel(_commSelectedId);
        return;
      }

      case 'del-private-note': {
        await Community.deletePrivateNote(id);
        showToast('Note deleted');
        await renderCommDetailPanel(_commSelectedId);
        return;
      }

      case 'stage-ledger-entry': {
        const acct1 = document.getElementById('comm-ledger-acct1')?.value.trim();
        const amt1  = parseFloat(document.getElementById('comm-ledger-amt1')?.value);
        const unit1 = document.getElementById('comm-ledger-unit1')?.value.trim() || '$';
        const acct2 = document.getElementById('comm-ledger-acct2')?.value.trim();
        const amt2  = parseFloat(document.getElementById('comm-ledger-amt2')?.value);
        const unit2 = document.getElementById('comm-ledger-unit2')?.value.trim() || '$';
        const desc  = document.getElementById('comm-ledger-desc')?.value.trim();
        const ledger = document.getElementById('comm-ledger-select')?.value;

        if (!acct1 || isNaN(amt1)) { showToast('Fill in account and amount', 'warning'); return; }
        if (_commLedgerDouble && !acct2) { showToast('Fill in the credit account', 'warning'); return; }

        let targetLedger = ledger;
        if (targetLedger === '__new__') {
          showToast('Select or create a ledger first', 'warning');
          return;
        }

        const finalAmt2 = isNaN(amt2) ? -amt1 : amt2;
        const finalAcct2 = acct2 || 'equity:unbalanced';
        _commLastUnit = unit1;

        // Stage the entry
        if (!_commStagedLedger.has(_commSelectedId)) _commStagedLedger.set(_commSelectedId, []);
        _commStagedLedger.get(_commSelectedId).push({ acct1, amt1, unit1, acct2: finalAcct2, finalAmt2, unit2: unit2 || unit1, desc, ledger: targetLedger });

        showToast('Entry staged');
        // Clear form
        document.getElementById('comm-ledger-acct1').value = '';
        document.getElementById('comm-ledger-amt1').value = '';
        document.getElementById('comm-ledger-acct2').value = '';
        document.getElementById('comm-ledger-amt2').value = '';
        document.getElementById('comm-ledger-desc').value = '';
        await renderCommDetailPanel(_commSelectedId);
        return;
      }

      case 'unstage-ledger': {
        const idx = parseInt(btn.dataset.idx);
        const staged = _commStagedLedger.get(_commSelectedId) || [];
        staged.splice(idx, 1);
        if (staged.length === 0) _commStagedLedger.delete(_commSelectedId);
        await renderCommDetailPanel(_commSelectedId);
        return;
      }

      case 'sync-ledger': {
        const staged = _commStagedLedger.get(_commSelectedId) || [];
        if (staged.length === 0) { showToast('Nothing staged', 'warning'); return; }

        const today = new Date().toISOString().slice(0, 10);
        const allE = await Community.getEntries(activeCommunity, { view: 'unified' });
        const ce = allE.find(x => x.id === _commSelectedId);

        for (const s of staged) {
          const entryDesc = s.desc || (ce?.content?.description || ce?.content?.body?.slice(0, 40) || 'community entry');
          await Ledger.addFullTransaction(activeProfile, {
            date: today,
            description: entryDesc,
            ledger: s.ledger,
            postings: [
              { account: s.acct1, amount: s.amt1, comment: `${s.unit1} [community]` },
              { account: s.acct2, amount: s.finalAmt2, comment: `${s.unit2}` },
            ],
            comment: `community/${ce?.source_ref || _commSelectedId}`,
          });
        }

        _commStagedLedger.delete(_commSelectedId);
        showToast(`${staged.length} entry${staged.length > 1 ? 's' : ''} synced to ledger`);
        await renderCommDetailPanel(_commSelectedId);
        return;
      }
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

let activeQList = 'default';
let _qSelectedId = null;
let _qRunMode = false;
let _qEditMode = false;
let _qShowArchived = false;
let _qSortMode = 'none'; // 'none' | 'project' | 'tags'

async function loadQuestions() {
  // Populate header sublist selector
  const qLists = await getQuestionLists(activeProfile);
  const qlSel = document.getElementById('q-list-select');
  if (qlSel) {
    qlSel.innerHTML = qLists.map(l => `<option value="${esc(l)}" ${l === activeQList ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }

  const templates = await Questions.getTemplates(activeProfile);
  const filtered = templates.filter(t => {
    if (!_qShowArchived && t.archived) return false;
    if (t.list && t.list !== activeQList && activeQList !== 'default') return false;
    return true;
  });

  const searchEl = document.getElementById('q-search');
  let display = filtered;
  if (searchEl?.value.trim()) {
    const q = searchEl.value.trim().toLowerCase();
    display = display.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
  }

  // Sort
  if (_qSortMode === 'project') {
    display = [...display].sort((a, b) => (a.project || '').localeCompare(b.project || ''));
  } else if (_qSortMode === 'tags') {
    display = [...display].sort((a, b) => ((a.tags || [])[0] || '').localeCompare(((b.tags || [])[0] || '')));
  }

  const el = document.getElementById('q-list');
  if (!el) return;
  if (display.length === 0) {
    el.innerHTML = '<div class="skeleton-msg">No question sets. Click + NEW to create one.</div>';
    return;
  }

  el.innerHTML = display.map(t => `
    <div class="q-card ${t.id === _qSelectedId ? 'q-card-active' : ''} ${t.archived ? 'q-card-archived' : ''}" data-q-id="${esc(t.id)}">
      <div class="q-card-title">
        <span class="q-svc-badge">${esc(t.service)}</span>
        <span class="q-name">${esc(t.name)}</span>
        ${t.archived ? '<span style="font-size:9px;color:var(--muted)">archived</span>' : ''}
      </div>
      ${t.description ? `<div class="q-desc">${esc(t.description)}</div>` : ''}
      <div class="q-card-meta">
        ${(t.tags || []).map(tag => `<span class="task-tag">${esc(tag)}</span>`).join('')}
        ${t.project ? `<span class="task-project-badge">${esc(t.project)}</span>` : ''}
        <span style="font-size:10px;color:var(--muted)">${t.fields?.length || 0} fields</span>
      </div>
      <div class="q-card-actions">
        <button class="comm-action-sm" data-q-action="annotate" data-id="${esc(t.id)}">+ annotate</button>
        <button class="comm-action-sm" data-q-action="to-journal" data-id="${esc(t.id)}">→ journal</button>
        <button class="comm-action-sm" data-q-action="to-community" data-id="${esc(t.id)}">→ community</button>
      </div>
    </div>
  `).join('');
}

function renderQDetailPanel(template) {
  const panel = document.getElementById('q-detail-panel');
  if (!panel) return;
  if (!template) { panel.classList.add('q-right-hidden'); _qSelectedId = null; return; }

  _qSelectedId = template.id;
  panel.classList.remove('q-right-hidden');

  const tags = template.tags || [];
  const project = template.project || '';

  if (_qEditMode) {
    // Edit mode — same look as run mode but edits the template definition
    panel.innerHTML = `
      <div class="q-detail-header">
        <div class="q-detail-title">${template.name ? esc(template.name) : '<em style="color:var(--muted)">New Question Set</em>'}</div>
        <div class="q-detail-desc">${esc(template.description || '')}</div>
      </div>
      <div class="q-detail-btn-row">
        <button data-q-action="cancel-edit">← back</button>
        <button data-q-action="run-template" data-id="${esc(template.id)}">▶ run</button>
      </div>
      <form id="q-edit-form" class="q-form">
        <div class="q-inputs">
          <div class="q-input-row">
            <label class="q-label">Name</label>
            <input type="text" name="name" value="${esc(template.name)}" class="q-answer" placeholder="Question set name…" />
          </div>
          <div class="q-input-row">
            <label class="q-label">Description</label>
            <input type="text" name="description" value="${esc(template.description || '')}" class="q-answer" placeholder="Brief description…" />
          </div>
          <div class="q-input-row">
            <label class="q-label">Service</label>
            <select name="service" class="q-answer">
              <option value="journal" ${template.service === 'journal' ? 'selected' : ''}>journal</option>
              <option value="task" ${template.service === 'task' ? 'selected' : ''}>task</option>
              <option value="ledger" ${template.service === 'ledger' ? 'selected' : ''}>ledger</option>
              <option value="time" ${template.service === 'time' ? 'selected' : ''}>time</option>
            </select>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
            <label class="q-label" style="margin-bottom:6px;display:block">Fields</label>
            <div id="q-edit-fields">
              ${(template.fields || []).map((f, i) => `
                <div class="q-edit-field-row" data-idx="${i}">
                  <input type="text" class="q-answer" style="flex:1" placeholder="key" value="${esc(f.key)}" data-field="key" />
                  <input type="text" class="q-answer" style="flex:2" placeholder="label" value="${esc(f.label)}" data-field="label" />
                  <select class="q-answer" style="width:80px" data-field="type">
                    <option value="text" ${f.type === 'text' ? 'selected' : ''}>text</option>
                    <option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>textarea</option>
                    <option value="select" ${f.type === 'select' ? 'selected' : ''}>select</option>
                    <option value="date" ${f.type === 'date' ? 'selected' : ''}>date</option>
                    <option value="integer" ${f.type === 'integer' ? 'selected' : ''}>integer</option>
                    <option value="decimal" ${f.type === 'decimal' ? 'selected' : ''}>decimal</option>
                  </select>
                  <input type="text" class="q-answer" style="flex:1" placeholder="${f.type === 'select' ? 'options: a,b,c' : 'default'}" value="${esc(f.type === 'select' ? (f.options || []).join(',') : (f.default || ''))}" data-field="default" />
                  <button type="button" class="comm-forensic-item-del" data-q-action="remove-field" data-id="${esc(template.id)}" data-idx="${i}">✗</button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="comm-action-sm" data-q-action="add-field" data-id="${esc(template.id)}" style="margin-top:6px">+ add field</button>
          </div>
        </div>
        <div class="q-form-actions">
          <button type="button" class="q-save-option q-save-primary" data-q-action="save-edit" data-id="${esc(template.id)}">save</button>
          <button type="button" class="q-save-option" data-q-action="cancel-edit">cancel</button>
        </div>
      </form>
    `;
  } else if (_qRunMode) {
    // Run mode — show form
    panel.innerHTML = `
      <div class="q-detail-header">
        <div class="q-detail-title">${esc(template.name)}</div>
        <div class="q-detail-desc">${esc(template.description || '')}</div>
      </div>
      <div class="q-detail-btn-row">
        <button data-q-action="cancel-run">← back</button>
        <button data-q-action="edit-template" data-id="${esc(template.id)}">✎ edit</button>
      </div>
      <form id="q-run-form" class="q-form">
        <div class="q-inputs">
          ${template.fields.map(f => `
            <div class="q-input-row">
              <label class="q-label">${esc(f.label)}</label>
              ${f.type === 'textarea'
                ? `<textarea name="${esc(f.key)}" rows="3" class="q-answer">${esc(f.default || '')}</textarea>`
                : f.type === 'select'
                  ? `<select name="${esc(f.key)}" class="q-answer">${(f.options || []).map(o => `<option ${o === f.default ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
                  : f.type === 'integer'
                    ? `<input type="number" step="1" name="${esc(f.key)}" value="${esc(f.default || '')}" class="q-answer" />`
                    : f.type === 'decimal'
                      ? `<input type="number" step="any" name="${esc(f.key)}" value="${esc(f.default || '')}" class="q-answer" />`
                      : `<input type="${f.type === 'date' ? 'date' : 'text'}" name="${esc(f.key)}" value="${esc(f.default || '')}" class="q-answer" />`
              }
            </div>
          `).join('')}
        </div>
        <div class="q-form-actions">
          <button type="button" class="q-save-option q-save-primary" data-q-action="save-to-log" data-id="${esc(template.id)}">save to log</button>
          <button type="button" class="q-save-option" data-q-action="save-to-journal" data-id="${esc(template.id)}">save to journal</button>
          <button type="button" class="q-save-option" data-q-action="save-to-both" data-id="${esc(template.id)}">log & journal</button>
        </div>
      </form>
    `;
  } else {
    // Review mode — show questions as list
    panel.innerHTML = `
      <div class="q-detail-header">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="q-detail-title">${esc(template.name)}</div>
          <button class="comm-action-sm" data-q-action="close-detail" style="font-size:12px;padding:2px 8px">✕</button>
        </div>
        <div class="q-detail-desc">${esc(template.description || '')} <span class="q-svc-badge">${esc(template.service)}</span></div>
        <!-- Project & tags -->
        <div class="q-detail-tags-edit">
          <div class="q-detail-edit-row">
            <span style="font-size:10px;color:var(--muted);width:50px">project</span>
            ${project ? `<span class="q-detail-pill">${esc(project)}<button class="q-detail-pill-del" data-q-action="remove-project" data-id="${esc(template.id)}">✗</button></span>` : ''}
            <input class="comm-forensic-input" id="q-detail-project-input" type="text" placeholder="add project…" style="flex:1;height:22px;font-size:11px" autocomplete="off" />
            <button class="comm-forensic-submit" data-q-action="add-project" data-id="${esc(template.id)}" style="font-size:10px;padding:2px 8px">+</button>
          </div>
          <div class="q-detail-edit-row">
            <span style="font-size:10px;color:var(--muted);width:50px">tags</span>
            ${tags.map(t => `<span class="q-detail-pill">${esc(t)}<button class="q-detail-pill-del" data-q-action="remove-tag" data-id="${esc(template.id)}" data-tag="${esc(t)}">✗</button></span>`).join('')}
            <input class="comm-forensic-input" id="q-detail-tag-input" type="text" placeholder="add tag…" style="flex:1;height:22px;font-size:11px" autocomplete="off" />
            <button class="comm-forensic-submit" data-q-action="add-tag" data-id="${esc(template.id)}" style="font-size:10px;padding:2px 8px">+</button>
          </div>
        </div>
      </div>
      <div class="q-detail-btn-row">
        <button data-q-action="run-template" data-id="${esc(template.id)}">▶ run</button>
        <button data-q-action="edit-template" data-id="${esc(template.id)}">✎ edit</button>
      </div>
      <div class="q-field-list">
        ${(template.fields || []).map(f => `
          <div class="q-field-item">
            <span class="q-field-key">${esc(f.key)}</span> — ${esc(f.label)} <span style="color:var(--muted);font-size:10px">(${esc(f.type)})</span>
          </div>
        `).join('')}
        ${(!template.fields || template.fields.length === 0) ? '<div style="font-size:11px;color:var(--muted)">No fields defined.</div>' : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
        <button class="comm-action-sm" data-q-action="${template.archived ? 'unarchive' : 'archive'}-template" data-id="${esc(template.id)}">${template.archived ? '↩ unarchive' : '→ archive'}</button>
        <button class="comm-action-sm danger" data-q-action="delete-template" data-id="${esc(template.id)}">✗ delete</button>
      </div>
    `;
  }

  // Wire Enter on project/tag inputs
  document.getElementById('q-detail-project-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-q-action="add-project"]')?.click(); }
  });
  document.getElementById('q-detail-tag-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); panel.querySelector('[data-q-action="add-tag"]')?.click(); }
  });

  // Highlight in list
  document.querySelectorAll('#q-list .q-card').forEach(el => el.classList.remove('q-card-active'));
  document.querySelector(`#q-list .q-card[data-q-id="${template.id}"]`)?.classList.add('q-card-active');
}

function wireQuestionsSection() {
  // Header sublist selector
  document.getElementById('q-list-select')?.addEventListener('change', (e) => {
    activeQList = e.target.value;
    loadQuestions();
  });
  document.getElementById('btn-new-q-list')?.addEventListener('click', async () => {
    const name = await promptText('Question list name:');
    if (!name?.trim()) return;
    await addQuestionList(activeProfile, name.trim());
    activeQList = name.trim();
    showToast(`List "${name.trim()}" created`);
    await loadQuestions();
  });
  document.getElementById('btn-del-q-list')?.addEventListener('click', async () => {
    if (activeQList === 'default') { showToast('Cannot remove the default list', 'warning'); return; }
    if (!await confirm(`Remove question list "${activeQList}"?`)) return;
    await removeQuestionList(activeProfile, activeQList);
    activeQList = 'default';
    showToast('List removed');
    await loadQuestions();
  });

  // Search
  document.getElementById('q-search')?.addEventListener('input', () => loadQuestions());

  // Sort buttons
  document.getElementById('btn-q-sort-project')?.addEventListener('click', () => {
    _qSortMode = _qSortMode === 'project' ? 'none' : 'project';
    document.getElementById('btn-q-sort-project')?.classList.toggle('active', _qSortMode === 'project');
    document.getElementById('btn-q-sort-tags')?.classList.remove('active');
    loadQuestions();
  });
  document.getElementById('btn-q-sort-tags')?.addEventListener('click', () => {
    _qSortMode = _qSortMode === 'tags' ? 'none' : 'tags';
    document.getElementById('btn-q-sort-tags')?.classList.toggle('active', _qSortMode === 'tags');
    document.getElementById('btn-q-sort-project')?.classList.remove('active');
    loadQuestions();
  });

  // Show archived toggle
  document.getElementById('btn-q-show-archived')?.addEventListener('click', () => {
    _qShowArchived = !_qShowArchived;
    document.getElementById('btn-q-show-archived')?.classList.toggle('active', _qShowArchived);
    loadQuestions();
  });

  // New question set
  document.getElementById('btn-q-new')?.addEventListener('click', async () => {
    const template = {
      id: crypto.randomUUID(),
      name: '',
      service: 'journal',
      description: '',
      fields: [],
      list: activeQList,
      tags: [],
      project: '',
      archived: false,
    };
    await Questions.saveTemplate(activeProfile, template);
    _qRunMode = false;
    _qEditMode = true;
    await loadQuestions();
    renderQDetailPanel(template);
  });

  // List click — open detail panel
  document.getElementById('q-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-q-action]');
    if (btn) {
      await handleQAction(btn.dataset.qAction, btn.dataset.id, btn);
      return;
    }
    const card = e.target.closest('.q-card');
    if (card && !e.target.closest('button')) {
      const templates = await Questions.getTemplates(activeProfile);
      const t = templates.find(x => x.id === card.dataset.qId);
      if (t) { _qRunMode = false; renderQDetailPanel(t); }
    }
  });

  // Detail panel actions
  document.getElementById('q-detail-panel')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-q-action]');
    if (btn) await handleQAction(btn.dataset.qAction, btn.dataset.id, btn);
  });
}

async function handleQAction(action, id, btn) {
  const templates = await Questions.getTemplates(activeProfile);
  const template = templates.find(t => t.id === id);

  switch (action) {
    case 'close-detail':
      _qSelectedId = null;
      document.getElementById('q-detail-panel')?.classList.add('q-right-hidden');
      document.querySelectorAll('#q-list .q-card').forEach(el => el.classList.remove('q-card-active'));
      return;

    case 'run-template':
      if (!template) return;
      _qRunMode = true;
      renderQDetailPanel(template);
      return;

    case 'cancel-run':
      _qRunMode = false;
      if (template) renderQDetailPanel(template);
      else { const t = templates.find(x => x.id === _qSelectedId); if (t) renderQDetailPanel(t); }
      return;

    case 'cancel-edit':
      _qEditMode = false;
      if (template) renderQDetailPanel(template);
      else { const t = templates.find(x => x.id === _qSelectedId); if (t) renderQDetailPanel(t); }
      return;

    case 'save-edit': {
      if (!template) return;
      const form = document.getElementById('q-edit-form');
      if (!form) return;
      const name = form.querySelector('[name="name"]')?.value.trim();
      const description = form.querySelector('[name="description"]')?.value.trim();
      const service = form.querySelector('[name="service"]')?.value || 'journal';
      // Collect fields from rows
      const fieldRows = form.querySelectorAll('.q-edit-field-row');
      const fields = [];
      fieldRows.forEach(row => {
        const key = row.querySelector('[data-field="key"]')?.value.trim();
        const label = row.querySelector('[data-field="label"]')?.value.trim();
        const type = row.querySelector('[data-field="type"]')?.value || 'text';
        const defVal = row.querySelector('[data-field="default"]')?.value.trim();
        if (!key) return;
        const field = { key, label: label || key, type, default: '' };
        if (type === 'select') {
          field.options = defVal ? defVal.split(',').map(s => s.trim()).filter(Boolean) : [];
          field.default = field.options[0] || '';
        } else {
          field.default = defVal;
        }
        fields.push(field);
      });
      if (!name) { showToast('Name is required', 'warning'); return; }
      await Questions.saveTemplate(activeProfile, { ...template, name, description, service, fields });
      showToast('Saved');
      _qEditMode = false;
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      await loadQuestions();
      return;
    }

    case 'add-field': {
      if (!template) return;
      const fields = [...(template.fields || []), { key: '', label: '', type: 'text', default: '' }];
      await Questions.saveTemplate(activeProfile, { ...template, fields });
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      return;
    }

    case 'remove-field': {
      if (!template) return;
      const idx = parseInt(btn?.dataset.idx);
      const fields = [...(template.fields || [])];
      fields.splice(idx, 1);
      await Questions.saveTemplate(activeProfile, { ...template, fields });
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      return;
    }

    case 'edit-template': {
      if (!template) return;
      _qEditMode = true;
      _qRunMode = false;
      renderQDetailPanel(template);
      return;
    }

    case 'archive-template':
      if (!template) return;
      await Questions.saveTemplate(activeProfile, { ...template, archived: true });
      showToast('Archived');
      _qSelectedId = null;
      document.getElementById('q-detail-panel')?.classList.add('q-right-hidden');
      await loadQuestions();
      return;

    case 'unarchive-template':
      if (!template) return;
      await Questions.saveTemplate(activeProfile, { ...template, archived: false });
      showToast('Unarchived');
      renderQDetailPanel({ ...template, archived: false });
      await loadQuestions();
      return;

    case 'delete-template':
      if (!template) return;
      if (!await confirm(`Delete "${template.name}"?`)) return;
      await Questions.deleteTemplate(activeProfile, id);
      showToast('Deleted');
      _qSelectedId = null;
      document.getElementById('q-detail-panel')?.classList.add('q-right-hidden');
      await loadQuestions();
      return;

    case 'add-project': {
      const input = document.getElementById('q-detail-project-input');
      const proj = input?.value.trim();
      if (!proj || !template) return;
      await Questions.saveTemplate(activeProfile, { ...template, project: proj });
      input.value = '';
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      await loadQuestions();
      return;
    }

    case 'remove-project':
      if (!template) return;
      await Questions.saveTemplate(activeProfile, { ...template, project: '' });
      const updP = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updP);
      await loadQuestions();
      return;

    case 'add-tag': {
      const input = document.getElementById('q-detail-tag-input');
      const tag = input?.value.trim();
      if (!tag || !template) return;
      const tags = [...(template.tags || [])];
      if (!tags.includes(tag)) tags.push(tag);
      await Questions.saveTemplate(activeProfile, { ...template, tags });
      input.value = '';
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      await loadQuestions();
      return;
    }

    case 'remove-tag': {
      const tag = btn?.dataset.tag;
      if (!tag || !template) return;
      const tags = (template.tags || []).filter(t => t !== tag);
      await Questions.saveTemplate(activeProfile, { ...template, tags });
      const updated = (await Questions.getTemplates(activeProfile)).find(t => t.id === id);
      renderQDetailPanel(updated);
      await loadQuestions();
      return;
    }

    case 'save-to-log':
    case 'save-to-journal':
    case 'save-to-both': {
      if (!template) return;
      const form = document.getElementById('q-run-form');
      if (!form) return;
      const fd = new FormData(form);
      const answers = {};
      for (const [k, v] of fd.entries()) answers[k] = v;

      const qAction = Questions.buildAction(template, answers);

      if (action === 'save-to-log' || action === 'save-to-both') {
        if (qAction) await dispatchQuestionAction(qAction);
      }
      if (action === 'save-to-journal' || action === 'save-to-both') {
        // Build journal entry from answers
        const lines = template.fields.map(f => `**${f.label}:** ${answers[f.key] || '—'}`);
        const body = `## ${template.name}\n${lines.join('\n')}`;
        await Journal.addEntry(activeProfile, { body, journal: activeJournal, project: template.project || '', tags: (template.tags || []).join(' ') });
      }

      showToast(`${template.name} — saved`);
      _qRunMode = false;
      renderQDetailPanel(template);
      return;
    }

    case 'annotate': {
      if (!template) return;
      const text = await promptText('Annotation:');
      if (!text) return;
      // Store as a journal entry referencing the question set
      await Journal.addEntry(activeProfile, { body: `[question: ${template.name}] ${text}`, journal: activeJournal });
      showToast('Annotated to journal');
      return;
    }

    case 'to-journal': {
      if (!template) return;
      const lines = template.fields.map(f => `• ${f.label} (${f.type})`);
      const body = `## ${template.name}\n${template.description || ''}\n${lines.join('\n')}`;
      await Journal.addEntry(activeProfile, { body, journal: activeJournal, project: template.project || '', tags: (template.tags || []).join(' ') });
      showToast('Sent to journal');
      return;
    }

    case 'to-community': {
      if (!template) return;
      const collections = await Community.listCollections();
      const active = collections.filter(c => !c.archived_at);
      if (active.length === 0) { showToast('No community collections', 'warning'); return; }
      const lines = template.fields.map(f => `• ${f.label}`);
      const content = { name: template.name, description: template.description, fields: lines.join('\n'), service: template.service };
      await Community.addEntry(active[0].id, { type: 'note', profile: activeProfile, content: { text: `${template.name}\n${lines.join('\n')}` } });
      showToast(`Sent to ${active[0].name}`);
      return;
    }
  }
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

// ── Function Info Panels ──────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  // In-section info button
  const infoBtn = e.target.closest('.fn-info-btn');
  if (infoBtn) {
    const name = infoBtn.dataset.fnInfo;
    document.getElementById(`fn-info-${name}`)?.classList.toggle('hidden');
    return;
  }
  // Header info button — toggles panel for current active section
  const headerInfoBtn = e.target.closest('#btn-fn-info');
  if (headerInfoBtn) {
    const sectionMap = { tasks: 'tasks', time: 'time', journal: 'journal', ledger: 'ledger', lists: 'lists', attributes: 'attributes', tags: 'tags', projects: 'projects', community: 'community', questions: 'questions', export: 'export' };
    const name = sectionMap[activeSection];
    if (name) document.getElementById(`fn-info-${name}`)?.classList.toggle('hidden');
    return;
  }
  // Close button
  const closeBtn = e.target.closest('.fn-info-close');
  if (closeBtn) {
    const name = closeBtn.dataset.fnInfoClose;
    document.getElementById(`fn-info-${name}`)?.classList.add('hidden');
  }
});

// ── Viz ───────────────────────────────────────────────────────────────────────

async function loadViz() {
  await Viz.init(activeProfile);
  Gallery.init(activeProfile);
  // Render gallery panel into a container
  const galleryContainer = document.getElementById('viz-gallery-panel');
  if (galleryContainer) {
    Gallery.renderGalleryPanel(galleryContainer);
  }
  await Viz.computeActive(activeProfile);
}

function renderVizFilterBadges() {
  const container = document.getElementById('viz-active-filters');
  if (!container) return;
  const state = Viz.getState();
  let html = '';
  if (state.filters.service) {
    html += `<span class="viz-badge" data-filter-type="service" data-filter-value="${state.filters.service}">service:${state.filters.service} <button class="viz-badge-remove">✕</button></span>`;
  }
  if (state.filters.project) {
    html += `<span class="viz-badge" data-filter-type="project" data-filter-value="${state.filters.project}">project:${state.filters.project} <button class="viz-badge-remove">✕</button></span>`;
  }
  for (const tag of state.filters.tags) {
    html += `<span class="viz-badge" data-filter-type="tags" data-filter-value="${tag}">tags:${tag} <button class="viz-badge-remove">✕</button></span>`;
  }
  container.innerHTML = html;
}

async function refreshVizPresetList() {
  const select = document.getElementById('viz-preset-select');
  if (!select) return;
  const presets = await Viz.getPresets(activeProfile);
  select.innerHTML = '<option value="">— presets —</option>';
  for (const p of presets) {
    select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  }
}

function wireVizSection() {
  const lensSelect = document.getElementById('viz-lens-select');
  const timeSelect = document.getElementById('viz-time-select');
  const customRange = document.getElementById('viz-custom-range');
  const fromInput = document.getElementById('viz-from');
  const toInput = document.getElementById('viz-to');
  const applyRange = document.getElementById('viz-apply-range');
  const modeToggle = document.getElementById('viz-mode-toggle');
  const refreshBtn = document.getElementById('viz-refresh-btn');
  const filterService = document.getElementById('viz-filter-service');
  const filterProject = document.getElementById('viz-filter-project');
  const filterTags = document.getElementById('viz-filter-tags');
  const activeFilters = document.getElementById('viz-active-filters');
  const presetSelect = document.getElementById('viz-preset-select');
  const presetSave = document.getElementById('viz-preset-save');
  const presetDelete = document.getElementById('viz-preset-delete');

  // Lens selector change
  if (lensSelect) {
    lensSelect.addEventListener('change', async () => {
      Viz.setLens(lensSelect.value);
      await Viz.computeActive(activeProfile);
      await Viz.persistPreferences(activeProfile);
    });
  }

  // Time range change
  if (timeSelect) {
    timeSelect.addEventListener('change', async () => {
      Viz.setTimeRange(timeSelect.value);
      if (timeSelect.value === 'custom') {
        customRange?.classList.remove('hidden');
      } else {
        customRange?.classList.add('hidden');
        await Viz.computeActive(activeProfile);
        await Gallery.refreshAllExpanded(activeProfile);
      }
    });
  }

  // Custom range apply
  if (applyRange) {
    applyRange.addEventListener('click', async () => {
      const fromVal = fromInput?.value;
      const toVal = toInput?.value;
      if (!fromVal || !toVal) return;
      const fromTs = Math.floor(new Date(fromVal).getTime() / 1000);
      const toTs = Math.floor(new Date(toVal).getTime() / 1000);
      if (fromTs >= toTs) {
        fromInput?.classList.add('input-error');
        toInput?.classList.add('input-error');
        showToast('Start must be before end');
        return;
      }
      fromInput?.classList.remove('input-error');
      toInput?.classList.remove('input-error');
      Viz.setCustomRange(fromTs, toTs);
      await Viz.computeActive(activeProfile);
      await Gallery.refreshAllExpanded(activeProfile);
    });
  }

  // Mode toggle
  if (modeToggle) {
    modeToggle.addEventListener('click', () => {
      const state = Viz.getState();
      Viz.setMode(!state.asciiMode);
      setAsciiMode(!state.asciiMode);
      // Re-render lastResult without recompute
      const updated = Viz.getState();
      if (updated.lastResult) {
        const container = Viz.getContainer() || document.getElementById('viz-lens-card-wrapper');
        if (container) renderLens(updated.lastResult, container);
      }
      Viz.persistPreferences(activeProfile);
    });
  }

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await Viz.computeActive(activeProfile);
      await Gallery.refreshAllExpanded(activeProfile);
    });
  }

  // Filter inputs (on Enter)
  function wireFilterInput(input, type) {
    if (!input) return;
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const value = input.value.trim();
      if (!value) return;
      Viz.addFilter(type, value);
      input.value = '';
      renderVizFilterBadges();
      await Viz.computeActive(activeProfile);
    });
  }
  wireFilterInput(filterService, 'service');
  wireFilterInput(filterProject, 'project');
  wireFilterInput(filterTags, 'tags');

  // Filter badge remove (delegated)
  if (activeFilters) {
    activeFilters.addEventListener('click', async (e) => {
      const btn = e.target.closest('.viz-badge-remove');
      if (!btn) return;
      const badge = btn.closest('.viz-badge');
      if (!badge) return;
      const type = badge.dataset.filterType;
      const value = badge.dataset.filterValue;
      Viz.removeFilter(type, value);
      renderVizFilterBadges();
      await Viz.computeActive(activeProfile);
    });
  }

  // Preset select
  if (presetSelect) {
    presetSelect.addEventListener('change', async () => {
      const id = presetSelect.value;
      if (!id) return;
      Viz.loadPreset(id);
      // Update all UI controls to reflect loaded preset
      const state = Viz.getState();
      if (lensSelect) lensSelect.value = state.activeLens;
      if (timeSelect) timeSelect.value = state.timeRange;
      if (state.timeRange === 'custom') {
        customRange?.classList.remove('hidden');
        if (fromInput && state.customFrom) fromInput.value = new Date(state.customFrom * 1000).toISOString().slice(0, 16);
        if (toInput && state.customTo) toInput.value = new Date(state.customTo * 1000).toISOString().slice(0, 16);
      } else {
        customRange?.classList.add('hidden');
      }
      renderVizFilterBadges();
      await Viz.computeActive(activeProfile);
    });
  }

  // Preset save
  if (presetSave) {
    presetSave.addEventListener('click', async () => {
      const name = await promptText('Preset name:');
      if (!name || !name.trim()) return;
      const result = await Viz.savePreset(activeProfile, name.trim());
      if (result === false) {
        showToast('Maximum presets reached — delete one first');
        return;
      }
      await refreshVizPresetList();
      showToast('Preset saved');
    });
  }

  // Preset delete
  if (presetDelete) {
    presetDelete.addEventListener('click', async () => {
      const id = presetSelect?.value;
      if (!id) return;
      await Viz.deletePreset(activeProfile, id);
      await refreshVizPresetList();
      showToast('Preset deleted');
    });
  }

  // Initial render of filter badges and preset list
  renderVizFilterBadges();
  refreshVizPresetList();

  // --- Gallery event delegation ---
  const galleryPanel = document.getElementById('viz-gallery-panel');
  if (galleryPanel) {
    // Card header click → expand/collapse + render
    galleryPanel.addEventListener('click', async (e) => {
      const header = e.target.closest('.viz-gallery-card-header');
      if (header) {
        const cardEl = header.closest('.viz-gallery-card');
        const cardId = cardEl?.dataset.cardId;
        if (!cardId) return;
        const cards = Gallery.getCards();
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        if (card.expanded) {
          Gallery.collapseCard(cardId);
        } else {
          Gallery.expandCard(cardId);
        }
        Gallery.renderGalleryPanel(galleryPanel);
        if (card.expanded) {
          await Gallery.renderCard(cardId, activeProfile);
        }
        return;
      }

      // Pill button click → setPrimaryAxis/setModifier + re-render
      const pill = e.target.closest('.viz-pill:not(.viz-pill-disabled)');
      if (pill) {
        const cardId = pill.dataset.cardId;
        const axis = pill.dataset.axis;
        const value = pill.dataset.value;
        if (!cardId || !axis || !value) return;
        // Check if it's a primary axis or modifier
        if (axis === 'layout' || axis === 'renderer' || axis === 'binding') {
          Gallery.setPrimaryAxis(cardId, axis, value);
        } else {
          Gallery.setModifier(cardId, axis, value);
        }
        Gallery.renderGalleryPanel(galleryPanel);
        await Gallery.renderCard(cardId, activeProfile);
        return;
      }

      // Adjust button click → toggleDrawer + re-render DOM
      const adjustBtn = e.target.closest('.viz-adjust-btn');
      if (adjustBtn) {
        const cardId = adjustBtn.dataset.cardId;
        if (!cardId) return;
        Gallery.toggleDrawer(cardId);
        Gallery.renderGalleryPanel(galleryPanel);
        return;
      }

      // Compare button click → toggleCompare
      const compareBtn = e.target.closest('.viz-compare-btn');
      if (compareBtn) {
        const cardId = compareBtn.dataset.cardId;
        if (!cardId) return;
        Gallery.toggleCompare(cardId);
        Gallery.renderGalleryPanel(galleryPanel);
        const cards = Gallery.getCards();
        const card = cards.find(c => c.id === cardId);
        if (card && card.expanded) {
          await Gallery.renderCard(cardId, activeProfile);
        }
        return;
      }
    });

    // Bind-to select change → setSecondaryBind + re-render
    galleryPanel.addEventListener('change', async (e) => {
      const select = e.target.closest('.viz-bind-select');
      if (select) {
        const cardId = select.dataset.cardId;
        const channel = select.dataset.channel;
        const dimension = select.value || null;
        if (!cardId || !channel) return;
        Gallery.setSecondaryBind(cardId, channel, dimension);
        Gallery.renderGalleryPanel(galleryPanel);
        await Gallery.renderCard(cardId, activeProfile);
      }
    });
  }
}

// ── Stream ────────────────────────────────────────────────────────────────────

async function loadStream() {
  const status = await Stream.getStatus(activeProfile);
  // Update metrics
  const eventsEl = document.getElementById('stream-metric-events');
  const sizeEl = document.getElementById('stream-metric-size');
  const sessionEl = document.getElementById('stream-metric-session');
  if (eventsEl) eventsEl.textContent = status.enabled ? '—' : 'off';
  if (sessionEl) sessionEl.textContent = status.lastEventTs ? 'active' : '—';

  // Task 30: Storage quota indicator
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const quota = est.quota || 0;
      const usage = est.usage || 0;
      if (sizeEl) {
        sizeEl.textContent = `${formatStreamSize(status.logSize || 0)} / ${formatStreamSize(quota)}`;
        if (quota > 0 && (usage / quota) > 0.8) {
          sizeEl.style.color = 'var(--warning)';
        } else {
          sizeEl.style.color = '';
        }
      }
    } else {
      if (sizeEl) sizeEl.textContent = status.logSize ? formatStreamSize(status.logSize) : '0 KB';
    }
  } catch {
    if (sizeEl) sizeEl.textContent = status.logSize ? formatStreamSize(status.logSize) : '0 KB';
  }

  // Load config into config panel
  if (status.enabled) {
    const config = await Stream.getConfig(activeProfile);
    const cfgEvents = document.getElementById('cfg-snapshot-events');
    const cfgMinutes = document.getElementById('cfg-snapshot-minutes');
    const cfgDey = document.getElementById('cfg-dey-interval');
    const cfgGap = document.getElementById('cfg-gap-threshold');
    const cfgZero = document.getElementById('cfg-zero-mode');
    if (cfgEvents) cfgEvents.value = config.snapshot_events;
    if (cfgMinutes) cfgMinutes.value = config.snapshot_minutes;
    if (cfgDey) cfgDey.value = config.dey_interval;
    if (cfgGap) cfgGap.value = config.gap_threshold;
    if (cfgZero) cfgZero.value = config.zero_activity_mode;

    // Task 37: Populate Dey weights grid
    const deyGrid = document.getElementById('dey-weights-grid');
    if (deyGrid && config.dey_sources) {
      // Clear existing rows (keep header)
      const existingInputRows = deyGrid.querySelectorAll('.dey-weight-row');
      existingInputRows.forEach(r => r.remove());
      const weights = config.dey_weights || {};
      for (const source of config.dey_sources) {
        const w = weights[source] || { i: 0, s: 0, f: 0 };
        const rowHtml = `<span class="dey-weight-row">${source.replace(/_/g, ' ')}</span>` +
          `<input class="dey-weight-row" type="number" step="0.1" min="-1" max="1" value="${w.i}" style="width:50px" data-source="${source}" data-dim="i">` +
          `<input class="dey-weight-row" type="number" step="0.1" min="-1" max="1" value="${w.s}" style="width:50px" data-source="${source}" data-dim="s">` +
          `<input class="dey-weight-row" type="number" step="0.1" min="-1" max="1" value="${w.f}" style="width:50px" data-source="${source}" data-dim="f">`;
        deyGrid.insertAdjacentHTML('beforeend', rowHtml);
      }
    }

    // Task 29: Compute regeneration from D events over last 7 days
    try {
      const now = Math.floor(Date.now() / 1000);
      const regenResult = await Stream.replay(activeProfile, now - 7 * 86400, now, 'burroughs', { op: 'D' }, { limit: 10000 });
      const deyEvents = regenResult?.data?.rows || [];
      const regen = computeRegeneration(deyEvents);
      const fatigueEl = document.getElementById('regen-fatigue');
      const elasticityEl = document.getElementById('regen-elasticity');
      const crystalEl = document.getElementById('regen-crystal');
      if (fatigueEl) fatigueEl.textContent = regen.fatigue.toFixed(2);
      if (elasticityEl) elasticityEl.textContent = regen.elasticity.toFixed(2);
      if (crystalEl) {
        const topProjects = Object.entries(regen.crystallization)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([p, v]) => `${p}: ${v}`)
          .join(', ');
        crystalEl.textContent = topProjects || '—';
      }
      // Show secondary column
      document.getElementById('stream-col-secondary')?.classList.remove('hidden');
    } catch {
      // Non-critical: regen is informational
    }
  }

  // Load the active lens
  await loadStreamLens();
}

function updateStreamUI() {
  Stream.getStatus(activeProfile).then(status => {
    const topbar = document.getElementById('stream-topbar');
    const navStream = document.getElementById('nav-stream');
    const toggleBtn = document.getElementById('btn-stream-toggle-top');
    if (topbar) topbar.classList.toggle('hidden', !status.enabled);
    if (navStream) navStream.classList.toggle('hidden', !status.enabled);
    if (toggleBtn) toggleBtn.classList.toggle('active', status.active);
  }).catch(() => {});
}

// ── Works Bridge UI ──────────────────────────────────────────────────────────

let bridgeEnabled = false;

function updateBridgeUI() {
  const icon = document.getElementById('btn-bridge-icon');
  const statusEl = document.getElementById('bridge-status-indicator');
  const toggleBtn = document.getElementById('btn-bridge-toggle');
  
  if (icon) {
    icon.style.color = bridgeEnabled ? '#3fb950' : '#f85149';
    icon.style.textShadow = bridgeEnabled ? '0 0 6px #3fb950' : 'none';
  }
  if (statusEl) {
    statusEl.textContent = bridgeEnabled ? 'Active' : 'Inactive';
    statusEl.style.color = bridgeEnabled ? '#3fb950' : '#f85149';
  }
  if (toggleBtn) {
    toggleBtn.textContent = bridgeEnabled ? 'Disable Bridge' : 'Enable Bridge';
  }
}

document.getElementById('btn-bridge-icon')?.addEventListener('click', () => {
  showSection('bridge');
});

document.getElementById('btn-bridge-toggle')?.addEventListener('click', () => {
  if (bridgeEnabled) {
    closeWorksListener();
    bridgeEnabled = false;
  } else {
    initWorksListener({
      getTasksFn: (profile) => Tasks.getTasks(profile),
      getTimeFn: (profile) => Time.getIntervals(profile),
      getJournalFn: (profile) => Journal.getEntries(profile),
      getLedgerFn: (profile) => Ledger.getTransactions(profile),
      streamBus: Stream.bus,
    });
    bridgeEnabled = true;
  }
  updateBridgeUI();
});

document.getElementById('btn-bridge-test')?.addEventListener('click', () => {
  const log = document.getElementById('bridge-log');
  if (log) {
    const ts = new Date().toLocaleTimeString();
    log.innerHTML = `<p style="color:var(--success);">[${ts}] Bridge test: listener is ${bridgeEnabled ? 'active' : 'inactive'}</p>` + log.innerHTML;
  }
});

function formatStreamSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Live Mini Waveform ───────────────────────────────────────────────────────

const _waveformBuffer = [];
const WAVEFORM_MAX = 30;

function updateMiniWaveform() {
  const canvas = document.getElementById('stream-mini-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = 60;
  const h = 16;
  ctx.clearRect(0, 0, w, h);

  if (_waveformBuffer.length < 2) return;

  ctx.beginPath();
  ctx.strokeStyle = '#3fb950';
  ctx.lineWidth = 1;

  for (let i = 0; i < _waveformBuffer.length; i++) {
    const x = i * (w / WAVEFORM_MAX);
    const y = h - (_waveformBuffer[i] * 14) - 1;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function initMiniWaveform() {
  try {
    Stream.bus.subscribe({ op: 'D' }, (event) => {
      const intensity = event.ctx?.intensity;
      if (intensity == null) return;
      _waveformBuffer.push(intensity);
      if (_waveformBuffer.length > WAVEFORM_MAX) {
        _waveformBuffer.shift();
      }
      updateMiniWaveform();
    });
  } catch (err) {
    // Non-critical: waveform is cosmetic
  }
}

// Stream panel event wiring
document.getElementById('btn-stream-toggle-top')?.addEventListener('click', async () => {
  const status = await Stream.getStatus(activeProfile);
  await Stream.toggle(activeProfile, !status.active);
  updateStreamUI();
  showToast(status.active ? 'Stream paused' : 'Stream active');
});

document.getElementById('btn-stream-config')?.addEventListener('click', () => {
  document.getElementById('stream-config-panel')?.classList.toggle('hidden');
});

document.getElementById('btn-stream-filter')?.addEventListener('click', () => {
  document.getElementById('stream-filter-panel')?.classList.toggle('hidden');
});

document.getElementById('btn-stream-ascii')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-stream-ascii');
  const isAscii = btn?.classList.toggle('active');
  setAsciiMode(isAscii);
  if (activeSection === 'stream') loadStreamLens();
});

document.getElementById('btn-stream-config-save')?.addEventListener('click', async () => {
  const config = {
    snapshot_events: parseInt(document.getElementById('cfg-snapshot-events')?.value) || 1000,
    snapshot_minutes: parseInt(document.getElementById('cfg-snapshot-minutes')?.value) || 30,
    dey_interval: parseInt(document.getElementById('cfg-dey-interval')?.value) || 60,
    gap_threshold: parseInt(document.getElementById('cfg-gap-threshold')?.value) || 300,
    zero_activity_mode: document.getElementById('cfg-zero-mode')?.value || 'suppress',
  };
  await Stream.setConfig(activeProfile, config);
  showToast('Stream config saved');
});

document.getElementById('btn-stream-reset')?.addEventListener('click', async () => {
  if (!await confirm('Reset stream? This will delete all stream data for this profile. This cannot be undone.')) return;
  await Stream.reset(activeProfile, activeProfile);
  showToast('Stream reset');
  await loadStream();
});

// Task 35: Corruption repair UI
document.getElementById('btn-stream-verify')?.addEventListener('click', async () => {
  const resultEl = document.getElementById('stream-verify-result');
  if (resultEl) resultEl.textContent = 'Scanning…';
  try {
    const { validateLog, truncate, readAll } = await import('./services/stream/log.js');
    const result = await validateLog(activeProfile);
    if (result.valid) {
      if (resultEl) resultEl.textContent = `✓ Log valid (${result.lastValidLine} lines)`;
      resultEl.style.color = 'var(--success)';
    } else {
      if (resultEl) resultEl.textContent = `✗ ${result.errors.length} error(s) found`;
      resultEl.style.color = 'var(--error)';
      if (await confirm(`Found ${result.errors.length} corrupted line(s). Truncate to last valid line (line ${result.lastValidLine})?`)) {
        const content = await readAll(activeProfile);
        const lines = content.split('\n');
        const validContent = lines.slice(0, result.lastValidLine).join('\n') + '\n';
        const byteOffset = new TextEncoder().encode(validContent).length;
        await truncate(activeProfile, byteOffset);
        if (resultEl) resultEl.textContent = `Repaired — truncated to ${result.lastValidLine} lines`;
        resultEl.style.color = 'var(--success)';
        showToast('Log repaired');
      }
    }
  } catch (err) {
    if (resultEl) { resultEl.textContent = `Error: ${err.message}`; resultEl.style.color = 'var(--error)'; }
  }
});

// Task 36: Backup via File System Access API
document.getElementById('btn-stream-backup')?.addEventListener('click', async () => {
  try {
    const { readAll } = await import('./services/stream/log.js');
    const content = await readAll(activeProfile);

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `stream_${activeProfile}_${new Date().toISOString().slice(0,10)}.log`,
        types: [{ description: 'Stream Log', accept: { 'text/plain': ['.log'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      showToast('Stream backed up to file');
    } else {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stream_${activeProfile}_${new Date().toISOString().slice(0,10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Stream downloaded');
    }
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Backup failed: ' + err.message, 'warning');
  }
});

// Task 37: Dey configuration UI — toggle
document.getElementById('btn-stream-dey-config-toggle')?.addEventListener('click', () => {
  const panel = document.getElementById('stream-dey-config');
  const btn = document.getElementById('btn-stream-dey-config-toggle');
  if (panel) {
    panel.classList.toggle('hidden');
    if (btn) btn.textContent = panel.classList.contains('hidden') ? '▸ Dey Signal Configuration' : '▾ Dey Signal Configuration';
  }
});

// Task 37: Dey weights save
document.getElementById('btn-dey-weights-save')?.addEventListener('click', async () => {
  const inputs = document.querySelectorAll('#dey-weights-grid input[type="number"]');
  const newWeights = {};
  inputs.forEach(input => {
    const source = input.dataset.source;
    const dim = input.dataset.dim;
    if (!newWeights[source]) newWeights[source] = {};
    newWeights[source][dim] = parseFloat(input.value) || 0;
  });
  await Stream.setConfig(activeProfile, { dey_weights: newWeights });
  showToast('Dey weights saved');
});

// Task 37: Dey weights reset
document.getElementById('btn-dey-weights-reset')?.addEventListener('click', async () => {
  const { DEFAULTS } = await import('./services/stream/config.js');
  const grid = document.getElementById('dey-weights-grid');
  if (grid) {
    const inputs = grid.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
      const source = input.dataset.source;
      const dim = input.dataset.dim;
      if (DEFAULTS.dey_weights[source] && DEFAULTS.dey_weights[source][dim] != null) {
        input.value = DEFAULTS.dey_weights[source][dim];
      }
    });
  }
  await Stream.setConfig(activeProfile, { dey_weights: { ...DEFAULTS.dey_weights } });
  showToast('Dey weights reset to defaults');
});

document.getElementById('btn-stream-export')?.addEventListener('click', async () => {
  const json = await Stream.exportJSON(activeProfile, null, null);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stream_${activeProfile}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Stream exported');
});

document.getElementById('stream-lens-select')?.addEventListener('change', () => loadStreamLens());
document.getElementById('stream-time-range')?.addEventListener('change', () => {
  const val = document.getElementById('stream-time-range')?.value;
  const customRow = document.getElementById('stream-custom-range');
  if (customRow) customRow.classList.toggle('hidden', val !== 'custom');
  if (val !== 'custom') loadStreamLens();
});

// Task 26: Filter panel apply/save/clear
document.getElementById('btn-stream-filter-apply')?.addEventListener('click', () => {
  const service = document.getElementById('stream-filter-service')?.value || '';
  const project = document.getElementById('stream-filter-project')?.value?.trim() || '';
  const tags = document.getElementById('stream-filter-tags')?.value?.trim() || '';

  const serviceOpMap = { task: 'T', timew: 'B', jrnl: 'A', ldgr: 'T', list: 'M', comm: 'A', questions: 'M', attr: 'M' };

  streamActiveFilter = {
    op: service ? (serviceOpMap[service] || null) : null,
    object: null,
    prof: activeProfile,
    proj: project || null,
    tags: tags ? tags.split(',').map(t => t.trim()) : null,
  };
  loadStreamLens();
});

document.getElementById('btn-stream-filter-clear')?.addEventListener('click', () => {
  const svcEl = document.getElementById('stream-filter-service');
  const projEl = document.getElementById('stream-filter-project');
  const tagsEl = document.getElementById('stream-filter-tags');
  if (svcEl) svcEl.value = '';
  if (projEl) projEl.value = '';
  if (tagsEl) tagsEl.value = '';
  streamActiveFilter = null;
  loadStreamLens();
});

document.getElementById('btn-stream-filter-save')?.addEventListener('click', async () => {
  const name = await promptText('Filter name:');
  if (!name) return;
  const service = document.getElementById('stream-filter-service')?.value || '';
  const project = document.getElementById('stream-filter-project')?.value?.trim() || '';
  const tags = document.getElementById('stream-filter-tags')?.value?.trim() || '';
  const serviceOpMap = { task: 'T', timew: 'B', jrnl: 'A', ldgr: 'T', list: 'M', comm: 'A', questions: 'M', attr: 'M' };
  const filter = {
    op: service ? (serviceOpMap[service] || null) : null,
    object: null,
    prof: activeProfile,
    proj: project || null,
    tags: tags ? tags.split(',').map(t => t.trim()) : null,
  };
  const config = await Stream.getConfig(activeProfile);
  const savedFilters = config.stream_saved_filters || [];
  savedFilters.push({ name, filter });
  await Stream.setConfig(activeProfile, { stream_saved_filters: savedFilters });
  showToast(`Filter "${name}" saved`);
});

// Task 27: Compare bar
document.getElementById('btn-stream-compare')?.addEventListener('click', () => {
  document.getElementById('stream-compare-bar')?.classList.toggle('hidden');
  loadStreamLens();
});

document.getElementById('btn-stream-compare-close')?.addEventListener('click', () => {
  document.getElementById('stream-compare-bar')?.classList.add('hidden');
  loadStreamLens();
});

document.getElementById('stream-compare-range')?.addEventListener('change', () => {
  if (!document.getElementById('stream-compare-bar')?.classList.contains('hidden')) {
    loadStreamLens();
  }
});

// Task 28: Custom range apply
document.getElementById('btn-stream-custom-apply')?.addEventListener('click', () => {
  const fromVal = document.getElementById('stream-date-from')?.value;
  const toVal = document.getElementById('stream-date-to')?.value;
  if (fromVal) streamCustomFrom = Math.floor(new Date(fromVal).getTime() / 1000);
  if (toVal) streamCustomTo = Math.floor(new Date(toVal + 'T23:59:59').getTime() / 1000);
  loadStreamLens();
});

async function loadStreamLens() {
  const lens = document.getElementById('stream-lens-select')?.value || 'burroughs';
  const range = document.getElementById('stream-time-range')?.value || 'session';
  const container = document.getElementById('stream-lens-view');
  if (!container) return;

  const lensLabel = document.getElementById('stream-metric-lens');
  if (lensLabel) lensLabel.textContent = lens;

  // Compute time range
  const now = Math.floor(Date.now() / 1000);
  let fromTs = 0;
  if (range === 'custom' && streamCustomFrom) {
    fromTs = streamCustomFrom;
  } else if (range === 'today') fromTs = now - 86400;
  else if (range === 'week') fromTs = now - 604800;
  else if (range === 'session') fromTs = now - 3600;

  const toTs = (range === 'custom' && streamCustomTo) ? streamCustomTo : now;

  try {
    container.innerHTML = '<div class="skeleton-msg">Computing…</div>';
    const result = await Stream.replay(activeProfile, fromTs, toTs, lens, streamActiveFilter, {});

    // Task 27: Comparison mode
    const compareBar = document.getElementById('stream-compare-bar');
    if (compareBar && !compareBar.classList.contains('hidden')) {
      const compareRange = document.getElementById('stream-compare-range')?.value || 'yesterday';
      let compFrom, compTo;
      const duration = toTs - fromTs;
      if (compareRange === 'yesterday') {
        compFrom = fromTs - 86400;
        compTo = toTs - 86400;
      } else if (compareRange === 'last-week') {
        compFrom = fromTs - 604800;
        compTo = toTs - 604800;
      } else {
        // custom: use same duration shifted back by duration
        compFrom = fromTs - duration;
        compTo = fromTs;
      }
      const compResult = await Stream.replay(activeProfile, compFrom, compTo, lens, streamActiveFilter, {});
      renderComparison(result, compResult, container);
    } else {
      renderLens(result, container);
    }
  } catch (err) {
    container.innerHTML = `<div class="skeleton-msg" style="color:var(--error)">Error: ${err.message}</div>`;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch(err => {
  document.body.innerHTML = `<div style="padding:20px;color:#f85149;font-family:monospace">Boot error: ${err.message}</div>`;
  console.error(err);
});
