// Questions service — named capture templates that dispatch to other services
// WORKER-SAFE: no DOM dependencies

import { getMeta, setMeta } from '../../storage/db.js';

const KEY = 'question_templates';

export async function getTemplates(profile) {
  return (await getMeta(profile, KEY)) || defaultTemplates();
}

export async function saveTemplate(profile, template) {
  const templates = await getTemplates(profile);
  const idx = templates.findIndex(t => t.id === template.id);
  if (idx >= 0) templates[idx] = template;
  else templates.push({ ...template, id: template.id || crypto.randomUUID() });
  await setMeta(profile, KEY, templates);
}

export async function deleteTemplate(profile, id) {
  const templates = (await getTemplates(profile)).filter(t => t.id !== id);
  await setMeta(profile, KEY, templates);
}

// A template defines a list of fields and a target service/action
// When "run", it returns an action descriptor that app.js dispatches
export function buildAction(template, answers) {
  const merged = {};
  for (const field of template.fields) {
    merged[field.key] = answers[field.key] ?? field.default ?? '';
  }

  switch (template.service) {
    case 'task':
      return { service: 'tasks', fn: 'addTask', args: {
        description: merged.description || template.name,
        project:     merged.project || '',
        tags:        merged.tags    || '',
        priority:    merged.priority || '',
        due:         merged.due     || null,
      }};
    case 'journal':
      return { service: 'journal', fn: 'addEntry', args: {
        body:    merged.body || merged.text || '',
        project: merged.project || '',
        tags:    merged.tags || '',
      }};
    case 'time':
      return { service: 'time', fn: 'startTracking', args: {
        tags:       merged.tags || 'work',
        annotation: merged.description || '',
      }};
    case 'ledger':
      return { service: 'ledger', fn: 'addTransaction', args: {
        date:        merged.date || new Date().toISOString().slice(0, 10),
        description: merged.description || '',
        account:     merged.account || '',
        amount:      merged.amount || '0',
      }};
    default:
      return null;
  }
}

function defaultTemplates() {
  return [
    {
      id: 'daily-standup',
      name: 'Daily Standup',
      service: 'journal',
      description: 'Three-question standup capture',
      fields: [
        { key: 'body', label: 'What did I do yesterday? What will I do today? Any blockers?', type: 'textarea', default: '' },
        { key: 'tags', label: 'Tags', type: 'text', default: 'standup' },
      ],
    },
    {
      id: 'new-project-task',
      name: 'New Project Task',
      service: 'task',
      description: 'Add a task with full metadata',
      fields: [
        { key: 'description', label: 'Task description', type: 'text',     default: '' },
        { key: 'project',     label: 'Project',          type: 'text',     default: '' },
        { key: 'priority',    label: 'Priority',         type: 'select',   options: ['', 'H', 'M', 'L'], default: 'M' },
        { key: 'due',         label: 'Due date',         type: 'date',     default: '' },
        { key: 'tags',        label: 'Tags',             type: 'text',     default: '' },
      ],
    },
    {
      id: 'log-expense',
      name: 'Log Expense',
      service: 'ledger',
      description: 'Quick expense entry',
      fields: [
        { key: 'description', label: 'What was this for?',  type: 'text',   default: '' },
        { key: 'account',     label: 'Account',             type: 'text',   default: 'expenses:' },
        { key: 'amount',      label: 'Amount',              type: 'text',   default: '' },
        { key: 'date',        label: 'Date',                type: 'date',   default: '' },
      ],
    },
  ];
}
