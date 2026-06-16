// app.js — controller: boot, tab routing, rendering, and event delegation.
import {
  state, loadState, commitToDevice, exportData, importData, resetData,
  defaultState, migrate, STORAGE_KEY
} from './state.js';
import {
  calculateCurrentDayNumber, TOTAL_DAYS, todayKey, $, el, setText
} from './util.js';
import {
  updateDynamicQuests, runChronologicalEngine, toggleQuest,
  computeTargets, addQuest, updateQuest, deleteQuest, syncHydrationQuest
} from './quests.js';
import {
  ensureSeed, rollDailyReview, getDueCards, dueCount, rateCard,
  getDecks, getCardsByDeck, deckStats, addDeck, addCard, updateCard, deleteCard, deleteDeck
} from './flashcards.js';
import {
  computeStats, getAchievements, checkAchievements, weeklyCompletionSVG, xpSplitSVG
} from './stats.js';
import {
  addWater, resetWater, getWater, waterPct, createStopwatch, createCountdown, formatClock
} from './timers.js';
import { nudgeText, buildICS } from './reminders.js';

let activeTab = 'today';
let lastActiveTab = activeTab;
let runSW = null;
let plankCD = null;
let review = { active: false, cards: [], i: 0, flipped: false };
let dailyShlokaLoading = false;
let dailyShlokaError = '';
let currentModal = null;

function applyTheme() {
  const theme = state.settings.theme || 'dark';
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  commitToDevice();
  render();
}

const FALLBACK_SHLOKAS = [
  { text: 'यदा यदा हि धर्मस्य ग्लानिर्भवति भारत। अभ्युत्थानम् अधर्मस्य तदाऽआत्मानं सृजाम्यहम्॥', author: 'Bhagavad Gita 4.7' },
  { text: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। मा कर्मफलहेतुर्भूर्मा ते संगोऽस्त्वकर्मणि॥', author: 'Bhagavad Gita 2.47' },
  { text: 'सत्त्वमात्मनि प्रतिष्ठितम् आत्मवत्पश्यति यत्। सर्वथा स एव न सत्त्वेति सोऽयं न पश्यति किञ्चन॥', author: 'Yoga Sutras' },
  { text: 'शरीरमाद्यं खलु धर्मसाधनमिति स्मृतम्।', author: 'Manu Smriti' },
  { text: 'विद्या विहीनं धनं नित्यं व्यापरमोहिनीम्। व्यर्थं प्राणिनां मध्ये तदश्च श्रेष्ठमपि वा॥', author: 'Mahabharata' }
];

function pickFallbackShloka() {
  return FALLBACK_SHLOKAS[Math.floor(Math.random() * FALLBACK_SHLOKAS.length)];
}

async function fetchDailyShloka() {
  const today = todayKey();
  if (state.dailyShloka.date === today && state.dailyShloka.text) return;
  dailyShlokaLoading = true;
  dailyShlokaError = '';
  try {
    // Prioritized endpoints to try (name, url). The URLs include common quote APIs
    // and candidate Bhagavad Gita API endpoints per user references.
    const endpoints = [
      { name: 'Shloka.onrender (gita random)', url: 'https://shloka.onrender.com/api/v1/bahgavad_gita/random' },
      { name: 'Shloka.onrender (chanakya random)', url: 'https://shloka.onrender.com/api/v1/chanakya/shloka/random' },
      { name: 'ZenQuotes', url: 'https://zenquotes.io/api/random' },
      { name: 'Quotable', url: 'https://api.quotable.io/random' },
      { name: 'BhagavadGita-Vercel', url: 'https://bhagavad-gita-api.vercel.app/api/verses/random' },
      { name: 'BhagavadGita-Example', url: 'https://gita-api.herokuapp.com/verses/random' }
    ];

    let quote = '';
    let author = 'Unknown';
    let used = null;

    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(ep.url, { cache: 'no-cache', signal: controller.signal });
        clearTimeout(to);
        if (!res.ok) { console.warn(`${ep.name} HTTP ${res.status}`); continue; }
        const data = await res.json();
        // Heuristic extraction: handle various API shapes (arrays, objects with mixed key names)
        const maybe = Array.isArray(data) ? data[0] : data;
        let candidate = '';
        let candidateAuthor = author;
        if (maybe && typeof maybe === 'object') {
          // Prefer explicit fields (case-insensitive)
          for (const k of Object.keys(maybe)) {
            const v = maybe[k];
            if (typeof v !== 'string') continue;
            const key = k.toLowerCase().replace(/\s+/g, '');
            if (!candidate && /(shloka|sloka|verse|text|quote|content|englishtranslation|english)/.test(key)) candidate = v;
            if (!candidateAuthor && /(author|a|translator|class|source|chapter)/.test(key)) candidateAuthor = v;
          }
          // Fallback: first string-valued property
          if (!candidate) {
            const firstStr = Object.values(maybe).find((x) => typeof x === 'string');
            if (firstStr) candidate = firstStr;
          }
        } else if (typeof maybe === 'string') {
          candidate = maybe;
        }
        quote = candidate || '';
        author = candidateAuthor || author;
        if (quote) { used = ep.name; console.info(`fetchDailyShloka: got data from ${ep.name}`); break; }
      } catch (err) {
        console.warn(`fetchDailyShloka ${ep.name} failed:`, err && err.message ? err.message : err);
        // try next
      }
    }

    if (!quote) throw new Error('No quote data from remote endpoints');
    state.dailyShloka = { date: today, text: quote, author, source: used || 'Remote API' };
    dailyShlokaError = '';
  } catch (e) {
    console.warn('fetchDailyShloka error:', e && e.message ? e.message : e);
    const fallback = pickFallbackShloka();
    state.dailyShloka = { date: today, text: fallback.text, author: fallback.author, source: 'Offline fallback' };
    dailyShlokaError = `Could not fetch online verse (${e && e.message ? e.message : 'unknown error'}); showing fallback.`;
  } finally {
    dailyShlokaLoading = false;
    commitToDevice();
  }
}

// ---- Boot -------------------------------------------------------------------
function boot() {
  loadState();
  applyTheme();
  runChronologicalEngine();
  rollDailyReview();
  wireEvents();
  registerServiceWorker();
  createPullToRefresh();
  render();
  // Seed deck (async, first run only) then refresh if it added cards.
  ensureSeed().then(() => render());
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed:', e));
    });
  }
}

const PULL_REFRESH_THRESHOLD = 70;
const PULL_REFRESH_MAX = 120;
let pullRefreshState = { startY: null, distance: 0, active: false };

function createPullToRefresh() {
  const indicator = el('div', { id: 'pull-refresh', text: 'Pull to refresh' });
  document.body.appendChild(indicator);

  function resetIndicator() {
    pullRefreshState = { startY: null, distance: 0, active: false };
    indicator.style.transform = 'translateY(-100%)';
    indicator.classList.remove('ready', 'refreshing');
    indicator.textContent = 'Pull to refresh';
  }

  function updateIndicator(distance) {
    indicator.style.transform = `translateY(${Math.min(distance - 100, 0)}px)`;
    const ready = distance >= PULL_REFRESH_THRESHOLD;
    indicator.classList.toggle('ready', ready);
    indicator.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
  }

  window.addEventListener('touchstart', (event) => {
    if (window.scrollY !== 0 || pullRefreshState.active) return;
    pullRefreshState.startY = event.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (pullRefreshState.startY === null) return;
    const currentY = event.touches[0].clientY;
    const distance = Math.max(0, currentY - pullRefreshState.startY);
    if (distance === 0) return;
    pullRefreshState.active = true;
    pullRefreshState.distance = Math.min(distance, PULL_REFRESH_MAX);
    updateIndicator(pullRefreshState.distance);
    if (window.scrollY === 0) event.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (!pullRefreshState.active) {
      pullRefreshState.startY = null;
      return;
    }
    if (pullRefreshState.distance >= PULL_REFRESH_THRESHOLD) {
      indicator.textContent = 'Refreshing…';
      indicator.classList.add('refreshing');
      // Perform a robust refresh that clears caches/service-worker and preserves
      // only essential user data so the app picks up deployed updates.
      performPullRefreshReset();
      setTimeout(resetIndicator, 600);
    } else {
      resetIndicator();
    }
  });

  resetIndicator();
}

// ---- Render orchestration ---------------------------------------------------
function refresh() {
  const currentDay = calculateCurrentDayNumber();
  const newly = checkAchievements(currentDay);
  if (newly.length) {
    commitToDevice();
    newly.forEach((a) => toast(`${a.icon} ${a.name} unlocked!`, 'achv'));
  }
  render();
}

// Clear caches and service workers, preserve all user data, then reload.
async function performPullRefreshReset() {
  try {
    // Persist current state — DO NOT alter or remove any user data.
    commitToDevice();

    // Clear CacheStorage entries to force network refresh of assets.
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }

    // Try to update/unregister service workers so a fresh one can install on reload.
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        try {
          // Prefer to signal waiting workers to skipWaiting if possible.
          if (r.waiting) {
            try { r.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ }
          }
          // Attempt an update, then unregister to ensure clean install on reload.
          try { await r.update(); } catch (e) { /* ignore */ }
          await r.unregister();
        } catch (e) {
          console.warn('Service worker registration action failed:', e);
        }
      }
    }

    // Do NOT remove any localStorage keys — preserve all user data per request.

    // Reload to fetch updated assets and register fresh service worker.
    location.reload();
  } catch (err) {
    console.error('performPullRefreshReset failed:', err);
    // Fallback to a soft refresh if something goes wrong
    refresh();
  }
}

function render() {
  const screen = $('#screen');
  if (!screen) return;
  // Pause workout timers when leaving Today.
  if (activeTab !== 'today') { runSW?.pause(); plankCD?.pause(); }
  screen.innerHTML = '';
  if (activeTab === 'today') screen.appendChild(renderToday());
  else if (activeTab === 'cards') screen.appendChild(renderCards());
  else if (activeTab === 'stats') screen.appendChild(renderStats());
  else if (activeTab === 'settings') screen.appendChild(renderSettings());
  // Highlight active nav.
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === activeTab);
  });
  // Only scroll to top when user navigates between tabs — avoid jumping on small UI updates.
  if (activeTab !== lastActiveTab) {
    window.scrollTo(0, 0);
    lastActiveTab = activeTab;
  }
}

// ---- Today screen -----------------------------------------------------------
function renderToday() {
  const currentDay = calculateCurrentDayNumber();
  updateDynamicQuests();
  const frag = el('div');

  // Streak banner
  let bannerText;
  if (currentDay === 0) bannerText = '⏱️ LOCK-IN STARTS 17th June 2026';
  else if (currentDay > TOTAL_DAYS) bannerText = '🏁 66-Day Horizon Matrix complete — check your Stats!';
  else bannerText = `Day ${currentDay} of ${TOTAL_DAYS} — ${state.streak} Day Hot Streak 🔥`;
  frag.appendChild(el('div', { class: 'streak-counter', id: 'streak-banner', text: bannerText }));

  // Verse of the day at the top of the homepage
  frag.appendChild(dailyShlokaCard());

  // Dashboards
  const dash = el('div', { class: 'dashboard-container' });
  dash.appendChild(rpgCard('phys', `STAMINA LVL ${state.p_lvl}`, 'PHYSICAL XP', state.p_xp));
  dash.appendChild(rpgCard('ment', `WISDOM LVL ${state.m_lvl}`, 'MENTAL XP', state.m_xp));
  frag.appendChild(dash);

  // Nudge
  const nudge = nudgeText({
    currentDay,
    questsLeft: state.quests.filter((q) => !q.done).length,
    cardsDue: dueCount()
  });
  if (nudge) frag.appendChild(el('div', { class: 'nudge', text: nudge }));

  // Quests
  frag.appendChild(el('div', { class: 'section-title', text: currentDay > 0 ? `Today's Strategy Quests (Day ${currentDay})` : 'Strategy Quests (Preview)' }));
  const box = el('div', { class: 'quest-box' });
  for (const q of state.quests) {
    box.appendChild(questItem(q, currentDay));
  }
  frag.appendChild(box);

  // Daily review - auto-start if cards are due
  const due = dueCount();
  if (!review.active && due > 0) {
    review = { active: true, cards: getDueCards(), i: 0, flipped: false };
  }

  const reviewCard = el('div', { class: 'tool-card daily-flashcard-card' });
  reviewCard.appendChild(el('div', { class: 'tool-head' }, [
    el('h4', { text: '📚 Daily Flashcards' }),
    el('span', { class: 'pill', text: due > 0 ? `${due} due` : 'all clear' })
  ]));

  if (review.active && review.i < review.cards.length) {
    // Show the inline flashcard
    reviewCard.appendChild(renderReviewCard());
  } else if (due > 0) {
    // Fallback button if review isn't active but cards are due
    reviewCard.appendChild(el('button', {
      class: 'btn btn-mental full', dataset: { action: 'start-review-modal' },
      text: `Review ${due} card${due === 1 ? '' : 's'}`
    }));
  } else {
    // All cards reviewed
    reviewCard.appendChild(el('button', {
      class: 'btn btn-mental full', dataset: { action: 'goto-cards' },
      text: 'Browse decks'
    }));
  }
  frag.appendChild(reviewCard);

  // Hydration quick-add
  frag.appendChild(hydrationCard());

  // Workout timers
  const targets = computeTargets(currentDay);
  frag.appendChild(workoutCard(targets));

  // 66-day grid
  frag.appendChild(el('div', { class: 'section-title', text: '66-Day Transformation Map' }));
  const grid = el('div', { class: 'grid-66' });
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    let cls = 'block';
    if (state.daysRecord[i] === 'won') cls += ' won';
    else if (state.daysRecord[i] === 'missed') cls += ' missed';
    else if (i === currentDay && currentDay > 0) cls += ' current-target';
    grid.appendChild(el('div', { class: cls, text: String(i) }));
  }
  frag.appendChild(grid);

  // Re-attach timer displays after DOM build.
  queueMicrotask(() => mountWorkoutTimers(targets));
  return frag;
}

function rpgCard(kind, lvlText, label, xp) {
  const card = el('div', { class: 'rpg-card' });
  card.appendChild(el('span', { class: `badge ${kind}`, text: lvlText }));
  card.appendChild(el('div', { class: 'xp-label' }, [
    el('span', { text: label }), el('span', { text: `${xp} XP` })
  ]));
  const bg = el('div', { class: 'bar-bg' });
  bg.appendChild(el('div', { class: `bar-fill ${kind}`, style: { width: `${xp}%` } }));
  card.appendChild(bg);
  return card;
}

function questItem(q, currentDay) {
  const item = el('div', { class: `quest-item ${q.done ? 'done' : ''}` });
  const info = el('div', { class: 'quest-info' });
  info.appendChild(el('h4', { text: q.name }));
  if (q.desc) info.appendChild(el('p', { text: q.desc }));
  info.appendChild(el('span', {
    class: `type-indicator ${q.category === 'physical' ? 'p-tag' : 'm-tag'}`,
    text: `${q.category} (+${q.val} XP)`
  }));
  item.appendChild(info);
  const locked = currentDay === 0 || currentDay > TOTAL_DAYS;
  item.appendChild(el('button', {
    class: 'check-circle',
    'aria-label': q.done ? 'Mark incomplete' : 'Mark complete',
    dataset: locked ? { action: 'locked' } : { action: 'toggle-quest', id: String(q.id) },
    text: '✓'
  }));
  return item;
}

function hydrationCard() {
  const goal = state.settings.waterGoalMl || 3000;
  const ml = getWater();
  const card = el('div', { class: 'tool-card' });
  card.appendChild(el('div', { class: 'tool-head' }, [
    el('h4', { text: '💧 Hydration' }),
    el('span', { class: 'pill', text: `${ml} / ${goal} ml` })
  ]));
  const bg = el('div', { class: 'bar-bg lg' });
  bg.appendChild(el('div', { class: 'bar-fill water', style: { width: `${waterPct()}%` } }));
  card.appendChild(bg);
  const row = el('div', { class: 'btn-row' });
  row.appendChild(el('button', { class: 'btn', dataset: { action: 'water-add', ml: '250' }, text: '+250 ml' }));
  row.appendChild(el('button', { class: 'btn', dataset: { action: 'water-add', ml: '500' }, text: '+500 ml' }));
  row.appendChild(el('button', { class: 'btn ghost', dataset: { action: 'water-reset' }, text: 'Reset' }));
  card.appendChild(row);
  return card;
}

function workoutCard(targets) {
  const card = el('div', { class: 'tool-card' });
  card.appendChild(el('div', { class: 'tool-head' }, [el('h4', { text: '⏱️ Workout Timers' })]));

  // Run stopwatch
  const run = el('div', { class: 'timer-block' });
  run.appendChild(el('div', { class: 'timer-label' }, [
    el('span', { text: 'Run / Walk' }), el('span', { class: 'muted', text: `target ${targets.runText}` })
  ]));
  run.appendChild(el('div', { class: 'timer-clock', id: 'run-clock', text: '00:00' }));
  run.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', dataset: { action: 'run-start' }, text: 'Start' }),
    el('button', { class: 'btn ghost', dataset: { action: 'run-pause' }, text: 'Pause' }),
    el('button', { class: 'btn ghost', dataset: { action: 'run-reset' }, text: 'Reset' })
  ]));
  card.appendChild(run);

  // Plank countdown
  const plank = el('div', { class: 'timer-block' });
  plank.appendChild(el('div', { class: 'timer-label' }, [
    el('span', { text: 'Plank' }), el('span', { class: 'muted', text: `target ${targets.plankSeconds}s` })
  ]));
  plank.appendChild(el('div', { class: 'timer-clock', id: 'plank-clock', text: formatClock(targets.plankSeconds * 1000) }));
  plank.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', dataset: { action: 'plank-start' }, text: 'Start' }),
    el('button', { class: 'btn ghost', dataset: { action: 'plank-pause' }, text: 'Pause' }),
    el('button', { class: 'btn ghost', dataset: { action: 'plank-reset' }, text: 'Reset' })
  ]));
  card.appendChild(plank);
  return card;
}

function mountWorkoutTimers(targets) {
  if (!runSW) {
    runSW = createStopwatch((ms) => { const n = document.getElementById('run-clock'); if (n) n.textContent = formatClock(ms); });
  } else {
    const n = document.getElementById('run-clock'); if (n) n.textContent = formatClock(runSW.elapsed());
  }
  // Recreate plank countdown with today's target if needed.
  if (!plankCD) {
    plankCD = createCountdown(targets.plankSeconds, (ms) => {
      const n = document.getElementById('plank-clock'); if (n) n.textContent = formatClock(ms);
    }, () => toast('Plank complete! 💪'));
    plankCD._target = targets.plankSeconds;
  }
}

// ---- Cards screen -----------------------------------------------------------
function renderCards() {
  const frag = el('div');
  frag.appendChild(el('div', { class: 'section-title', text: 'Flashcards' }));

  if (review.active && review.i < review.cards.length) {
    frag.appendChild(renderReviewCard());
    return frag;
  }

  // Review entry / summary
  const due = getDueCards().length;
  const summary = el('div', { class: 'tool-card' });
  summary.appendChild(el('div', { class: 'tool-head' }, [
    el('h4', { text: due > 0 ? `${due} card${due === 1 ? '' : 's'} due` : 'Nothing due 🎉' }),
    el('span', { class: 'pill', text: `streak ${state.flashcards.reviewStreak}` })
  ]));
  if (due > 0) {
    summary.appendChild(el('button', { class: 'btn btn-mental full', dataset: { action: 'start-review' }, text: 'Start Review' }));
  } else {
    summary.appendChild(el('p', { class: 'muted', text: 'New cards unlock daily. Add your own below.' }));
  }
  frag.appendChild(summary);

  frag.appendChild(dailyShlokaCard());

  // Decks
  frag.appendChild(el('div', { class: 'section-title', text: 'Your Decks' }));
  for (const deck of getDecks()) {
    const s = deckStats(deck.id);
    const dcard = el('div', { class: 'tool-card' });
    dcard.appendChild(el('div', { class: 'tool-head' }, [
      el('h4', { text: deck.name }),
      el('span', { class: 'pill', text: `${s.total} cards · ${s.mastered} mastered` })
    ]));
    dcard.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', dataset: { action: 'add-card', deck: deck.id }, text: '+ Card' }),
      el('button', { class: 'btn ghost', dataset: { action: 'manage-deck', deck: deck.id }, text: 'Manage' }),
      ...(deck.builtin ? [] : [el('button', { class: 'btn danger ghost', dataset: { action: 'delete-deck', deck: deck.id }, text: 'Delete' })])
    ]));
    frag.appendChild(dcard);
  }
  frag.appendChild(el('button', { class: 'btn full', dataset: { action: 'add-deck' }, text: '+ New Deck' }));
  return frag;
}

function renderReviewCard() {
  const card = review.cards[review.i];
  const wrap = el('div', { class: 'flashcard-wrap' });
  wrap.appendChild(el('div', { class: 'review-progress', text: `Card ${review.i + 1} / ${review.cards.length}` }));
  const fc = el('div', { class: 'flashcard', dataset: { action: 'flip-card' } });
  fc.appendChild(el('div', { class: 'fc-face fc-front', text: card.front }));
  if (review.flipped) {
    fc.appendChild(el('div', { class: 'fc-divider' }));
    fc.appendChild(el('div', { class: 'fc-face fc-back', text: card.back || '—' }));
    if (card.tag) fc.appendChild(el('span', { class: 'fc-tag', text: card.tag }));
  } else {
    fc.appendChild(el('div', { class: 'fc-hint', text: 'Tap to reveal' }));
  }
  wrap.appendChild(fc);

  if (review.flipped) {
    wrap.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn danger full', dataset: { action: 'rate', rating: 'again' }, text: 'Again' }),
      el('button', { class: 'btn btn-success full', dataset: { action: 'rate', rating: 'good' }, text: 'Good' })
    ]));
  } else {
    wrap.appendChild(el('button', { class: 'btn btn-mental full', dataset: { action: 'flip-card' }, text: 'Reveal Answer' }));
  }
  wrap.appendChild(el('button', { class: 'btn ghost full', dataset: { action: 'end-review' }, text: 'End Session' }));
  return wrap;
}

// ---- Stats screen -----------------------------------------------------------
function dailyShlokaCard() {
  const today = todayKey();
  const card = el('div', { class: 'tool-card daily-shloka-card' });
  card.appendChild(el('div', { class: 'tool-head' }, [
    el('h4', { text: '📿 Verse of the Day' }),
    el('span', { class: 'pill', text: state.dailyShloka.date === today ? 'Today' : 'New' })
  ]));

  if (dailyShlokaError) {
    card.appendChild(el('p', { class: 'muted', text: dailyShlokaError }));
  }

  if (state.dailyShloka.date === today && state.dailyShloka.text) {
    card.appendChild(el('p', { class: 'muted', text: state.dailyShloka.text }));
    if (state.dailyShloka.author) card.appendChild(el('p', { class: 'muted', text: `— ${state.dailyShloka.author}` }));
    if (state.dailyShloka.source) card.appendChild(el('p', { class: 'muted', text: `source: ${state.dailyShloka.source}` }));
  } else {
    card.appendChild(el('p', { class: 'muted', text: 'Tap to fetch a fresh verse or devotional shloka from the internet.' }));
  }

  const row = el('div', { class: 'btn-row' });
  row.appendChild(el('button', {
    class: 'btn btn-mental full', dataset: { action: 'fetch-daily-shloka' },
    text: dailyShlokaLoading ? 'Fetching…' : 'Fetch Verse'
  }));
  if (state.dailyShloka.date === today && state.dailyShloka.text) {
    row.appendChild(el('button', { class: 'btn ghost full', dataset: { action: 'clear-daily-shloka' }, text: 'Clear' }));
  }
  row.appendChild(el('button', { class: 'btn ghost full', dataset: { action: 'open-verse' }, text: 'View Verse' }));
  card.appendChild(row);
  return card;
}

function openVerseModal() {
  const today = todayKey();
  const v = state.dailyShloka || {};
  const body = el('div');
  if (v.text) {
    body.appendChild(el('p', { class: 'muted', text: v.text }));
    if (v.author) body.appendChild(el('p', { class: 'muted', text: `— ${v.author}` }));
    if (v.source) body.appendChild(el('p', { class: 'muted', text: `source: ${v.source}` }));
  } else {
    body.appendChild(el('p', { class: 'muted', text: 'No verse available yet.' }));
  }
  if (currentModal) currentModal.close();
  currentModal = openModal('Verse of the Day', body, null);
}

function openReviewModal() {
  if (currentModal) currentModal.close();
  currentModal = openModal('Review Cards', renderReviewCard(), null);
}

function renderStats() {
  const currentDay = calculateCurrentDayNumber();
  const s = computeStats(currentDay);
  const frag = el('div');
  frag.appendChild(el('div', { class: 'section-title', text: 'Your Progress' }));

  const grid = el('div', { class: 'stat-grid' });
  grid.appendChild(statTile(`${s.completion}%`, 'Completion'));
  grid.appendChild(statTile(String(s.streak), 'Current Streak'));
  grid.appendChild(statTile(String(s.longestStreak), 'Longest Streak'));
  grid.appendChild(statTile(String(s.won), 'Days Won'));
  grid.appendChild(statTile(String(s.missed), 'Days Missed'));
  grid.appendChild(statTile(String(s.daysLeft), 'Days Left'));
  grid.appendChild(statTile(String(s.xp.total), 'Total XP'));
  grid.appendChild(statTile(String(s.reviews), 'Cards Reviewed'));
  frag.appendChild(grid);

  frag.appendChild(el('div', { class: 'section-title', text: 'XP Split' }));
  frag.appendChild(el('div', { class: 'chart-card', html: xpSplitSVG() }));

  frag.appendChild(el('div', { class: 'section-title', text: 'Weekly Wins' }));
  frag.appendChild(el('div', { class: 'chart-card', html: weeklyCompletionSVG() }));

  frag.appendChild(el('div', { class: 'section-title', text: 'Achievements' }));
  const ag = el('div', { class: 'achv-grid' });
  for (const a of getAchievements()) {
    const t = el('div', { class: `achv ${a.unlocked ? 'on' : 'off'}` });
    t.appendChild(el('div', { class: 'achv-icon', text: a.unlocked ? a.icon : '🔒' }));
    t.appendChild(el('div', { class: 'achv-name', text: a.name }));
    t.appendChild(el('div', { class: 'achv-desc', text: a.desc }));
    ag.appendChild(t);
  }
  frag.appendChild(ag);
  return frag;
}

function statTile(value, label) {
  return el('div', { class: 'stat-tile' }, [
    el('div', { class: 'stat-value', text: value }),
    el('div', { class: 'stat-label', text: label })
  ]);
}

// ---- Settings screen --------------------------------------------------------
function renderSettings() {
  const frag = el('div');
  frag.appendChild(el('div', { class: 'section-title', text: 'Settings' }));

  // Display & Theme
  frag.appendChild(el('div', { class: 'section-title sub', text: 'Display' }));
  const displayCard = el('div', { class: 'tool-card' });
  const currentTheme = state.settings.theme || 'dark';
  displayCard.appendChild(settingRow('Theme', currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1), 'toggle-theme', '🎨 Switch'));
  frag.appendChild(displayCard);

  // Custom quests
  frag.appendChild(el('div', { class: 'section-title sub', text: 'Quests' }));
  const qbox = el('div', { class: 'quest-box' });
  for (const q of state.quests) {
    const row = el('div', { class: 'manage-row' });
    row.appendChild(el('div', { class: 'manage-info' }, [
      el('h4', { text: q.name }),
      el('span', { class: 'muted', text: `${q.category} · +${q.val} XP${q.builtin ? ' · built-in' : ''}` })
    ]));
    row.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost sm', dataset: { action: 'edit-quest', id: String(q.id) }, text: 'Edit' }),
      el('button', { class: 'btn danger ghost sm', dataset: { action: 'delete-quest', id: String(q.id) }, text: 'Del' })
    ]));
    qbox.appendChild(row);
  }
  frag.appendChild(qbox);
  frag.appendChild(el('button', { class: 'btn full', dataset: { action: 'add-quest' }, text: '+ Add Quest' }));

  // Book + water goal + reminder
  frag.appendChild(el('div', { class: 'section-title sub', text: 'Targets' }));
  const targetsCard = el('div', { class: 'tool-card' });
  targetsCard.appendChild(settingRow('Book length', `${state.bookTotalPages || '—'} pages`, 'setup-book', 'Edit'));
  targetsCard.appendChild(settingRow('Water goal', `${state.settings.waterGoalMl} ml`, 'set-water-goal', 'Edit'));
  targetsCard.appendChild(settingRow('Reminder time', state.settings.reminderTime, 'set-reminder', 'Edit'));
  frag.appendChild(targetsCard);

  // Reminders
  frag.appendChild(el('div', { class: 'section-title sub', text: 'Reminders' }));
  const remCard = el('div', { class: 'tool-card' });
  remCard.appendChild(el('p', { class: 'muted', text: 'Add a recurring daily alert to your iOS Calendar (fires on the lock screen, no internet needed).' }));
  remCard.appendChild(el('button', { class: 'btn full', dataset: { action: 'export-ics' }, text: '📅 Download Daily Reminder (.ics)' }));
  frag.appendChild(remCard);

  // Backup
  frag.appendChild(el('div', { class: 'section-title sub', text: 'Backup & Data' }));
  const backup = el('div', { class: 'tool-card' });
  backup.appendChild(el('p', { class: 'muted', text: 'iOS can clear web-app storage. Export regularly to keep your progress safe.' }));
  backup.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', dataset: { action: 'export-json' }, text: '⬇️ Export' }),
    el('button', { class: 'btn', dataset: { action: 'import-json' }, text: '⬆️ Import' }),
    el('button', { class: 'btn danger ghost', dataset: { action: 'reset-all' }, text: 'Reset' })
  ]));
  frag.appendChild(backup);

  // Install hint
  const hint = el('div', { class: 'tool-card' });
  hint.appendChild(el('p', { class: 'muted', text: 'Tip: in Safari tap Share → "Add to Home Screen" to install this as a full-screen offline app, and check the README for the optional lock-screen widget.' }));
  frag.appendChild(hint);
  return frag;
}


function settingRow(label, value, action, btn) {
  return el('div', { class: 'set-row' }, [
    el('div', {}, [el('div', { text: label }), el('div', { class: 'muted', text: value })]),
    el('button', { class: 'btn ghost sm', dataset: { action }, text: btn })
  ]);
}

// ---- Event delegation -------------------------------------------------------
function wireEvents() {
  document.addEventListener('click', onClick);
}

function onClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const a = target.dataset.action;
  const currentDay = calculateCurrentDayNumber();

  switch (a) {
    case 'nav': activeTab = target.dataset.tab; render(); break;
    case 'goto-cards': activeTab = 'cards'; render(); break;
    case 'start-review-inline': startReview(); break;
    case 'start-review-modal':
      startReview();
      openReviewModal();
      break;
    case 'open-verse':
      openVerseModal();
      break;

    case 'toggle-quest': toggleQuest(parseInt(target.dataset.id, 10)); refresh(); break;
    case 'locked': toast('Locked until 17th June 2026 🔒'); break;

    case 'setup-book': setupBook(); break;
    case 'toggle-theme': toggleTheme(); break;
    case 'set-water-goal': setWaterGoal(); break;
    case 'set-reminder': setReminder(); break;

    case 'water-add': addWater(parseInt(target.dataset.ml, 10)); syncHydrationQuest(); refresh(); break;
    case 'water-reset': resetWater(); render(); break;

    case 'run-start': runSW?.start(); break;
    case 'run-pause': runSW?.pause(); break;
    case 'run-reset': runSW?.reset(); break;
    case 'plank-start': plankCD?.start(); break;
    case 'plank-pause': plankCD?.pause(); break;
    case 'plank-reset': plankCD?.reset(plankCD?._target); break;

    case 'start-review': startReview(); break;
    case 'flip-card': review.flipped = true; render(); break;
    case 'rate': doRate(target.dataset.rating); break;
    case 'end-review': review.active = false; refresh(); if (currentModal) { currentModal.close(); currentModal = null; } break;
    case 'fetch-daily-shloka': if (!dailyShlokaLoading) { fetchDailyShloka().then(() => render()); } break;
    case 'clear-daily-shloka': state.dailyShloka = { date: null, text: '', author: '', source: '' }; commitToDevice(); dailyShlokaError = ''; render(); break;

    case 'add-deck': onAddDeck(); break;
    case 'delete-deck': onDeleteDeck(target.dataset.deck); break;
    case 'add-card': onAddCard(target.dataset.deck); break;
    case 'manage-deck': onManageDeck(target.dataset.deck); break;

    case 'add-quest': onAddQuest(); break;
    case 'edit-quest': onEditQuest(parseInt(target.dataset.id, 10)); break;
    case 'delete-quest': onDeleteQuest(parseInt(target.dataset.id, 10)); break;

    case 'export-json': onExport(); break;
    case 'import-json': onImport(); break;
    case 'reset-all': onReset(); break;
    case 'export-ics': onExportICS(); break;
    default: break;
  }
  void currentDay;
}

// ---- Actions ----------------------------------------------------------------
function setupBook() {
  const pages = parseInt(prompt('Total pages in your Valmiki Ramayan edition:', String(state.bookTotalPages || 2304)), 10);
  if (pages > 0) { state.bookTotalPages = pages; commitToDevice(); render(); }
}
function setWaterGoal() {
  const ml = parseInt(prompt('Daily water goal in ml:', String(state.settings.waterGoalMl)), 10);
  if (ml > 0) { state.settings.waterGoalMl = ml; commitToDevice(); render(); }
}
function setReminder() {
  const t = prompt('Reminder time (HH:MM, 24h):', state.settings.reminderTime);
  if (t && /^\d{1,2}:\d{2}$/.test(t)) { state.settings.reminderTime = t; commitToDevice(); render(); }
}

function startReview() {
  review = { active: true, cards: getDueCards(), i: 0, flipped: false };
  if (review.cards.length === 0) { review.active = false; toast('Nothing due right now.'); }
  render();
}
function doRate(rating) {
  const card = review.cards[review.i];
  if (!card) return;
  const res = rateCard(card.id, rating);
  review.i++;
  review.flipped = false;
  if (res.sessionCleared) toast(`Session cleared! +${res.bonus} Mental XP 🧠`, 'achv');
  if (review.i >= review.cards.length) { review.active = false; }
  // Refresh UI and update modal if open
  refresh();
  if (currentModal) {
    currentModal.close();
    if (review.active) currentModal = openModal('Review Cards', renderReviewCard(), null);
    else currentModal = null;
  }
}

function onAddDeck() {
  const name = prompt('New deck name:', '');
  if (name && name.trim()) { addDeck(name.trim()); render(); }
}
function onDeleteDeck(deckId) {
  if (confirm('Delete this deck and all its cards?')) { deleteDeck(deckId); render(); }
}
function onAddCard(deckId) {
  formModal('Add Flashcard', [
    { key: 'front', label: 'Front (question)', type: 'textarea', value: '' },
    { key: 'back', label: 'Back (answer)', type: 'textarea', value: '' },
    { key: 'tag', label: 'Tag (optional)', type: 'text', value: '' }
  ], (v) => {
    if (!v.front.trim()) return false;
    addCard(deckId, v.front.trim(), v.back.trim(), v.tag.trim());
    toast('Card added');
    render();
  });
}
function onManageDeck(deckId) {
  const cards = getCardsByDeck(deckId);
  const body = el('div', { class: 'manage-list' });
  if (cards.length === 0) body.appendChild(el('p', { class: 'muted', text: 'No cards yet.' }));
  for (const c of cards) {
    const row = el('div', { class: 'manage-row' });
    row.appendChild(el('div', { class: 'manage-info' }, [
      el('h4', { text: c.front }),
      el('span', { class: 'muted', text: `box ${c.box} · due ${c.due}` })
    ]));
    row.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost sm', dataset: { action: 'edit-card-inline', card: c.id, deck: deckId }, text: 'Edit' }),
      el('button', { class: 'btn danger ghost sm', dataset: { action: 'del-card-inline', card: c.id, deck: deckId }, text: 'Del' })
    ]));
    body.appendChild(row);
  }
  const modal = openModal(`Manage Cards`, body, null);
  // Local delegation inside the modal.
  body.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'del-card-inline') {
      if (confirm('Delete this card?')) { deleteCard(t.dataset.card); modal.close(); onManageDeck(deckId); render(); }
    } else if (t.dataset.action === 'edit-card-inline') {
      const card = getCardsByDeck(deckId).find((x) => x.id === t.dataset.card);
      modal.close();
      formModal('Edit Flashcard', [
        { key: 'front', label: 'Front', type: 'textarea', value: card.front },
        { key: 'back', label: 'Back', type: 'textarea', value: card.back },
        { key: 'tag', label: 'Tag', type: 'text', value: card.tag || '' }
      ], (v) => { updateCard(card.id, { front: v.front.trim(), back: v.back.trim(), tag: v.tag.trim() }); onManageDeck(deckId); render(); });
    }
  });
}

function onAddQuest() {
  formModal('Add Quest', questFields({ name: '', desc: '', category: 'physical', val: 15 }), (v) => {
    if (!v.name.trim()) return false;
    addQuest({ name: v.name.trim(), desc: v.desc.trim(), category: v.category, val: parseInt(v.val, 10) });
    render();
  });
}
function onEditQuest(id) {
  const q = state.quests.find((x) => x.id === id);
  if (!q) return;
  formModal('Edit Quest', questFields(q), (v) => {
    updateQuest(id, { name: v.name.trim(), desc: v.desc.trim(), category: v.category, val: parseInt(v.val, 10) });
    render();
  });
}
function onDeleteQuest(id) {
  if (confirm('Delete this quest?')) { deleteQuest(id); render(); }
}
function questFields(q) {
  return [
    { key: 'name', label: 'Name', type: 'text', value: q.name },
    { key: 'desc', label: 'Description', type: 'textarea', value: q.desc },
    { key: 'category', label: 'Category', type: 'select', value: q.category, options: [['physical', 'Physical'], ['mental', 'Mental']] },
    { key: 'val', label: 'XP reward', type: 'number', value: q.val }
  ];
}

function onExport() {
  const blob = new Blob([exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().slice(0, 10);
  triggerDownload(url, `life-reset-backup-${ts}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup exported');
}
function onImport() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) { input.remove(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(String(reader.result));
        runChronologicalEngine();
        rollDailyReview();
        toast('Backup restored');
        render();
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
      input.remove();
    };
    reader.readAsText(file);
  });
  input.click();
}
function onReset() {
  if (confirm('Erase ALL progress and start over? This cannot be undone.')) {
    resetData();
    review = { active: false, cards: [], i: 0, flipped: false };
    ensureSeed().then(() => render());
    render();
    toast('All data reset');
  }
}
function onExportICS() {
  const blob = new Blob([buildICS()], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, 'life-reset-daily-reminder.ics');
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Open the file to add it to Calendar');
}
function triggerDownload(url, filename) {
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---- Modal + toast ----------------------------------------------------------
function openModal(title, bodyNode, onSave) {
  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal' });
  modal.appendChild(el('div', { class: 'modal-title', text: title }));
  modal.appendChild(bodyNode);
  const actions = el('div', { class: 'btn-row' });
  const close = () => overlay.remove();
  actions.appendChild(el('button', { class: 'btn ghost', dataset: { mclose: '1' }, text: 'Close' }));
  if (onSave) actions.appendChild(el('button', { class: 'btn btn-mental', dataset: { msave: '1' }, text: 'Save' }));
  modal.appendChild(actions);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.mclose) close();
    if (e.target.dataset.msave && onSave) { if (onSave() !== false) close(); }
  });
  document.body.appendChild(overlay);
  return { close, overlay };
}

function formModal(title, fields, onSubmit) {
  const body = el('div', { class: 'form-body' });
  const refs = {};
  for (const f of fields) {
    const group = el('div', { class: 'form-group' });
    group.appendChild(el('label', { text: f.label }));
    let input;
    if (f.type === 'textarea') input = el('textarea', { rows: '3' });
    else if (f.type === 'select') {
      input = el('select');
      for (const [val, lbl] of f.options) {
        const opt = el('option', { value: val, text: lbl });
        if (val === f.value) opt.selected = true;
        input.appendChild(opt);
      }
    } else input = el('input', { type: f.type || 'text' });
    if (f.type !== 'select') input.value = f.value ?? '';
    refs[f.key] = input;
    group.appendChild(input);
    body.appendChild(group);
  }
  openModal(title, body, () => {
    const values = {};
    for (const k of Object.keys(refs)) values[k] = refs[k].value;
    return onSubmit(values);
  });
}

let toastTimer = null;
function toast(msg, kind = '') {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts' }); document.body.appendChild(host); }
  const t = el('div', { class: `toast ${kind}`, text: msg });
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  void toastTimer;
}

// Go.
boot();
