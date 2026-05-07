// Export service — JSON, CSV, Markdown, hledger-format file downloads
// WORKER-SAFE: no DOM dependencies (download trigger lives in app.js)

import { getAll } from '../../storage/db.js';

export async function exportJSON(profile) {
  const [tasks, intervals, entries, txns, accounts] = await Promise.all([
    getAll(profile, 'tasks'),
    getAll(profile, 'time_intervals'),
    getAll(profile, 'journal_entries'),
    getAll(profile, 'ledger_transactions'),
    getAll(profile, 'accounts'),
  ]);
  return JSON.stringify({
    exported:    new Date().toISOString(),
    profile,
    tasks,
    time_intervals: intervals,
    journal_entries: entries,
    ledger_transactions: txns,
    accounts,
  }, null, 2);
}

export async function exportTasksCSV(profile) {
  const tasks = await getAll(profile, 'tasks');
  const cols = ['uuid', 'status', 'description', 'project', 'tags', 'priority', 'due', 'urgency', 'entry', 'modified'];
  const rows = tasks.map(t =>
    cols.map(c => {
      const v = c === 'tags' ? (t.tags || []).join(' ') : (t[c] ?? '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [cols.join(','), ...rows].join('\n');
}

export async function exportJournalMarkdown(profile, journal = null) {
  const entries = await getAll(profile, 'journal_entries');
  const filtered = journal ? entries.filter(e => e.journal === journal) : entries;
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

  const lines = [];
  let lastDate = '';
  for (const e of filtered) {
    const day = e.date.slice(0, 10);
    if (day !== lastDate) {
      lines.push(`\n## ${day}\n`);
      lastDate = day;
    }
    const time = new Date(e.date).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    lines.push(`### ${time}`);
    lines.push(e.body);
    for (const a of (e.annotations || [])) {
      lines.push(`\n> ${a.text}`);
    }
    lines.push('');
  }
  return `# Journal: ${journal || 'all'} — ${profile}\n${lines.join('\n')}`;
}

export async function exportHledger(profile, ledger = null) {
  const txns = await getAll(profile, 'ledger_transactions');
  const filtered = ledger ? txns.filter(t => t.ledger === ledger) : txns;
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  return filtered.map(t => {
    const lines = [`${t.date} ${t.description}`];
    if (t.comment) lines[0] += `  ; ${t.comment}`;
    for (const p of t.postings) {
      const amt = p.amount >= 0 ? `$${p.amount.toFixed(2)}` : `-$${Math.abs(p.amount).toFixed(2)}`;
      lines.push(`    ${p.account.padEnd(40)} ${amt}${p.comment ? `  ; ${p.comment}` : ''}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
