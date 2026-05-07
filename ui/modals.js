// Toast, confirm dialog, overlays

// ── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

export function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = type === 'error' ? 'var(--error)' : type === 'warning' ? 'var(--warning)' : 'var(--success)';
  el.style.color = '#fff';
  el.style.opacity = '1';
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 200);
  }, 2500);
}

// ── Confirm dialog ───────────────────────────────────────────────────────────

let confirmResolve = null;

export function confirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    const msgEl   = document.getElementById('confirm-msg');
    const okBtn   = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    if (!overlay) { resolve(false); return; }
    msgEl.textContent = msg;
    overlay.classList.remove('hidden');
    confirmResolve = resolve;

    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Annotate inline ──────────────────────────────────────────────────────────

export function promptText(placeholder = 'Enter text…') {
  return new Promise((resolve) => {
    const text = window.prompt(placeholder);
    resolve(text || null);
  });
}
