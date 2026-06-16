// util.js — pure helpers (dates + tiny DOM utilities). No imports, no side effects.

// CRITICAL TIME-LOCK: tracking officially starts June 17, 2026 (kept hardcoded).
export const START_DATE_MS = new Date('2026-06-17T00:00:00').getTime();
export const TOTAL_DAYS = 66;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// Challenge day number: 0 before start, 1..N during, >TOTAL_DAYS after.
export function calculateCurrentDayNumber(nowMs = Date.now()) {
  if (nowMs < START_DATE_MS) return 0;
  const diff = nowMs - START_DATE_MS;
  return Math.floor(diff / 86400000) + 1;
}

// Local calendar key YYYY-MM-DD (used for flashcard scheduling, water/day resets).
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Add n days to a YYYY-MM-DD key using local time (DST-safe).
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return todayKey(dt);
}

// Whole days from keyA to keyB (b - a). Negative if b is before a.
export function daysBetween(keyA, keyB) {
  const [ay, am, ad] = keyA.split('-').map(Number);
  const [by, bm, bd] = keyB.split('-').map(Number);
  const a = new Date(ay, am - 1, ad).getTime();
  const b = new Date(by, bm - 1, bd).getTime();
  return Math.round((b - a) / 86400000);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- Tiny DOM helpers -------------------------------------------------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Safe text setter (avoids innerHTML for user-derived content -> no XSS).
export function setText(node, text) {
  if (node) node.textContent = text == null ? '' : String(text);
}

/**
 * Create an element. props.class -> className, props.dataset -> data-*,
 * on* -> ignored (we use delegation), everything else -> attribute or property.
 * children: string | Node | array.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only for trusted, code-built markup
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
