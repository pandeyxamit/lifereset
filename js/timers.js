// timers.js — water counter (persisted) + lightweight stopwatch / countdown controllers.
import { state, commitToDevice } from './state.js';
import { clamp, calculateCurrentDayNumber } from './util.js';

const MAX_WATER = 6000; // safety cap (ml)

function ensureTodayBucket() {
  const day = calculateCurrentDayNumber();
  if (state.timers.day !== day) state.timers = { day, waterMl: 0 };
}

export function addWater(ml) {
  ensureTodayBucket();
  state.timers.waterMl = clamp(state.timers.waterMl + ml, 0, MAX_WATER);
  commitToDevice();
  return state.timers.waterMl;
}

export function resetWater() {
  ensureTodayBucket();
  state.timers.waterMl = 0;
  commitToDevice();
}

export function getWater() {
  ensureTodayBucket();
  return state.timers.waterMl;
}

export function waterPct() {
  const goal = state.settings.waterGoalMl || 3000;
  return clamp(Math.round((getWater() / goal) * 100), 0, 100);
}

// ---- Stopwatch (counts up) --------------------------------------------------
export function createStopwatch(onTick) {
  let startedAt = 0;
  let acc = 0;
  let raf = null;
  function loop() {
    if (onTick) onTick(elapsed());
    raf = requestAnimationFrame(loop);
  }
  function elapsed() {
    return acc + (startedAt ? Date.now() - startedAt : 0);
  }
  return {
    start() { if (!startedAt) { startedAt = Date.now(); loop(); } },
    pause() { if (startedAt) { acc += Date.now() - startedAt; startedAt = 0; if (raf) cancelAnimationFrame(raf); raf = null; } },
    reset() { startedAt = 0; acc = 0; if (raf) cancelAnimationFrame(raf); raf = null; if (onTick) onTick(0); },
    elapsed,
    isRunning: () => !!startedAt
  };
}

// ---- Countdown (counts down from totalSeconds) ------------------------------
export function createCountdown(totalSeconds, onTick, onDone) {
  let remainingMs = totalSeconds * 1000;
  let startedAt = 0;
  let timer = null;
  function tick() {
    const left = remaining();
    if (onTick) onTick(left);
    if (left <= 0) { stop(); if (onDone) onDone(); }
  }
  function remaining() {
    return Math.max(0, remainingMs - (startedAt ? Date.now() - startedAt : 0));
  }
  function stop() {
    if (startedAt) { remainingMs = remaining(); startedAt = 0; }
    if (timer) { clearInterval(timer); timer = null; }
  }
  return {
    start() { if (!startedAt && remaining() > 0) { startedAt = Date.now(); timer = setInterval(tick, 200); tick(); } },
    pause() { stop(); },
    reset(newSeconds = totalSeconds) { stop(); remainingMs = newSeconds * 1000; if (onTick) onTick(remainingMs); },
    remaining,
    isRunning: () => !!startedAt
  };
}

export function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
