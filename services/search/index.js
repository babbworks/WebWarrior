import { getAll, getOne } from '../../storage/db.js';

export const SEARCH_TYPES = {
  tasks:   { label: 'Task', store: 'tasks', resource: 'taskList', fallback: 'main' },
  time:    { label: 'Time interval', store: 'time_intervals', resource: 'log', fallback: 'main' },
  journal: { label: 'Journal entry', store: 'journal_entries', resource: 'journal', fallback: 'main' },
  ledger:  { label: 'Ledger transaction', store: 'ledger_transactions', resource: 'ledger', fallback: 'main' },
  lists:   { label: 'List item', store: 'lists', resource: 'list', fallback: 'default' },
};

function describe(type, row) {
  const annotations = () => (row.annotations || []).flatMap(note => [note.text, note.description]);
  switch (type) {
    case 'tasks':
      return [row.description, row.modified || row.entry, [row.project, row.tags, row.status, row.priority, annotations()]];
    case 'time':
      return [row.tags?.join?.(' ') || row.tags || 'Untagged interval', row.start, [row.annotation, row.end ? 'finished' : 'running']];
    case 'journal':
      return [row.body?.split('\n')[0], row.date, [row.body, row.project, row.tags, annotations(), row.archived ? 'archived' : '']];
    case 'ledger':
      return [row.description, row.date, [row.comment, (row.postings || []).flatMap(p => [p.account, p.amount, p.comment])]];
    case 'lists':
      return [row.text, row.created, [row.note, row.done ? 'done' : 'pending']];
  }
}

function excerpt(field, terms) {
  if (!field) return '';
  const lower = field.toLowerCase();
  const offsets = terms.map(term => lower.indexOf(term)).filter(offset => offset >= 0);
  const start = Math.max(0, Math.min(...offsets) - 45);
  const end = Math.max(start + 155, Math.min(...offsets) + 1);
  return (start ? '…' : '') + field.slice(start, end).trim() + (end < field.length ? '…' : '');
}

export async function searchProfiles(query, profiles, { type = '', limit = 100 } = {}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [], total: 0, skipped: [] };

  const types = Object.keys(SEARCH_TYPES).filter(key => !type || type === key);
  const results = [];
  const skipped = [];
  // Read one profile at a time so only its records are in memory during the scan.
  for (const profile of new Set(profiles)) {
    for (const key of types) {
      const spec = SEARCH_TYPES[key];
      let records;
      try {
        records = await getAll(profile, spec.store);
      } catch {
        skipped.push({ profile, type: key });
        continue;
      }
      for (const record of records) {
        const [heading, date, details] = describe(key, record);
        const resource = record[spec.resource] || spec.fallback;
        const title = String(heading || spec.label).trim() || spec.label;
        const fields = details.flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number')
          .map(value => String(value).replace(/\s+/g, ' ').trim());
        const titleText = title.toLowerCase();
        const searchable = [title, resource, date, ...fields].join(' ').toLowerCase();
        if (!terms.every(term => searchable.includes(term))) continue;
        const matchedDetail = fields.find(field => field !== title && terms.some(term => field.toLowerCase().includes(term)));
        results.push({
          profile, type: key, resource, title, date,
          id: key === 'tasks' ? record.uuid : record.id,
          preview: excerpt(matchedDetail, terms),
          score: terms.filter(term => titleText.includes(term)).length,
        });
      }
    }
  }
  results.sort((a, b) => b.score - a.score || String(b.date || '').localeCompare(String(a.date || ''))
    || a.profile.localeCompare(b.profile) || a.type.localeCompare(b.type) || String(a.id).localeCompare(String(b.id)));
  return { results: results.slice(0, limit), total: results.length, skipped };
}

export function getSearchRecord({ profile, type, id }) {
  return getOne(profile, SEARCH_TYPES[type].store, id);
}
