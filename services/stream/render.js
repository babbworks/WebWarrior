/**
 * Stream Service — Lens Rendering
 *
 * Renders lens output into the Stream panel DOM.
 * Supports both visual (canvas/SVG/HTML) and ASCII modes.
 */

import { renderAscii as cooperAscii } from './cooper.js';

let asciiMode = false;

export function setAsciiMode(mode) { asciiMode = !!mode; }
export function getAsciiMode() { return asciiMode; }

/**
 * Renders a lens result into the stream-lens-view container.
 * @param {Object} result - LensOutput from replay
 * @param {HTMLElement} container - The #stream-lens-view element
 */
export function renderLens(result, container) {
  if (!container || !result) return;
  const { lens, data, meta } = result;

  switch (lens) {
    case 'burroughs': return renderBurroughs(data, meta, container);
    case 'bundy':     return renderBundy(data, meta, container);
    case 'frick':     return renderFrick(data, meta, container);
    case 'felt':      return renderFelt(data, meta, container);
    case 'dey':       return renderDey(data, meta, container);
    case 'cooper':    return renderCooper(data, meta, container);
    default:
      container.innerHTML = `<div class="skeleton-msg">Unknown lens: ${lens}</div>`;
  }
}

// ── Burroughs: Raw event table ───────────────────────────────────────────────

function renderBurroughs(data, meta, container) {
  const { rows, total } = data;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No events in range.</div>';
    return;
  }

  const header = `<div style="font-size:10px;color:var(--muted);margin-bottom:6px">${total} events total</div>`;
  const tableRows = rows.map(e => {
    const time = new Date(e.ts * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ctxStr = e.ctx ? JSON.stringify(e.ctx).slice(0, 80) : '';
    return `<tr><td>${time}</td><td>${e.op}</td><td>${e.action}</td><td title="${esc(e.object)}">${esc(e.object.slice(0, 12))}</td><td style="color:var(--muted)">${esc(ctxStr)}</td></tr>`;
  }).join('');

  container.innerHTML = `${header}<table><thead><tr><th>time</th><th>op</th><th>action</th><th>object</th><th>ctx</th></tr></thead><tbody>${tableRows}</tbody></table>`;
}

// ── Bundy: Interval bars ─────────────────────────────────────────────────────

function renderBundy(data, meta, container) {
  const { intervals } = data;
  if (!intervals || intervals.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No intervals in range.</div>';
    return;
  }

  const maxDuration = Math.max(...intervals.map(iv => iv.totalDuration), 1);

  if (asciiMode) {
    const lines = intervals.map(iv => {
      const label = (iv.object || '?').slice(0, 16).padEnd(16);
      const barLen = Math.round((iv.totalDuration / maxDuration) * 30);
      const bar = '█'.repeat(barLen) + '░'.repeat(30 - barLen);
      const dur = formatDuration(iv.totalDuration);
      return `${label} ${bar} ${dur}`;
    });
    container.innerHTML = `<pre class="stream-ascii-output">${lines.join('\n')}</pre>`;
    return;
  }

  const bars = intervals.map(iv => {
    const pct = Math.round((iv.totalDuration / maxDuration) * 100);
    const label = iv.object ? iv.object.slice(0, 20) : '?';
    const dur = formatDuration(iv.totalDuration);
    return `<div class="stream-bundy-bar"><span class="stream-bundy-label" title="${esc(iv.object)}">${esc(label)}</span><div class="stream-bundy-track"><div class="stream-bundy-fill" style="width:${pct}%"></div></div><span class="stream-bundy-duration">${dur}</span></div>`;
  }).join('');

  container.innerHTML = bars;

  // Task 39: Time axis for Bundy
  if (data.raw && data.raw.length > 0) {
    const allTimes = data.raw.flatMap(iv => [iv.start, iv.end].filter(Boolean));
    const minT = Math.min(...allTimes);
    const maxT = Math.max(...allTimes, Math.floor(Date.now()/1000));
    const axisHtml = `<div class="stream-time-axis" style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:6px;padding:0 100px 0 0">
      <span>${new Date(minT*1000).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
      <span>${new Date(((minT+maxT)/2)*1000).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
      <span>${new Date(maxT*1000).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
    </div>`;
    container.insertAdjacentHTML('beforeend', axisHtml);
  }
}

// ── Frick: Transition markers ────────────────────────────────────────────────

function renderFrick(data, meta, container) {
  const { transitions } = data;
  if (!transitions || transitions.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No transitions in range.</div>';
    return;
  }

  if (asciiMode) {
    const lines = transitions.map(t => {
      const time = new Date(t.ts * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      const marker = { start: 'S', stop: '■', pause: 'P', resume: 'R', switch: '↔' }[t.action] || '?';
      return `${time} ${marker} ${t.action.padEnd(7)} ${(t.object || '').slice(0, 12)}`;
    });
    container.innerHTML = `<pre class="stream-ascii-output">${lines.join('\n')}</pre>`;
    return;
  }

  const markers = transitions.map(t => {
    const time = new Date(t.ts * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    return `<span class="stream-frick-marker ${t.action}" title="${esc(t.object)}">${time} ${t.action}</span>`;
  }).join('');

  // Task 39: Wrap in scrollable container with time axis
  const wrapper = `<div style="overflow-x:auto;white-space:nowrap;padding-bottom:4px"><div style="line-height:2">${markers}</div></div>`;
  container.innerHTML = wrapper;
}

// ── Felt: Activity density heat map ──────────────────────────────────────────

function renderFelt(data, meta, container) {
  const { buckets } = data;
  if (!buckets || buckets.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No activity in range.</div>';
    return;
  }

  if (asciiMode) {
    const chars = ' ░▒▓█';
    const line = buckets.map(b => {
      const idx = Math.min(Math.floor(b.normalized * (chars.length - 1)), chars.length - 1);
      return chars[idx];
    }).join('');
    const times = buckets.filter((_, i) => i % 4 === 0).map(b => {
      return new Date(b.ts * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    }).join('  ');
    container.innerHTML = `<pre class="stream-ascii-output">${line}\n${times}</pre>`;
    return;
  }

  const cells = buckets.map(b => {
    const hue = 30; // amber base
    const lightness = 10 + b.normalized * 70;
    const color = b.normalized < 0.05 ? 'var(--bg)' : `hsl(${hue}, 80%, ${lightness}%)`;
    const time = new Date(b.ts * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    return `<div class="stream-felt-cell" style="background:${color}" title="${time}: ${b.count} events"></div>`;
  }).join('');

  container.innerHTML = `<div class="stream-felt-row">${cells}</div>`;
}

// ── Dey: Signal time-series ──────────────────────────────────────────────────

function renderDey(data, meta, container) {
  const { samples, smoothed } = data;
  if (!samples || samples.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No Dey samples in range.</div>';
    return;
  }

  if (asciiMode) {
    const chars = '▁▂▃▄▅▆▇█';
    const iLine = smoothed.map(s => chars[Math.min(Math.floor(s.i * (chars.length - 1)), chars.length - 1)]).join('');
    const sLine = smoothed.map(s => chars[Math.min(Math.floor(s.s * (chars.length - 1)), chars.length - 1)]).join('');
    const fLine = smoothed.map(s => chars[Math.min(Math.floor(s.f * (chars.length - 1)), chars.length - 1)]).join('');
    container.innerHTML = `<pre class="stream-ascii-output">intensity:     ${iLine}\nstability:     ${sLine}\nfragmentation: ${fLine}</pre>`;
    return;
  }

  // Render as canvas line chart
  const width = container.clientWidth - 20 || 400;
  const height = 120;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'var(--bg)';
  ctx.fillRect(0, 0, width, height);

  // Draw each dimension
  const colors = { i: '#3fb950', s: '#58a6ff', f: '#d29922' };
  for (const [dim, color] of Object.entries(colors)) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    smoothed.forEach((s, idx) => {
      const x = (idx / (smoothed.length - 1)) * width;
      const y = height - s[dim] * height;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Legend
  const legend = `<div style="font-size:10px;margin-top:4px;display:flex;gap:12px"><span style="color:#3fb950">● intensity</span><span style="color:#58a6ff">● stability</span><span style="color:#d29922">● fragmentation</span></div>`;

  container.innerHTML = '';
  container.appendChild(canvas);
  container.insertAdjacentHTML('beforeend', legend);
}

// ── Cooper: Geometric field ──────────────────────────────────────────────────

function renderCooper(data, meta, container) {
  const { points, projection } = data;
  if (!points || points.length === 0) {
    container.innerHTML = '<div class="skeleton-msg">No Cooper data in range.</div>';
    return;
  }

  if (asciiMode) {
    const ascii = cooperAscii({ projection, points, bounds: data.bounds }, { width: 40, height: 20 });
    container.innerHTML = `<pre class="stream-ascii-output">${ascii}</pre>`;
    return;
  }

  // Canvas polar rendering
  const size = Math.min(container.clientWidth - 20, 360) || 300;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'stream-cooper-canvas';

  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 20;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, size, size);

  // Draw guide circles
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 0.5;
  for (let r = 0.25; r <= 1; r += 0.25) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * maxR, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // Draw cross
  ctx.beginPath();
  ctx.moveTo(cx, 10); ctx.lineTo(cx, size - 10);
  ctx.moveTo(10, cy); ctx.lineTo(size - 10, cy);
  ctx.stroke();

  // Plot points
  for (const p of points) {
    const angle = (p.angle != null) ? p.angle - Math.PI / 2 : 0;
    const radius = (p.radius != null ? p.radius : 0) * maxR;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const intensity = p.radius || 0;
    const hue = 30 + (1 - intensity) * 180; // amber to cyan
    ctx.fillStyle = `hsla(${hue}, 80%, ${40 + intensity * 40}%, 0.7)`;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Time labels at 3-hour intervals
  ctx.fillStyle = '#7d8590';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const timeLabels = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * 2 * Math.PI - Math.PI / 2;
    const labelR = maxR + 12;
    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    ctx.fillText(timeLabels[i], lx, ly + 4);
  }

  // Center dot
  ctx.fillStyle = '#58a6ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, 2 * Math.PI);
  ctx.fill();

  container.innerHTML = '';
  container.appendChild(canvas);

  // Task 38: Cooper canvas interactivity — mousemove tooltip
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Find nearest point
    let nearest = null;
    let minDist = Infinity;
    for (const p of points) {
      const angle = (p.angle != null) ? p.angle - Math.PI / 2 : 0;
      const radius = (p.radius != null ? p.radius : 0) * maxR;
      const px = cx + radius * Math.cos(angle);
      const py = cy + radius * Math.sin(angle);
      const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
      if (dist < minDist) { minDist = dist; nearest = p; }
    }

    // Show tooltip if close enough
    let tooltip = canvas.parentElement?.querySelector('.stream-cooper-tooltip');
    if (minDist < 15 && nearest) {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'stream-cooper-tooltip';
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(tooltip);
      }
      const time = new Date(nearest.ts * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'});
      tooltip.textContent = `${time} i:${(nearest.radius||0).toFixed(2)} s:${(nearest.stability||0).toFixed(2)} f:${(nearest.fragmentation||0).toFixed(2)}`;
      tooltip.style.cssText = `position:absolute;top:${e.offsetY - 20}px;left:${e.offsetX + 10}px;background:var(--surface);border:1px solid var(--border);padding:2px 6px;font-size:10px;border-radius:3px;pointer-events:none;white-space:nowrap;z-index:10`;
    } else if (tooltip) {
      tooltip.remove();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    canvas.parentElement?.querySelector('.stream-cooper-tooltip')?.remove();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renders a comparison of two lens results — primary normally, comparison faded.
 * @param {Object} primary - Primary LensOutput
 * @param {Object} comparison - Comparison LensOutput
 * @param {HTMLElement} container - The #stream-lens-view element
 */
export function renderComparison(primary, comparison, container) {
  if (!container) return;

  // Render primary normally
  renderLens(primary, container);

  // Append comparison with faded overlay
  if (comparison) {
    const overlay = document.createElement('div');
    overlay.className = 'stream-comparison-overlay';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:6px';
    label.textContent = '— comparison —';
    overlay.appendChild(label);

    const compContainer = document.createElement('div');
    overlay.appendChild(compContainer);
    container.appendChild(overlay);
    renderLens(comparison, compContainer);
  }
}
