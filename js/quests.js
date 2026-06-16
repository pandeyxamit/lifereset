// quests.js — daily targets, the chronological engine, XP-aware quest actions.
import {
  state, commitToDevice, awardXp, reverseXp
} from './state.js';
import { calculateCurrentDayNumber, TOTAL_DAYS } from './util.js';

// Deterministic daily targets (also mirrored by the Scriptable widget).
export function computeTargets(dayNumber, bookTotalPages = state.bookTotalPages) {
  const day = dayNumber > 0 ? dayNumber : 1;

  // Progressive overload: +30s run per day.
  const runTotalSeconds = 1800 + (day - 1) * 30;
  const runMin = Math.floor(runTotalSeconds / 60);
  const runSec = runTotalSeconds % 60;
  const runText = runSec > 0 ? `${runMin}m ${runSec}s` : `${runMin} mins`;

  const reps = 10 + Math.floor((day - 1) * 0.5);
  const plankSeconds = 20 + (day - 1);
  const pagesPerDay = bookTotalPages > 0 ? Math.ceil(bookTotalPages / TOTAL_DAYS) : 0;

  return { runTotalSeconds, runText, reps, plankSeconds, pagesPerDay };
}

// Fill in descriptions for dynamic built-in quests.
export function updateDynamicQuests() {
  const t = computeTargets(calculateCurrentDayNumber());
  for (const q of state.quests) {
    if (q.dynamic === 'run') {
      q.desc = `Run or Power Walk for minimum ${t.runText}. Focus on steady deep stamina breathing.`;
    } else if (q.dynamic === 'circuit') {
      q.desc = `3 sets: Pushups (${t.reps} reps), Squats (${t.reps} reps), Planks (${t.plankSeconds}s) & Lunges to structural failure.`;
    } else if (q.dynamic === 'water') {
      q.desc = `Consume 3.0 Liters of pure water. Tip: finish 1.5L before noon to avoid disrupting sleep.`;
    } else if (q.dynamic === 'book') {
      q.desc = t.pagesPerDay > 0
        ? `Read exactly ${t.pagesPerDay} pages today to fulfill your Gita Press narrative roadmap.`
        : 'Set your book length in Settings to get a daily page target.';
    }
  }
}

// Mark won/missed + maintain current/longest streak for a given day.
function evaluatePerfectDay(currentDay) {
  const perfect = state.quests.length > 0 && state.quests.every((q) => q.done);
  if (perfect) {
    if (state.daysRecord[currentDay] !== 'won') {
      state.daysRecord[currentDay] = 'won';
      state.streak++;
      state.longestStreak = Math.max(state.longestStreak, state.streak);
    }
  } else if (state.daysRecord[currentDay] === 'won') {
    delete state.daysRecord[currentDay];
    state.streak = Math.max(0, state.streak - 1);
  }
}

// Advance day boundaries: backfill missed days, reset quests + water on a new day.
// NOTE: the original "passive +20 XP/day" reward was removed (it only fed the
// Physical track and inflated levels). Streak handling is preserved.
export function runChronologicalEngine() {
  const currentDay = calculateCurrentDayNumber();
  if (currentDay === 0) return;

  for (let i = 1; i < currentDay; i++) {
    if (!state.daysRecord[i]) {
      state.daysRecord[i] = 'missed';
      state.streak = 0;
    }
  }

  if (currentDay > state.lastCheckedDayNumber) {
    if (state.lastCheckedDayNumber > 0 && state.daysRecord[state.lastCheckedDayNumber] !== 'won') {
      state.daysRecord[state.lastCheckedDayNumber] = 'missed';
      state.streak = 0;
    }
    state.quests.forEach((q) => { q.done = false; });
    state.timers = { day: currentDay, waterMl: 0 };
    state.lastCheckedDayNumber = currentDay;
    commitToDevice();
  }
}

export function toggleQuest(id) {
  const currentDay = calculateCurrentDayNumber();
  if (currentDay === 0 || currentDay > TOTAL_DAYS) return false;
  updateDynamicQuests();
  const q = state.quests.find((x) => x.id === id);
  if (!q) return false;

  if (!q.done) {
    q.done = true;
    awardXp(q.category, q.val);
  } else {
    q.done = false;
    reverseXp(q.category, q.val);
  }
  evaluatePerfectDay(currentDay);
  commitToDevice();
  return true;
}

// Water counter -> hydration quest. Auto-completes only (never silently revokes
// XP the user earned); the user can still untoggle manually.
export function syncHydrationQuest() {
  const currentDay = calculateCurrentDayNumber();
  if (currentDay === 0 || currentDay > TOTAL_DAYS) return;
  const q = state.quests.find((x) => x.dynamic === 'water');
  if (!q || q.done) return;
  if (state.timers.waterMl >= state.settings.waterGoalMl) {
    q.done = true;
    awardXp(q.category, q.val);
    evaluatePerfectDay(currentDay);
    commitToDevice();
  }
}

// ---- Custom quest CRUD ------------------------------------------------------
export function addQuest({ name, desc = '', category = 'physical', val = 10 }) {
  const quest = {
    id: state.nextQuestId++,
    name: String(name || 'New Quest').slice(0, 80),
    desc: String(desc || '').slice(0, 240),
    category: category === 'mental' ? 'mental' : 'physical',
    val: clampXp(val),
    done: false,
    dynamic: null,
    builtin: false
  };
  state.quests.push(quest);
  commitToDevice();
  return quest;
}

export function updateQuest(id, patch) {
  const q = state.quests.find((x) => x.id === id);
  if (!q) return false;
  const wasDone = q.done;
  if (wasDone) reverseXp(q.category, q.val); // unwind old contribution first

  if (patch.name != null) q.name = String(patch.name).slice(0, 80);
  if (patch.desc != null) q.desc = String(patch.desc).slice(0, 240);
  if (patch.category != null) q.category = patch.category === 'mental' ? 'mental' : 'physical';
  if (patch.val != null) q.val = clampXp(patch.val);

  if (wasDone) awardXp(q.category, q.val); // re-apply with new values
  const currentDay = calculateCurrentDayNumber();
  if (currentDay > 0 && currentDay <= TOTAL_DAYS) evaluatePerfectDay(currentDay);
  commitToDevice();
  return true;
}

export function deleteQuest(id) {
  const idx = state.quests.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  const q = state.quests[idx];
  if (q.done) reverseXp(q.category, q.val);
  state.quests.splice(idx, 1);
  const currentDay = calculateCurrentDayNumber();
  if (currentDay > 0 && currentDay <= TOTAL_DAYS) evaluatePerfectDay(currentDay);
  commitToDevice();
  return true;
}

function clampXp(v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 10;
  return Math.max(1, Math.min(100, n));
}
