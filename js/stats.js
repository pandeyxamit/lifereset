// stats.js — metrics, achievement engine, and dependency-free inline SVG charts.
import { state } from './state.js';
import { TOTAL_DAYS, clamp } from './util.js';

export function wonDays() {
  return Object.values(state.daysRecord).filter((v) => v === 'won').length;
}
export function missedDays() {
  return Object.values(state.daysRecord).filter((v) => v === 'missed').length;
}

export function totalXp() {
  const phys = (state.p_lvl - 1) * 100 + state.p_xp;
  const ment = (state.m_lvl - 1) * 100 + state.m_xp;
  return { phys, ment, total: phys + ment };
}

export function computeStats(currentDay) {
  const elapsed = clamp(currentDay, 0, TOTAL_DAYS);
  const won = wonDays();
  const missed = missedDays();
  const pending = Math.max(0, elapsed - won - missed);
  const completion = elapsed > 0 ? Math.round((won / elapsed) * 100) : 0;
  const xp = totalXp();
  return {
    elapsed, won, missed, pending, completion,
    streak: state.streak,
    longestStreak: state.longestStreak,
    daysLeft: Math.max(0, TOTAL_DAYS - elapsed),
    xp,
    reviews: state.flashcards.totalReviews,
    reviewStreak: state.flashcards.reviewStreak
  };
}

// ---- Achievements -----------------------------------------------------------
export const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🥇', name: 'First Blood', desc: 'Win your first day', test: () => wonDays() >= 1 },
  { id: 'streak_7', icon: '🔥', name: 'Ember', desc: '7-day win streak', test: () => state.longestStreak >= 7 },
  { id: 'streak_21', icon: '⚡', name: 'Habit Formed', desc: '21-day win streak', test: () => state.longestStreak >= 21 },
  { id: 'streak_30', icon: '🌟', name: 'Unbroken', desc: '30-day win streak', test: () => state.longestStreak >= 30 },
  { id: 'streak_66', icon: '👑', name: 'Transformed', desc: '66-day win streak', test: () => state.longestStreak >= 66 },
  { id: 'halfway', icon: '🏔️', name: 'Halfway There', desc: 'Reach Day 33', test: (c) => c.currentDay >= 33 },
  { id: 'finish', icon: '🏁', name: 'Horizon Reached', desc: 'Reach Day 66', test: (c) => c.currentDay >= TOTAL_DAYS },
  { id: 'phys_5', icon: '💪', name: 'Iron Body', desc: 'Stamina Level 5', test: () => state.p_lvl >= 5 },
  { id: 'ment_5', icon: '🧠', name: 'Sharp Mind', desc: 'Wisdom Level 5', test: () => state.m_lvl >= 5 },
  { id: 'cards_50', icon: '📚', name: 'Scholar', desc: 'Review 50 flashcards', test: () => state.flashcards.totalReviews >= 50 },
  { id: 'cards_200', icon: '🦉', name: 'Sage', desc: 'Review 200 flashcards', test: () => state.flashcards.totalReviews >= 200 },
  { id: 'review_7', icon: '🗓️', name: 'Daily Devotion', desc: '7-day review streak', test: () => state.flashcards.reviewStreak >= 7 }
];

export function getAchievements() {
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: !!state.achievements[a.id], at: state.achievements[a.id] || null }));
}

// Returns array of newly-unlocked achievements (caller persists + animates).
export function checkAchievements(currentDay) {
  const ctx = { currentDay };
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    let ok = false;
    try { ok = a.test(ctx); } catch { ok = false; }
    if (ok) {
      state.achievements[a.id] = new Date().toISOString();
      newly.push(a);
    }
  }
  return newly;
}

// ---- Charts (return trusted SVG markup strings) -----------------------------
export function weeklyCompletionSVG() {
  const weeks = Math.ceil(TOTAL_DAYS / 7);
  const W = 320, H = 130, padB = 22, padT = 10, maxH = H - padB - padT;
  const gap = 6;
  const bw = (W - gap * (weeks + 1)) / weeks;
  let bars = '';
  for (let w = 0; w < weeks; w++) {
    let won = 0;
    for (let d = 1; d <= 7; d++) {
      const day = w * 7 + d;
      if (day <= TOTAL_DAYS && state.daysRecord[day] === 'won') won++;
    }
    const h = (won / 7) * maxH;
    const x = gap + w * (bw + gap);
    const y = padT + (maxH - h);
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="url(#g)"/>`;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" fill="#64748b" font-size="9" text-anchor="middle">W${w + 1}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weekly completion">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#3b82f6"/>
    </linearGradient></defs>${bars}</svg>`;
}

export function xpSplitSVG() {
  const { phys, ment, total } = totalXp();
  const W = 320, H = 26;
  const pPct = total > 0 ? phys / total : 0.5;
  const pw = Math.max(0, Math.min(W, W * pPct));
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="XP split">
    <rect x="0" y="0" width="${pw.toFixed(1)}" height="${H}" rx="6" fill="#3b82f6"/>
    <rect x="${pw.toFixed(1)}" y="0" width="${(W - pw).toFixed(1)}" height="${H}" rx="6" fill="#a855f7"/>
    <text x="8" y="17" fill="#fff" font-size="11" font-weight="700">PHYS ${phys}</text>
    <text x="${W - 8}" y="17" fill="#fff" font-size="11" font-weight="700" text-anchor="end">MENT ${ment}</text>
  </svg>`;
}
