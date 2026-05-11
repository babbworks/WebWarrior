// Section render functions — DOM updates for all sections

import { urgencyLevel } from '../core/urgency.js';
import { formatDuration, intervalDuration } from '../core/time.js';
import { groupByDate } from '../core/journal.js';
import { formatAmount, accountColor } from '../services/ledger/index.js';

// ── Tasks ────────────────────────────────────────────────────────────────────

export function renderTasks(tasks, { filterText = '', groupByProject = false, showAnnotations = false, bulkSelected = new Set(), onAction } = {}) {
  const list = document.getElementById('task-list');
  if (!list) return;

  const filtered = filterText
    ? tasks.filter(t =>
        t.description.toLowerCase().includes(filterText.toLowerCase()) ||
        (t.project || '').toLowerCase().includes(filterText.toLowerCase()) ||
        (t.tags || []).join(' ').toLowerCase().includes(filterText.toLowerCase())
      )
    : tasks;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="skeleton-msg">No tasks. Add one above.</div>';
    return;
  }

  if (groupByProject) {
    const groups = groupTasksByProject(filtered);
    list.innerHTML = groups.map(g => renderProjectGroup(g, showAnnotations, bulkSelected, onAction)).join('');
  } else {
    list.innerHTML = filtered.map(t => renderTaskRow(t, showAnnotations, bulkSelected, onAction)).join('');
  }
}

export function renderDoneTasks(tasks) {
  const list = document.getElementById('task-done-list');
  if (!list) return;
  if (tasks.length === 0) { list.innerHTML = '<div class="skeleton-msg">No completed tasks.</div>'; return; }
  list.innerHTML = tasks.map(t => `
    <div class="task-row task-done-row" data-uuid="${t.uuid}">
      <span class="task-desc task-done-desc">${esc(t.description)}</span>
      ${t.project ? `<span class="task-project-badge">${esc(t.project)}</span>` : ''}
      <span class="task-meta-muted">${fmtDate(t.end)}</span>
    </div>
  `).join('');
}

function groupTasksByProject(tasks) {
  const map = new Map();
  map.set('', []);
  for (const t of tasks) {
    const p = t.project || '';
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(t);
  }
  const result = [];
  for (const [proj, items] of map) {
    if (items.length > 0) result.push({ project: proj, tasks: items });
  }
  return result.sort((a, b) => a.project.localeCompare(b.project));
}

function renderProjectGroup(group, showAnnotations, bulkSelected, onAction) {
  const groupLabel = group.project || 'Ungrouped';
  const header = `<div class="task-group-header">${esc(groupLabel)} <span class="task-group-count">${group.tasks.length}</span></div>`;
  const rows = group.tasks.map(t => renderTaskRow(t, showAnnotations, bulkSelected, onAction)).join('');
  return header + rows;
}

function renderTaskRow(t, showAnnotations, bulkSelected, onAction) {
  const level = urgencyLevel(t.urgency);
  const isActive = t.status === 'active';
  const isSelected = bulkSelected?.has(t.uuid);
  const due = t.due ? dueBadge(t.due) : '';
  const tags = (t.tags || []).map(tag => `<span class="task-tag">${esc(tag)}</span>`).join('');
  const pri = t.priority ? `<span class="task-priority pri-${t.priority.toLowerCase()}">${t.priority}</span>` : '';
  const anns = showAnnotations && t.annotations?.length
    ? `<div class="task-annotations">${t.annotations.map((a, i) => `
    <div class="task-ann" data-ann-uuid="${t.uuid}" data-ann-idx="${i}">
      <span class="task-ann-text">↳ ${esc(a.description)}</span>
      <span class="ann-hover-actions">
        <button class="ann-hover-btn" data-ann-action="to-task" data-uuid="${t.uuid}" data-idx="${i}">+ task</button>
        <button class="ann-hover-btn" data-ann-action="to-journal" data-uuid="${t.uuid}" data-idx="${i}">+ journal</button>
        <button class="ann-hover-btn" data-ann-action="to-community" data-uuid="${t.uuid}" data-idx="${i}">+ community</button>
        <button class="ann-hover-btn" data-ann-action="to-list" data-uuid="${t.uuid}" data-idx="${i}">+ list</button>
      </span>
    </div>`).join('')}</div>`
    : '';

  return `
    <div class="task-row ${isActive ? 'task-active' : ''} urgency-${level}" data-uuid="${t.uuid}" data-action="open-drawer">
      <span class="task-urgency-bar urgency-bar-${level}"></span>
      <input type="checkbox" class="task-checkbox" data-uuid="${t.uuid}" data-action="select" ${isSelected ? 'checked' : ''}>
      <span class="task-row-left">
        ${t.project ? `<span class="task-project-badge">${esc(t.project)}</span>` : ''}
        <span class="task-desc">${esc(t.description)}</span>
      </span>
      <span class="task-row-mid">
        ${tags}${pri}${due}
      </span>
      <span class="task-row-triggers task-inline-trigger">
        <button class="task-action-btn" data-action="inline-annotate" data-uuid="${t.uuid}">+ annotate</button>
        <button class="task-action-btn" data-action="inline-journal" data-uuid="${t.uuid}">→ journal</button>
        <button class="task-action-btn" data-action="inline-dep" data-uuid="${t.uuid}">+ dep</button>
      </span>
      <span class="task-row-right">
        ${isActive
          ? `<button class="task-action-btn task-action-word" data-action="stop" data-uuid="${t.uuid}">■ stop</button>`
          : `<button class="task-action-btn task-action-word" data-action="start" data-uuid="${t.uuid}">▶ start</button>`
        }
        <button class="task-action-btn task-action-word" data-action="done" data-uuid="${t.uuid}">✓ done</button>
        <button class="task-action-btn task-action-word" data-action="inline-comm" data-uuid="${t.uuid}">◎ comm</button>
        <button class="task-action-btn task-action-icon task-action-delete" data-action="delete" data-uuid="${t.uuid}" title="Delete">●</button>
      </span>
    </div>
    ${anns}
    <div class="task-inline-drop" data-drop="task-${t.uuid}"></div>
  `;
}

// ── Time ─────────────────────────────────────────────────────────────────────

export function renderTimeToday(totalSeconds, activeInterval) {
  const el = document.getElementById('time-today');
  if (!el) return;
  const dur = formatDuration(totalSeconds);
  const activeHtml = activeInterval
    ? `<span class="time-active-badge" id="time-active-badge">● ${(activeInterval.tags || []).join(' ') || 'tracking'}</span>`
    : '';
  el.innerHTML = `<span class="time-today-big">${dur}</span> <span class="time-today-label">today</span> ${activeHtml}`;
}

export function renderWeekChart(days) {
  const el = document.getElementById('time-week');
  if (!el) return;
  const max = Math.max(...days.map(d => d.seconds), 1);
  el.innerHTML = `<div class="week-chart">${days.map(d => {
    const pct = Math.round((d.seconds / max) * 100);
    const label = formatDuration(d.seconds);
    const isToday = d.date === new Date().toDateString();
    return `<div class="week-bar-col ${isToday ? 'week-bar-today' : ''}">
      <div class="week-bar-wrap">
        <div class="week-bar" style="height:${pct}%"></div>
      </div>
      <div class="week-bar-label">${d.label}</div>
      <div class="week-bar-val">${label !== '0m' ? label : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

export function renderIntervals(intervals) {
  const el = document.getElementById('time-intervals');
  if (!el) return;
  if (intervals.length === 0) { el.innerHTML = '<div class="skeleton-msg">No time entries.</div>'; return; }

  // Group by calendar date
  const groups = new Map();
  for (const i of intervals) {
    const day = new Date(i.start).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(i);
  }

  el.innerHTML = [...groups.entries()].map(([day, group]) => {
    const dayTotal = group.reduce((s, i) => s + intervalDuration(i), 0);
    const dateLabel = new Date(day).toLocaleDateString('en', { weekday:'long', month:'short', day:'numeric' });
    return `
      <div class="time-date-group" data-day="${esc(day)}">
        <div class="time-date-header" data-action="toggle-time-group" data-day="${esc(day)}">
          <span class="journal-date-arrow">▾</span>
          <span class="time-date-label">${dateLabel}</span>
          <span class="journal-date-count">${group.length}</span>
          <span class="time-day-total">${formatDuration(dayTotal)}</span>
        </div>
        <div class="time-date-entries">
          ${group.map(i => renderIntervalRow(i)).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderIntervalRow(i) {
  const active  = !i.end;
  const dur     = formatDuration(intervalDuration(i));
  const tags    = (i.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`).join('') || '<span style="color:var(--muted);font-size:11px">untagged</span>';
  const startT  = new Date(i.start).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const endT    = i.end ? new Date(i.end).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : 'now';
  const timeRange = `${startT} – ${endT}`;

  return `
    <div class="time-interval ${active ? 'time-interval-active' : ''}" data-id="${i.id}" data-action="open-time-drawer">
      <div class="time-interval-main">
        <span class="time-interval-tags-row">${tags}</span>
        <span class="time-interval-range">${timeRange}</span>
        <span class="time-interval-dur ${active ? 'time-dur-active' : ''}">${active ? '● ' : ''}${dur}</span>
        <span class="time-interval-expand" title="Edit">⊞</span>
      </div>
      ${i.annotation ? `<div class="time-interval-ann">${esc(i.annotation)}</div>` : ''}
      <div class="time-interval-actions">
        ${active
          ? `<button class="jrnl-action-pill" data-action="stop-interval" data-id="${i.id}">■ stop</button>`
          : ''}
        <button class="jrnl-action-pill" data-action="edit-interval"      data-id="${i.id}">✎ edit</button>
        <button class="jrnl-action-pill" data-action="time-journal"       data-id="${i.id}">→ journal</button>
        <button class="jrnl-action-pill" data-action="time-community"     data-id="${i.id}">→ community</button>
        <button class="jrnl-action-pill jrnl-pill-danger" data-action="delete-interval" data-id="${i.id}">✗ delete</button>
      </div>
      <div class="jrnl-inline-panel" data-panel="time-${i.id}"></div>
    </div>`;
}

export function renderTagSummary(tagSummary) {
  const el = document.getElementById('time-tag-summary');
  if (!el) return;
  if (!tagSummary.length) { el.innerHTML = ''; return; }
  el.innerHTML = tagSummary.slice(0, 10).map(({ tag, seconds }) =>
    `<span class="time-tag-chip" data-tag-filter="${esc(tag)}">${esc(tag)} <strong>${formatDuration(seconds)}</strong></span>`
  ).join('');
}

// ── Journal ──────────────────────────────────────────────────────────────────

const JOURNAL_TRUNCATE = 300;

export function renderJournal(entries, { filterText = '', filterMode = 'all', showMd = false, showArchived = false } = {}) {
  const list = document.getElementById('journal-list');
  if (!list) return;

  let filtered = filterText
    ? entries.filter(e => e.body.toLowerCase().includes(filterText.toLowerCase()) ||
        (e.project || '').toLowerCase().includes(filterText.toLowerCase()))
    : entries;

  if (filterMode === 'annotated')  filtered = filtered.filter(e => (e.annotations || []).length > 0);
  if (filterMode === 'rejournaled') filtered = filtered.filter(e => e.body.includes('[task:'));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="skeleton-msg">No journal entries.</div>';
    return;
  }

  const groups = groupByDate(filtered);
  list.innerHTML = groups.map(g => `
    <div class="journal-date-group" data-date="${g.date}">
      <div class="journal-date-header" data-action="toggle-group" data-date="${g.date}">
        <span class="journal-date-arrow">▾</span>
        <span class="journal-date-label">${fmtDateHeader(g.date)}</span>
        <span class="journal-date-count">${g.entries.length}</span>
      </div>
      <div class="journal-date-entries">
        ${g.entries.map(e => renderJournalEntry(e, showMd)).join('')}
      </div>
    </div>
  `).join('');
}

function renderJournalEntry(e, showMd) {
  const rawBody = e.body || '';
  const truncated = rawBody.length > JOURNAL_TRUNCATE;
  const displayBody = truncated ? rawBody.slice(0, JOURNAL_TRUNCATE) : rawBody;
  const bodyHtml = showMd
    ? markdownLite(esc(displayBody))
    : esc(displayBody).replace(/\n/g, '<br>');
  const fullBodyHtml = showMd
    ? markdownLite(esc(rawBody))
    : esc(rawBody).replace(/\n/g, '<br>');

  const anns = (e.annotations || []).map((a, i) =>
    `<div class="journal-annotation" data-jrnl-id="${e.id}" data-ann-idx="${i}">
      <span class="journal-ann-text">↳ ${esc(a.text)} <span class="journal-ann-date">${fmtTime(a.entry)}</span></span>
      <span class="ann-hover-actions">
        <button class="ann-hover-btn" data-ann-action="jrnl-to-task" data-id="${e.id}" data-idx="${i}">+ task</button>
        <button class="ann-hover-btn" data-ann-action="jrnl-to-journal" data-id="${e.id}" data-idx="${i}">+ journal</button>
        <button class="ann-hover-btn" data-ann-action="jrnl-to-community" data-id="${e.id}" data-idx="${i}">+ community</button>
        <button class="ann-hover-btn" data-ann-action="jrnl-to-list" data-id="${e.id}" data-idx="${i}">+ list</button>
      </span>
    </div>`
  ).join('');

  const meta = [
    e.project  ? `<span class="task-project-badge">${esc(e.project)}</span>` : '',
    ...(e.tags || []).map(t => `<span class="task-tag">${esc(t)}</span>`),
    e.priority ? `<span class="task-priority pri-${e.priority.toLowerCase()}">${e.priority}</span>` : '',
    e.archived ? `<span class="journal-archived-badge">archived</span>` : '',
  ].filter(Boolean).join('');

  return `<div class="journal-entry${e.archived ? ' journal-entry-archived' : ''}" data-id="${e.id}">
    <div class="journal-entry-time">${fmtTime(e.date)}</div>
    <div class="journal-entry-body" data-full="${esc(fullBodyHtml)}" data-truncated="${truncated}">${bodyHtml}</div>
    ${truncated ? `<button class="journal-show-more" data-action="expand-entry" data-id="${e.id}">show more</button>` : ''}
    ${meta ? `<div class="journal-entry-meta">${meta}</div>` : ''}
    ${anns ? `<div class="journal-annotations">${anns}</div>` : ''}
    <div class="journal-entry-actions">
      <button class="jrnl-action-pill" data-action="annotate-entry" data-id="${e.id}">+ annotate</button>
      <button class="jrnl-action-pill" data-action="new-entry-from" data-id="${e.id}">+ new entry</button>
      <button class="jrnl-action-pill" data-action="community-entry" data-id="${e.id}">→ community</button>
      <button class="jrnl-action-pill" data-action="metadata-entry" data-id="${e.id}">metadata</button>
      <button class="jrnl-action-pill jrnl-pill-muted" data-action="archive-entry" data-id="${e.id}">${e.archived ? '# unarchive' : '# archive'}</button>
      <button class="jrnl-action-pill jrnl-pill-danger" data-action="delete-entry" data-id="${e.id}"># delete</button>
    </div>
    <div class="jrnl-inline-panel" data-panel="${e.id}"></div>
  </div>`;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export function renderBalance(balances) {
  const el = document.getElementById('hledger-output');
  if (!el) return;
  if (balances.length === 0) { el.innerHTML = '<div class="skeleton-msg">No transactions yet.</div>'; return; }
  el.innerHTML = `<div class="ledger-balance-list">${balances.map(b => `
    <div class="ledger-balance-row">
      <span class="ledger-account" style="color:${accountColor(b?.account || '')}">${esc(b?.account || '')}</span>
      <span class="ledger-amount" style="color:${safeNumber(b?.balance) >= 0 ? 'var(--success)' : 'var(--error)'}">
        ${formatAmount(safeNumber(b?.balance))}
      </span>
    </div>
  `).join('')}</div>`;
}

export function renderRegister(rows) {
  const el = document.getElementById('hledger-output');
  if (!el) return;
  if (rows.length === 0) { el.innerHTML = '<div class="skeleton-msg">No transactions.</div>'; return; }
  el.innerHTML = `<div class="ledger-register-list">${rows.map(r => `
    <div class="ledger-register-row">
      <span class="ledger-reg-date">${esc(r?.date || '')}</span>
      <span class="ledger-reg-desc">${esc(r?.description || '')}</span>
      <span class="ledger-account" style="color:${accountColor(r?.account || '')}">${esc(r?.account || '')}</span>
      <span class="ledger-amount" style="color:${safeNumber(r?.amount) >= 0 ? 'var(--success)' : 'var(--error)'}">
        ${formatAmount(safeNumber(r?.amount))}
      </span>
    </div>
  `).join('')}</div>`;
}

export function renderIncomeReport(report) {
  const el = document.getElementById('hledger-output');
  if (!el) return;
  el.innerHTML = `<div class="ledger-income-report">
    <div style="margin-bottom:8px;font-size:11px;color:var(--muted)">Income Statement</div>
    ${report.income.length ? `<div class="ledger-section-header">Income</div>
      ${report.income.map(r => `<div class="ledger-balance-row">
        <span class="ledger-account" style="color:var(--clr-time)">${esc(r.account)}</span>
        <span class="ledger-amount" style="color:var(--success)">${formatAmount(r.balance)}</span>
      </div>`).join('')}` : ''}
    ${report.expenses.length ? `<div class="ledger-section-header" style="margin-top:8px">Expenses</div>
      ${report.expenses.map(r => `<div class="ledger-balance-row">
        <span class="ledger-account" style="color:var(--warning)">${esc(r.account)}</span>
        <span class="ledger-amount" style="color:var(--error)">${formatAmount(r.balance)}</span>
      </div>`).join('')}` : ''}
    <div class="ledger-balance-row" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <span style="color:var(--muted)">Net</span>
      <span class="ledger-amount" style="color:${report.net >= 0 ? 'var(--success)' : 'var(--error)'}">${formatAmount(report.net)}</span>
    </div>
  </div>`;
}

export function renderTransactions(txns) {
  const el = document.getElementById('ledger-recent');
  if (!el) return;
  if (txns.length === 0) { el.innerHTML = '<div class="skeleton-msg">No transactions.</div>'; return; }

  // Group by date
  const groups = new Map();
  for (const t of txns) {
    const dateKey = t?.date || 'undated';
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(t || {});
  }

  el.innerHTML = [...groups.entries()].map(([date, group]) => {
    const dayNet = group.reduce((sum, t) => {
      const postings = Array.isArray(t.postings) ? t.postings : [];
      return sum + postings
        .filter(p => !String(p?.account || '').startsWith('equity:'))
        .reduce((s, p) => s + safeNumber(p?.amount), 0);
    }, 0);
    const netColor = dayNet >= 0 ? 'var(--success)' : 'var(--error)';
    return `
      <div class="ledger-date-group" data-date="${date}">
        <div class="ledger-date-header" data-action="toggle-ledger-group" data-date="${date}">
          <span class="journal-date-arrow">▾</span>
          <span class="ledger-date-label">${fmtDateHeader(date)}</span>
          <span class="ledger-date-count">${group.length}</span>
          <span class="ledger-day-net" style="color:${netColor}">${dayNet >= 0 ? '+' : ''}${formatAmount(dayNet)}</span>
        </div>
        <div class="ledger-date-entries">
          ${group.map(t => renderTxnRow(t)).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderTxnRow(t) {
  const postings = Array.isArray(t?.postings) ? t.postings : [];
  const postingRows = postings.length
    ? postings.map(p => `
    <div class="ledger-posting-row">
      <span class="ledger-posting-account" style="color:${accountColor(p?.account || '')}">${esc(p?.account || '')}</span>
      <span class="ledger-posting-amount" style="color:${safeNumber(p?.amount) >= 0 ? 'var(--success)' : 'var(--error)'}">${formatAmount(safeNumber(p?.amount))}</span>
      ${p?.comment ? `<span class="ledger-posting-comment">; ${esc(p.comment)}</span>` : ''}
    </div>`).join('')
    : `<div class="ledger-posting-row"><span class="ledger-posting-comment" style="color:var(--muted)">No postings</span></div>`;

  return `
    <div class="ledger-txn" data-id="${t?.id ?? ''}" data-action="open-ledger-drawer">
      <div class="ledger-txn-header">
        <span class="ledger-txn-desc">${esc(t?.description || '(no description)')}</span>
        ${t?.comment ? `<span class="ledger-txn-comment">; ${esc(t.comment)}</span>` : ''}
        <span class="ledger-txn-expand" title="Edit">⊞</span>
      </div>
      <div class="ledger-txn-postings">${postingRows}</div>
      <div class="ledger-txn-actions">
        <button class="jrnl-action-pill" data-action="edit-txn"     data-id="${t?.id ?? ''}">✎ edit</button>
        <button class="jrnl-action-pill" data-action="add-posting"  data-id="${t?.id ?? ''}">+ posting</button>
        <button class="jrnl-action-pill" data-action="txn-journal"  data-id="${t?.id ?? ''}">→ journal</button>
        <button class="jrnl-action-pill" data-action="txn-community" data-id="${t?.id ?? ''}">→ community</button>
        <button class="jrnl-action-pill jrnl-pill-danger" data-action="delete-txn" data-id="${t?.id ?? ''}">✗ delete</button>
      </div>
      <div class="jrnl-inline-panel" data-panel="txn-${t?.id ?? ''}"></div>
    </div>`;
}

export function renderLedgerSummary(balances) {
  const el = document.getElementById('ledger-summary');
  if (!el || !balances.length) return;
  const types = ['assets','liabilities','income','expenses','equity'];
  const totals = {};
  for (const b of balances) {
    const account = String(b?.account || '');
    if (!account) continue;
    const root = account.split(':')[0].toLowerCase();
    if (!root) continue;
    totals[root] = (totals[root] || 0) + safeNumber(b?.balance);
  }
  el.innerHTML = types
    .filter(t => totals[t] !== undefined)
    .map(t => `<span class="ledger-summary-chip" style="border-color:${accountColor(t)};color:${accountColor(t)}"
        data-acct-filter="${t}">${t} <strong>${formatAmount(Math.round(totals[t]*100)/100)}</strong></span>`)
    .join('');
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export function renderTags(tags, filterText = '', tasks = []) {
  const chips = document.getElementById('tags-chips');
  const body  = document.getElementById('tags-body');
  if (!chips || !body) return;
  const filtered = filterText
    ? tags.filter(t => t.name.toLowerCase().includes(filterText.toLowerCase()))
    : tags;
  chips.innerHTML = '';
  if (filtered.length === 0) {
    body.innerHTML = '<div class="skeleton-msg">No tags.</div>';
    return;
  }
  body.innerHTML = filtered.map(t => {
    const tagTasks = tasks.filter(task => (task.tags || []).includes(t.name));
    const latestDate = tagTasks.length > 0 ? tagTasks[0].modified?.slice(0, 10) || '' : '';
    return `
      <div class="tag-bar" data-tag-name="${esc(t.name)}">
        <div class="tag-bar-header" data-action="toggle-tag">
          <span class="tag-bar-name">${esc(t.name)}</span>
          <span class="tag-bar-count">${t.count} task${t.count !== 1 ? 's' : ''}</span>
          ${latestDate ? `<span class="tag-bar-date">${latestDate}</span>` : ''}
          <span class="tag-bar-caret">▸</span>
        </div>
        <div class="tag-bar-tasks hidden">
          ${tagTasks.map(task => `
            <div class="tag-task-item" data-uuid="${task.uuid}">
              <span class="task-desc">${esc(task.description)}</span>
              ${task.project ? `<span class="task-project-badge">${esc(task.project)}</span>` : ''}
              ${task.priority ? `<span class="task-priority pri-${task.priority.toLowerCase()}">${task.priority}</span>` : ''}
              <span class="task-urgency-badge urgency-${urgencyLevel(task.urgency)}">${task.urgency.toFixed(1)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function renderProjects(projects, filterText = '', { allTasks = [], journalEntries = [], ledgerTxns = [], timeIntervals = [] } = {}) {
  const body = document.getElementById('projects-body');
  if (!body) return;
  const filtered = filterText
    ? projects.filter(p => p.name.toLowerCase().includes(filterText.toLowerCase()))
    : projects;
  if (filtered.length === 0) { body.innerHTML = '<div class="skeleton-msg">No projects.</div>'; return; }
  body.innerHTML = filtered.map(p => {
    const projTasks = allTasks.filter(t => t.project === p.name);
    const pending = projTasks.filter(t => t.status === 'pending' || t.status === 'active');
    const done = projTasks.filter(t => t.status === 'completed');
    const nextTask = pending.length > 0 ? pending[0] : null;
    const projJournals = journalEntries.filter(e => (e.project || '').toLowerCase() === p.name.toLowerCase());
    const projLedger = ledgerTxns.filter(t => (t.description || '').toLowerCase().includes(p.name.toLowerCase()));
    const projTime = timeIntervals.filter(i => (i.tags || []).some(tag => tag.toLowerCase() === p.name.toLowerCase()));
    const totalSeconds = projTime.reduce((s, i) => {
      const dur = i.end ? (new Date(i.end) - new Date(i.start)) / 1000 : 0;
      return s + dur;
    }, 0);
    const pct = p.total > 0 ? Math.round((done.length / p.total) * 100) : 0;

    return `
      <div class="project-card" data-project="${esc(p.name)}">
        <div class="project-card-header" data-action="toggle-project">
          <span class="project-card-name">${esc(p.name)}</span>
          <span class="project-card-meta">${p.pending} pending · ${done.length} done</span>
          <span class="project-card-bar"><span class="project-card-bar-fill" style="width:${pct}%"></span></span>
          <span class="project-card-caret">▸</span>
        </div>
        <div class="project-card-body hidden">
          ${nextTask ? `<div class="project-next-task" data-uuid="${nextTask.uuid}" data-action="project-open-task">
            <span style="color:var(--muted);font-size:10px">NEXT</span>
            <span class="task-desc" style="font-weight:500">${esc(nextTask.description)}</span>
            <span class="task-urgency-badge urgency-${urgencyLevel(nextTask.urgency)}">${nextTask.urgency.toFixed(1)}</span>
          </div>` : ''}
          <div class="project-section">
            <div class="project-section-label">TASKS ${pending.length} pending · ${done.length} done</div>
            ${pending.map(t => `<div class="project-task-item project-clickable" data-uuid="${t.uuid}" data-action="project-open-task">• ${esc(t.description)}</div>`).join('')}
            ${done.length > 0 ? `<details class="project-done-details"><summary style="font-size:10px;color:var(--muted);cursor:pointer">▸ Done (${done.length})</summary>
              ${done.map(t => `<div class="project-task-item project-task-done project-clickable" data-uuid="${t.uuid}" data-action="project-open-task">• ${esc(t.description)}</div>`).join('')}
            </details>` : ''}
          </div>
          <div class="project-section">
            <div class="project-section-label">JOURNAL ${projJournals.length} entries</div>
            ${projJournals.length === 0 ? `<div class="project-section-empty">no journal entries with @project:${esc(p.name)}</div>` : 
              projJournals.slice(0, 5).map(e => `<div class="project-journal-item project-clickable" data-id="${e.id}" data-action="project-open-journal">• ${esc((e.body || '').slice(0, 80))}</div>`).join('')}
          </div>
          <div class="project-section">
            <div class="project-section-label">LEDGER ${projLedger.length} transactions</div>
            ${projLedger.length === 0 ? `<div class="project-section-empty">no ledger entries with ; project:${esc(p.name)}</div>` :
              projLedger.slice(0, 5).map(t => `<div class="project-ledger-item project-clickable" data-id="${t.id}" data-action="project-open-ledger">• ${esc(t.description || '')} ${t.date || ''}</div>`).join('')}
          </div>
          <div class="project-section">
            <div class="project-section-label">TIME TRACKED</div>
            ${totalSeconds === 0 ? `<div class="project-section-empty">no time tracked for ${esc(p.name)}</div>` :
              `<div class="project-time-total">${formatDuration(totalSeconds)}</div>
               ${projTime.slice(0, 5).map(i => `<div class="project-time-item project-clickable" data-id="${i.id}" data-action="project-open-time">• ${(i.tags || []).join(', ')} — ${formatDuration(i.end ? (new Date(i.end) - new Date(i.start)) / 1000 : 0)}</div>`).join('')}`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Profile list ─────────────────────────────────────────────────────────────

export function renderProfileList(profiles, active) {
  const el = document.getElementById('profile-list');
  if (!el) return;
  if (profiles.length === 0) { el.innerHTML = '<div class="skeleton-msg">No profiles.</div>'; return; }
  el.innerHTML = profiles.map(p => `
    <div class="profile-list-item ${p === active ? 'active-profile' : ''}">
      <span class="profile-list-name">${esc(p)}</span>
      ${p === active ? '<span class="ww-offline-badge">active</span>' : `<button class="btn-inline-alt" style="font-size:10px;padding:1px 8px" data-action="switch-profile" data-name="${esc(p)}">switch</button>`}
      ${p !== active ? `<button class="btn-inline-alt" style="font-size:10px;padding:1px 8px;color:var(--error);border-color:var(--error)" data-action="delete-profile" data-name="${esc(p)}">delete</button>` : ''}
    </div>
  `).join('');
}

export function renderProfileSwitcher(profiles, active) {
  const el = document.getElementById('profile-switcher');
  if (!el) return;
  el.innerHTML = profiles.map(p => `
    <li class="${p === active ? 'active' : ''}" data-profile="${esc(p)}">${esc(p)}</li>
  `).join('');
}

// ── Warrior stats ────────────────────────────────────────────────────────────

export function updateWarriorStats(taskCount) {
  const el = document.getElementById('warrior-count');
  if (el) el.textContent = taskCount > 0 ? `${taskCount}` : '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function fmtDateHeader(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const yesterday = new Date(today - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
}

function dueBadge(due) {
  const d = new Date(due);
  const now = new Date();
  const diff = (d - now) / 86400000;
  let cls = 'future';
  let label = fmtDate(due);
  if (diff < 0)       { cls = 'overdue'; label = 'overdue'; }
  else if (diff <= 1) { cls = 'today';   label = 'due today'; }
  else if (diff <= 3) { cls = 'soon'; }
  return `<span class="task-due task-due-${cls}">${esc(label)}</span>`;
}

function safeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
function markdownLite(html) {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// ── Attributes ───────────────────────────────────────────────────────────────

/**
 * Renders attribute definition cards into #attr-list.
 * @param {Array} definitions - Array of AttributeDefinition objects
 */
export function renderAttributes(definitions) {
  const el = document.getElementById('attr-list');
  if (!el) return;
  if (!definitions || definitions.length === 0) {
    el.innerHTML = '<div class="skeleton-msg">No attributes defined.</div>';
    return;
  }

  // Collect all group names for the dropdown
  const allGroups = [...new Set(definitions.map(d => d.group || 'Ungrouped'))].sort();

  // Group by the group field
  const groups = new Map();
  for (const def of definitions) {
    const g = def.group || 'Ungrouped';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(def);
  }

  const groupOptions = allGroups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');

  el.innerHTML = [...groups.entries()].map(([groupName, defs]) => `
    <div class="attr-group">
      <div class="attr-group-header" data-action="toggle-attr-group">
        <span class="attr-group-caret">▾</span>
        ${esc(groupName)} <span class="attr-group-count">${defs.length}</span>
        <button class="attr-assign-profile-btn" data-assign-group="${esc(groupName)}" title="Assign entire group to a profile">→ profile</button>
      </div>
      <div class="attr-group-items">
        ${defs.map(def => {
          const allowedStr = (def.allowedValues || []).join(', ');
          return `
            <div class="attr-card" data-attr-name="${esc(def.name)}">
              <span class="attr-card-name">${esc(def.name)}</span>
              ${def.label ? `<span class="attr-card-label">${esc(def.label)}</span>` : ''}
              <span class="attr-card-type">${esc(def.type)}</span>
              ${def.defaultValue ? `<span class="attr-card-default">default: ${esc(def.defaultValue)}</span>` : ''}
              ${allowedStr ? `<span class="attr-card-allowed" title="${esc(allowedStr)}">[${esc(allowedStr)}]</span>` : ''}
              ${def.urgencyCoefficient ? `<span class="attr-card-urgency">⚡ ${def.urgencyCoefficient}</span>` : ''}
              ${def.readOnly ? `<span class="attr-card-readonly">read-only</span>` : ''}
              <span class="attr-card-actions">
                <select class="attr-group-assign" data-attr-assign="${esc(def.name)}" title="Assign to group">
                  ${allGroups.map(g => `<option value="${esc(g)}"${g === (def.group || 'Ungrouped') ? ' selected' : ''}>${esc(g)}</option>`).join('')}
                  <option value="__new__">+ New group…</option>
                </select>
                <button class="attr-assign-profile-btn" data-assign-attr="${esc(def.name)}" title="Assign to another profile">→</button>
                <button class="btn-inline-alt action-btn-sm" data-attr-duplicate="${esc(def.name)}" title="Duplicate to group">⧉</button>
                <button class="btn-inline-alt action-btn-sm" data-attr-edit="${esc(def.name)}" title="Edit">✎</button>
                <button class="btn-inline-alt action-btn-sm" data-attr-delete="${esc(def.name)}" title="Delete" style="color:var(--error);border-color:var(--error)">✗</button>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

/**
 * Returns HTML string for a type-appropriate input for a UDA value.
 * @param {Object} definition - AttributeDefinition
 * @param {*} value - Current value
 * @param {boolean} readOnly - Whether the field is read-only
 * @returns {string} HTML string
 */
export function renderUdaInput(definition, value, readOnly) {
  const safeVal = value != null ? String(value) : '';
  const safeName = esc(definition.name);

  if (readOnly) {
    return `<span class="tdr-uda-val-readonly">${esc(safeVal || definition.defaultValue || '—')}</span>`;
  }

  let warning = '';
  if (safeVal && !matchesType(definition.type, safeVal, definition.allowedValues)) {
    warning = '<span class="uda-type-warning">⚠ type mismatch</span>';
  }

  switch (definition.type) {
    case 'numeric':
      return `<input type="number" class="tdr-uda-typed-input" data-uda-key="${safeName}" value="${esc(safeVal)}" step="any" />${warning}`;
    case 'date':
      return `<input type="date" class="tdr-uda-typed-input" data-uda-key="${safeName}" value="${esc(safeVal)}" />${warning}`;
    case 'duration':
      return `<input type="text" class="tdr-uda-typed-input" data-uda-key="${safeName}" value="${esc(safeVal)}" placeholder="e.g. 2h, 30m, 1d" />${warning}`;
    case 'string':
    default:
      if (definition.allowedValues && definition.allowedValues.length > 0) {
        const opts = definition.allowedValues.map(v =>
          `<option value="${esc(v)}" ${v === safeVal ? 'selected' : ''}>${esc(v)}</option>`
        ).join('');
        return `<select class="tdr-uda-typed-select" data-uda-key="${safeName}"><option value="">—</option>${opts}</select>${warning}`;
      }
      return `<input type="text" class="tdr-uda-typed-input" data-uda-key="${safeName}" value="${esc(safeVal)}" />${warning}`;
  }
}

/**
 * Checks if a value matches the expected type.
 */
function matchesType(type, value, allowedValues) {
  if (!value) return true;
  switch (type) {
    case 'numeric': {
      const n = parseFloat(value);
      return !isNaN(n) && isFinite(n);
    }
    case 'date': {
      const d = new Date(value);
      return !isNaN(d.getTime());
    }
    case 'duration':
      return /^\d+(\.\d+)?[hmHMdDwW]$/.test(value);
    case 'string':
      if (allowedValues && allowedValues.length > 0) {
        return allowedValues.includes(value);
      }
      return true;
    default:
      return true;
  }
}
