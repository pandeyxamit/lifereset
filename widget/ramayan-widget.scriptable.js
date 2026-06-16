// ramayan-widget.scriptable.js
// Optional iOS lock-screen / home-screen widget for "66 Day Life Reset".
// Runs in the free Scriptable app (https://scriptable.app) — NOT in the PWA.
// It shows today's day number + quest targets, computed from the same
// data/schedule.json the web app uses (no backend, always in sync).
//
// SETUP
// 1. Host the app on tinyhost (you already do). Copy its base URL.
// 2. Set HOST below to that URL (no trailing slash).
// 3. Scriptable → + → paste this whole file → name it "Life Reset".
// 4. Add a Scriptable widget to your Home/Lock screen → long-press →
//    Edit Widget → Script: "Life Reset", When Interacting: Run Script.
//
// NOTE: the widget shows daily *targets* only. Your live check-marks, XP and
// streak live inside the PWA's private storage and can't be read here.

const HOST = "https://lifereset.tiiny.site"; // your tiiny.site URL (no trailing slash)

const FALLBACK = {
  startDate: "2026-06-17",
  totalDays: 66,
  bookTotalPages: 2304,
  quests: [
    { name: "Run / Power Walk", category: "physical" },
    { name: "Bodyweight Circuit", category: "physical" },
    { name: "Hydration 3.0L", category: "physical" },
    { name: "Ramayan Study", category: "mental" },
    { name: "Silent Walk 15m", category: "mental" },
    { name: "Digital Sunset", category: "mental" }
  ]
};

const PHYS = new Color("#3b82f6");
const MENT = new Color("#a855f7");
const MUTED = new Color("#94a3b8");

async function loadConfig() {
  try {
    const req = new Request(`${HOST}/data/schedule.json`);
    req.timeoutInterval = 8;
    return await req.loadJSON();
  } catch (e) {
    return FALLBACK;
  }
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayNumber(cfg) {
  const start = new Date(cfg.startDate + "T00:00:00");
  const diff = stripTime(new Date()) - stripTime(start);
  return Math.floor(diff / 86400000) + 1;
}

function targetsFor(day, cfg) {
  const d = Math.max(1, day);
  const runSec = 1800 + (d - 1) * 30;
  const m = Math.floor(runSec / 60);
  const s = runSec % 60;
  return {
    run: s > 0 ? `${m}m ${s}s` : `${m} min`,
    reps: 10 + Math.floor((d - 1) * 0.5),
    plank: 20 + (d - 1),
    pages: Math.ceil((cfg.bookTotalPages || 2304) / (cfg.totalDays || 66))
  };
}

function buildWidget(cfg) {
  const day = dayNumber(cfg);
  const total = cfg.totalDays || 66;
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [new Color("#1e1b4b"), new Color("#311042")];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(12, 14, 12, 14);

  if (day < 1) {
    title(w, "Life Reset");
    line(w, `Starts ${cfg.startDate}`, MUTED, 12);
    return w;
  }
  if (day > total) {
    title(w, "Complete 🏁");
    line(w, `All ${total} days done!`, MUTED, 12);
    return w;
  }

  const t = targetsFor(day, cfg);
  const header = w.addText(`DAY ${day} / ${total}`);
  header.font = Font.heavySystemFont(15);
  header.textColor = Color.white();
  w.addSpacer(6);

  const rows = [
    [`🏃 ${t.run}`, PHYS],
    [`💪 ${t.reps} reps · ${t.plank}s plank`, PHYS],
    [`💧 3.0 L water`, PHYS],
    [`📖 ${t.pages} pages`, MENT],
    [`🚶 15 min silent walk`, MENT],
    [`🌙 Digital sunset`, MENT]
  ];
  for (const [text, color] of rows) {
    const r = w.addText(text);
    r.font = Font.systemFont(11);
    r.textColor = color;
    r.lineLimit = 1;
    w.addSpacer(2);
  }
  return w;
}

function title(w, text) {
  const t = w.addText(text);
  t.font = Font.heavySystemFont(16);
  t.textColor = Color.white();
  w.addSpacer(4);
}
function line(w, text, color, size) {
  const t = w.addText(text);
  t.font = Font.systemFont(size);
  t.textColor = color;
}

const cfg = await loadConfig();
const widget = buildWidget(cfg);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
