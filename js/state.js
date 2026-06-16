// state.js — single source of truth: schema, persistence, migration, XP mutations.
import { clamp, todayKey } from './util.js';

export const STORAGE_KEY = 'LifeResetHardCore_Data';
export const SCHEMA_VERSION = 2;

// The six built-in quests. desc is filled dynamically for `dynamic` ones.
function defaultQuests() {
  return [
    { id: 1, name: 'Endurance Run / Power Walk', desc: '', category: 'physical', val: 10, done: false, dynamic: 'run', builtin: true },
    { id: 2, name: 'Bodyweight Stamina Circuit', desc: '', category: 'physical', val: 10, done: false, dynamic: 'circuit', builtin: true },
    { id: 3, name: 'Strategic Hydration Target', desc: 'Consume 3.0 Liters of pure water before your wind-down.', category: 'physical', val: 12, done: false, dynamic: 'water', builtin: true },
    { id: 4, name: 'Valmiki Ramayan Deep Study', desc: 'Read your target page allocation.', category: 'mental', val: 15, done: false, dynamic: 'book', builtin: true },
    { id: 5, name: 'Silent Mental Awareness Walk', desc: '15 mins walking outdoors without tech or distractions.', category: 'mental', val: 12, done: false, dynamic: null, builtin: true },
    { id: 6, name: 'Digital Sunset Recovery', desc: 'No phone, laptop, or blue-light screens 45 minutes before sleeping.', category: 'mental', val: 12, done: false, dynamic: null, builtin: true }
  ];
}

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    p_xp: 0, p_lvl: 1,
    m_xp: 0, m_lvl: 1,
    streak: 0,
    longestStreak: 0,
    bookTotalPages: 0,
    daysRecord: {},
    lastCheckedDayNumber: 0,
    quests: defaultQuests(),
    nextQuestId: 7,
    flashcards: {
      decks: [],
      cards: [],
      newPerDay: 10,
      lastReviewDay: null,      // YYYY-MM-DD of last daily roll
      newIntroducedToday: 0,
      reviewedTodayCount: 0,
      sessionRewardDay: null,   // day we already granted the "session cleared" bonus
      reviewStreak: 0,
      lastReviewStreakDay: null,
      totalReviews: 0,
      seeded: false
    },
    timers: { day: 0, waterMl: 0 },
    achievements: {},           // id -> ISO timestamp unlocked
    dailyShloka: { date: null, text: '', author: '', source: '' },
    settings: { reminderTime: '06:30', waterGoalMl: 3000, theme: 'dark' }
  };
}

// ---- Persistence ------------------------------------------------------------
export let state = defaultState();

export function commitToDevice() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Save failed (storage full or blocked):', e);
  }
}

export function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    raw = null;
  }
  state = migrate(raw);
  return state;
}

// Bring any older/partial saved object up to the current schema without data loss.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  const base = defaultState();
  const v = raw.schemaVersion || 1;

  // Shallow-merge known top-level scalars/objects, preferring saved values.
  const merged = {
    ...base,
    ...raw,
    flashcards: { ...base.flashcards, ...(raw.flashcards || {}) },
    timers: { ...base.timers, ...(raw.timers || {}) },
    settings: { ...base.settings, ...(raw.settings || {}) },
    achievements: { ...(raw.achievements || {}) },
    dailyShloka: { ...base.dailyShloka, ...(raw.dailyShloka || {}) },
    daysRecord: { ...(raw.daysRecord || {}) }
  };

  // v1 -> v2: ensure quests carry the new flags; keep user progress.
  if (v < 2) {
    const defs = defaultQuests();
    merged.quests = (Array.isArray(raw.quests) ? raw.quests : defs).map((q) => {
      const def = defs.find((d) => d.id === q.id);
      return {
        dynamic: def ? def.dynamic : null,
        builtin: !!def,
        ...q
      };
    });
    const maxId = merged.quests.reduce((m, q) => Math.max(m, q.id || 0), 0);
    merged.nextQuestId = Math.max(7, maxId + 1);
    merged.longestStreak = Math.max(merged.streak || 0, raw.longestStreak || 0);
  }

  merged.schemaVersion = SCHEMA_VERSION;
  return merged;
}

// ---- Backup -----------------------------------------------------------------
export function exportData() {
  return JSON.stringify(state, null, 2);
}

export function importData(jsonText) {
  const parsed = JSON.parse(jsonText); // throws on bad JSON -> caller handles
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid backup object.');
  state = migrate(parsed);
  commitToDevice();
  return state;
}

export function resetData() {
  state = defaultState();
  commitToDevice();
  return state;
}

// ---- XP mutations (shared by quests + flashcards) ---------------------------
// Correct multi-level rollover (the original used a single `if`).
export function awardXp(category, amount) {
  if (amount <= 0) return;
  if (category === 'physical') {
    state.p_xp += amount;
    while (state.p_xp >= 100) { state.p_lvl++; state.p_xp -= 100; }
  } else {
    state.m_xp += amount;
    while (state.m_xp >= 100) { state.m_lvl++; state.m_xp -= 100; }
  }
}

// Properly reverse an award, de-levelling if needed (original just clamped to 0).
export function reverseXp(category, amount) {
  if (amount <= 0) return;
  if (category === 'physical') {
    state.p_xp -= amount;
    while (state.p_xp < 0 && state.p_lvl > 1) { state.p_lvl--; state.p_xp += 100; }
    state.p_xp = clamp(state.p_xp, 0, 99);
  } else {
    state.m_xp -= amount;
    while (state.m_xp < 0 && state.m_lvl > 1) { state.m_lvl--; state.m_xp += 100; }
    state.m_xp = clamp(state.m_xp, 0, 99);
  }
}
