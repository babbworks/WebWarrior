// Terminal bar — keyboard shortcuts, filter mode, shorthand commands

const SECTION_KEYS = {
  t: 'tasks',
  i: 'time',
  j: 'journal',
  l: 'ledger',
  p: 'projects',
  x: 'tags',
  e: 'export',
  m: 'import',
  c: 'ctrl',
};

export class Terminal {
  constructor({ onNavigate, onCommand, onFilter }) {
    this.onNavigate = onNavigate;
    this.onCommand  = onCommand;
    this.onFilter   = onFilter;

    this.history    = this._loadHistory();
    this.historyIdx = -1;
    this.filterMode = false;
    this.gPressed   = false;
    this.gTimer     = null;

    this.input       = document.getElementById('term-input');
    this.prompt      = document.getElementById('term-prompt');
    this.badge       = document.getElementById('term-profile-badge');
    this.hintsText   = document.getElementById('hints-text');
    this.cmdOutput   = document.getElementById('cmd-output');
    this.posToggle   = document.getElementById('term-pos-toggle');
    this.expandToggle= document.getElementById('term-expand-toggle');
    this.histBtn     = document.getElementById('hints-hist-btn');
    this.helpBtn     = document.getElementById('hints-help-btn');
    this.termBar     = document.getElementById('terminal-bar');
  }

  init() {
    if (!this.input) return;
    this.input.addEventListener('keydown', e => this._onKey(e));
    document.addEventListener('keydown', e => this._onGlobal(e));
    this.posToggle?.addEventListener('click', () => this._togglePosition());
    this.expandToggle?.addEventListener('click', () => this._toggleExpand());
    this.histBtn?.addEventListener('click', () => this._showHistory());
    this.helpBtn?.addEventListener('click', () => this._showHelp());
    this._updatePrompt();
  }

  setProfile(name) {
    if (this.badge) this.badge.textContent = name || '';
  }

  setHint(text) {
    if (this.hintsText) this.hintsText.textContent = text;
  }

  showOutput(text, isError = false) {
    if (!this.cmdOutput) return;
    this.cmdOutput.textContent = text;
    this.cmdOutput.style.color = isError ? 'var(--error)' : 'var(--text)';
    this.cmdOutput.classList.remove('hidden');
    setTimeout(() => this.cmdOutput.classList.add('hidden'), 4000);
  }

  focus() {
    this.input?.focus();
  }

  _onKey(e) {
    if (e.key === 'Enter') {
      const val = this.input.value.trim();
      this.input.value = '';
      if (this.filterMode) {
        this._setFilter('');
        this._exitFilterMode();
        return;
      }
      if (!val) return;
      this._pushHistory(val);
      this.historyIdx = -1;
      this._runCommand(val);
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      this._toggleFilterMode();
      return;
    }

    if (e.key === 'Escape') {
      this.input.value = '';
      if (this.filterMode) { this._setFilter(''); this._exitFilterMode(); }
      this.input.blur();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.history.length === 0) return;
      this.historyIdx = Math.min(this.historyIdx + 1, this.history.length - 1);
      this.input.value = this.history[this.history.length - 1 - this.historyIdx] || '';
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.historyIdx <= 0) { this.historyIdx = -1; this.input.value = ''; return; }
      this.historyIdx--;
      this.input.value = this.history[this.history.length - 1 - this.historyIdx] || '';
      return;
    }

    if (this.filterMode) {
      // Let the input value update, then fire filter
      requestAnimationFrame(() => this._setFilter(this.input.value));
    }
  }

  _onGlobal(e) {
    // Don't intercept when user is in an input/textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Escape') {
      this.focus();
      return;
    }

    // g-prefix navigation
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      this.gPressed = true;
      clearTimeout(this.gTimer);
      this.gTimer = setTimeout(() => { this.gPressed = false; }, 1000);
      return;
    }

    if (this.gPressed) {
      const section = SECTION_KEYS[e.key];
      if (section) {
        e.preventDefault();
        this.gPressed = false;
        this.onNavigate?.(section);
        return;
      }
      this.gPressed = false;
    }

    // '?' opens help
    if (e.key === '?') {
      this._showHelp();
    }
  }

  _toggleFilterMode() {
    this.filterMode = !this.filterMode;
    this._updatePrompt();
    if (!this.filterMode) {
      this._setFilter('');
      this.input.value = '';
    }
  }

  _exitFilterMode() {
    this.filterMode = false;
    this._updatePrompt();
  }

  _updatePrompt() {
    if (!this.prompt) return;
    this.prompt.textContent = this.filterMode ? '⌕ ' : '❯ ';
    this.prompt.style.color = this.filterMode ? 'var(--warning)' : 'var(--term-green)';
    if (this.hintsText) {
      this.hintsText.textContent = this.filterMode
        ? 'filter mode — type to search · Tab to exit · Esc to clear'
        : 'type a command — tab to filter · t <task> · j <note> · start/stop';
    }
  }

  _setFilter(query) {
    this.onFilter?.(query);
  }

  _runCommand(cmd) {
    this.onCommand?.(cmd);
  }

  _togglePosition() {
    const bar = this.termBar;
    if (!bar) return;
    const isTop = bar.classList.toggle('term-top');
    this.posToggle.textContent = isTop ? '↓' : '↑';
    if (isTop) {
      bar.style.top = '0'; bar.style.bottom = 'auto';
    } else {
      bar.style.bottom = '0'; bar.style.top = 'auto';
    }
  }

  _toggleExpand() {
    const bar = this.termBar;
    if (!bar) return;
    const expanded = bar.classList.toggle('term-expanded');
    this.expandToggle.textContent = expanded ? '▴' : '▾';
    bar.style.height = expanded ? '240px' : '';
  }

  _showHistory() {
    if (!this.cmdOutput) return;
    if (this.history.length === 0) {
      this.showOutput('(no history)');
      return;
    }
    const text = this.history.slice(-20).reverse().map((h, i) => `${i + 1}  ${h}`).join('\n');
    this.cmdOutput.style.whiteSpace = 'pre';
    this.showOutput(text);
  }

  _showHelp() {
    const overlay = document.getElementById('ww-help-overlay');
    overlay?.classList.toggle('hidden');
  }

  _pushHistory(cmd) {
    const h = this.history.filter(c => c !== cmd);
    h.push(cmd);
    this.history = h.slice(-100);
    this._saveHistory();
  }

  _loadHistory() {
    try { return JSON.parse(localStorage.getItem('ww_cmd_history') || '[]'); } catch { return []; }
  }

  _saveHistory() {
    localStorage.setItem('ww_cmd_history', JSON.stringify(this.history));
  }
}
