// Ledger engine — double-entry transactions, balance/register/income reports

import { getAll, put, remove } from '../storage/db.js';

const STORE = 'ledger_transactions';
const ACCT_STORE = 'accounts';

export async function addTransaction(profile, { date, description, account, amount, comment = '', ledger = 'main' } = {}) {
  if (!date || !description || !account) throw new Error('date, description, and account are required');
  const parsed = parseAmount(amount);
  if (parsed === null) throw new Error(`Cannot parse amount: "${amount}"`);

  // Double-entry: debit the specified account, auto-balance via equity:opening-balances
  const counterAccount = parsed >= 0 ? 'equity:opening-balances' : 'equity:opening-balances';
  const txn = {
    date,
    description,
    ledger:   ledger || 'main',
    postings: [
      { account, amount: parsed, comment: comment || '' },
      { account: counterAccount, amount: -parsed, comment: '' },
    ],
    comment: comment || '',
  };
  const id = await put(profile, STORE, txn);
  return { ...txn, id };
}

export async function addFullTransaction(profile, { date, description, ledger = 'main', postings = [], comment = '' } = {}) {
  const txn = { date, description, ledger: ledger || 'main', postings, comment: comment || '' };
  const id = await put(profile, STORE, txn);
  return { ...txn, id };
}

export async function deleteTransaction(profile, id) {
  return remove(profile, STORE, id);
}

export async function getTransactions(profile, { ledger = null, search = '', limit = 500 } = {}) {
  const all = await getAll(profile, STORE);
  return all
    .filter(t => {
      if (ledger && t.ledger !== ledger) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.description.toLowerCase().includes(q) ||
               t.postings.some(p => p.account.toLowerCase().includes(q));
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export async function addAccount(profile, name) {
  if (!name || typeof name !== 'string') throw new Error('Account name required');
  await put(profile, ACCT_STORE, { name, created: new Date().toISOString() });
}

export async function getAccounts(profile) {
  return getAll(profile, ACCT_STORE);
}

// ── Reports ──────────────────────────────────────────────────────────────────

export async function balanceReport(profile, { ledger = null, accountFilter = '' } = {}) {
  const txns = await getTransactions(profile, { ledger });
  const balances = new Map();
  for (const txn of txns) {
    for (const p of txn.postings) {
      if (accountFilter && !p.account.toLowerCase().includes(accountFilter.toLowerCase())) continue;
      balances.set(p.account, (balances.get(p.account) || 0) + p.amount);
    }
  }
  return [...balances.entries()]
    .map(([account, balance]) => ({ account, balance: Math.round(balance * 100) / 100 }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

export async function registerReport(profile, { ledger = null, accountFilter = '', search = '', limit = 100 } = {}) {
  const txns = await getTransactions(profile, { ledger, search, limit });
  const rows = [];
  for (const txn of txns) {
    for (const p of txn.postings) {
      if (accountFilter && !p.account.toLowerCase().includes(accountFilter.toLowerCase())) continue;
      rows.push({
        date:        txn.date,
        description: txn.description,
        account:     p.account,
        amount:      p.amount,
        comment:     p.comment || '',
      });
    }
  }
  return rows;
}

export async function incomeReport(profile, { ledger = null } = {}) {
  const rows = await balanceReport(profile, { ledger });
  const income  = rows.filter(r => r.account.startsWith('income') || r.account.startsWith('revenue'));
  const expense = rows.filter(r => r.account.startsWith('expense'));
  const incomeTotal  = income.reduce((s, r) => s + r.balance, 0);
  const expenseTotal = expense.reduce((s, r) => s + r.balance, 0);
  return {
    income:       income,
    expenses:     expense,
    incomeTotal:  Math.round(incomeTotal * 100) / 100,
    expenseTotal: Math.round(expenseTotal * 100) / 100,
    net:          Math.round((incomeTotal + expenseTotal) * 100) / 100,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).replace(/[$,]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function formatAmount(n) {
  return n >= 0 ? `$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

export function accountType(name) {
  if (!name) return 'other';
  const root = name.split(':')[0].toLowerCase();
  return root;
}

export function accountColor(name) {
  const type = accountType(name);
  const colors = {
    assets:      'var(--success)',
    liabilities: 'var(--error)',
    income:      'var(--clr-time)',
    revenue:     'var(--clr-time)',
    expenses:    'var(--warning)',
    equity:      'var(--muted)',
  };
  return colors[type] || 'var(--text)';
}
