// Taskwarrior urgency formula — pure function, no side effects

import { computeUdaUrgency } from '../services/attributes/index.js';

const PRIORITY_WEIGHTS = { H: 1.0, M: 0.65, L: 0.25, '': 0 };

const STANDARD_TASK_KEYS = new Set([
  'uuid', 'status', 'description', 'project', 'tags', 'priority',
  'due', 'scheduled', 'wait', 'start', 'end', 'depends',
  'annotations', 'urgency', 'modified', 'entry', 'taskList'
]);

export function computeUrgency(task, udaDefinitions = []) {
  let u = 0;

  // Due date factor (max 12)
  if (task.due) {
    const now = Date.now();
    const due = new Date(task.due).getTime();
    const daysUntilDue = (due - now) / 86400000;
    if (daysUntilDue < 0) {
      u += 12.0; // overdue — max urgency
    } else if (daysUntilDue <= 7) {
      u += 12.0 * (1 - daysUntilDue / 7);
    }
  }

  // Priority factor (max 6)
  u += 6.0 * (PRIORITY_WEIGHTS[task.priority || ''] || 0);

  // Active factor (max 2)
  if (task.status === 'active') u += 2.0;

  // Age factor (max 1, normalized to 365 days)
  if (task.entry) {
    const ageDays = (Date.now() - new Date(task.entry).getTime()) / 86400000;
    u += 1.0 * Math.min(ageDays / 365, 1);
  }

  // Annotations factor (max 1)
  if (task.annotations && task.annotations.length > 0) u += 0.1 * task.annotations.length;

  // Tags factor
  if (task.tags && task.tags.length > 0) u += 0.5;

  // Project factor
  if (task.project) u += 0.5;

  // Wait — reduce urgency if waiting
  if (task.wait && new Date(task.wait) > new Date()) u -= 3.0;

  // UDA urgency contributions
  for (const key of Object.keys(task)) {
    if (STANDARD_TASK_KEYS.has(key)) continue;
    const def = udaDefinitions.find(d => d.name === key);
    if (def && def.urgencyCoefficient !== 0) {
      u += computeUdaUrgency(def, task[key]);
    }
  }

  return Math.round(u * 100) / 100;
}

export function urgencyLevel(urgency) {
  if (urgency >= 10) return 'high';
  if (urgency >= 5)  return 'med';
  return 'low';
}
