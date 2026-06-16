// flashcards.js — Leitner 5-box spaced repetition over the app's day boundaries.
import { state, commitToDevice, awardXp } from './state.js';
import { todayKey, addDays, daysBetween, uid } from './util.js';

// Days until a card in each box becomes due again.
export const LEITNER_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
const GOOD_XP = 3;
const AGAIN_XP = 1;
const SESSION_BONUS_XP = 10;

// Load the seed deck once (first run, online). Safe to call repeatedly.
export async function ensureSeed() {
  const fc = state.flashcards;
  if (fc.seeded || fc.decks.length > 0) { fc.seeded = true; return; }
  try {
    const res = await fetch('data/ramayan-deck.json', { cache: 'no-cache' });
    if (!res.ok) return; // try again next launch
    const data = await res.json();
    const today = todayKey();
    const deckId = uid();
    fc.decks.push({ id: deckId, name: data?.deck?.name || 'Valmiki Ramayan', builtin: true });
    for (const c of (data.cards || [])) {
      if (!c || !c.front) continue;
      fc.cards.push({
        id: uid(), deckId,
        front: String(c.front), back: String(c.back || ''),
        tag: c.tag || '',
        box: 1, due: today, lastReviewed: null
      });
    }
    fc.seeded = true;
    commitToDevice();
  } catch (e) {
    console.warn('Seed deck fetch failed (will retry next launch):', e);
  }
}

// Daily roll: reset per-day counters once the calendar date changes.
export function rollDailyReview() {
  const fc = state.flashcards;
  const today = todayKey();
  if (fc.lastReviewDay !== today) {
    fc.newIntroducedToday = 0;
    fc.reviewedTodayCount = 0;
    fc.lastReviewDay = today;
    // Break the review streak if a full day was skipped.
    if (fc.lastReviewStreakDay && daysBetween(fc.lastReviewStreakDay, today) > 1) {
      fc.reviewStreak = 0;
    }
    commitToDevice();
  }
}

// Cards to study now: all overdue review cards + a capped batch of new cards.
export function getDueCards() {
  const fc = state.flashcards;
  const today = todayKey();
  const reviewDue = fc.cards
    .filter((c) => c.lastReviewed && c.due <= today)
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  const allowance = Math.max(0, fc.newPerDay - fc.newIntroducedToday);
  const newCards = fc.cards.filter((c) => !c.lastReviewed).slice(0, allowance);
  return [...reviewDue, ...newCards];
}

export function dueCount() {
  return getDueCards().length;
}

// Rate a card. rating: 'good' | 'again'. Returns { sessionCleared, bonus }.
export function rateCard(cardId, rating) {
  const fc = state.flashcards;
  const card = fc.cards.find((c) => c.id === cardId);
  if (!card) return { sessionCleared: false, bonus: 0 };

  const wasNew = !card.lastReviewed;
  const today = todayKey();

  if (rating === 'good') card.box = Math.min(5, card.box + 1);
  else card.box = 1;

  card.due = addDays(today, LEITNER_INTERVALS[card.box]);
  card.lastReviewed = today;

  if (wasNew) fc.newIntroducedToday++;
  fc.reviewedTodayCount++;
  fc.totalReviews++;
  awardXp('mental', rating === 'good' ? GOOD_XP : AGAIN_XP);

  // Session-cleared bonus (once per day).
  let bonus = 0;
  let sessionCleared = false;
  if (dueCount() === 0 && fc.reviewedTodayCount > 0 && fc.sessionRewardDay !== today) {
    bonus = SESSION_BONUS_XP;
    awardXp('mental', bonus);
    fc.sessionRewardDay = today;
    sessionCleared = true;
    // Maintain the daily review streak.
    if (fc.lastReviewStreakDay && daysBetween(fc.lastReviewStreakDay, today) === 1) {
      fc.reviewStreak++;
    } else {
      fc.reviewStreak = 1;
    }
    fc.lastReviewStreakDay = today;
  }

  commitToDevice();
  return { sessionCleared, bonus };
}

// ---- Deck / card management -------------------------------------------------
export function getDecks() {
  return state.flashcards.decks;
}

export function getCardsByDeck(deckId) {
  return state.flashcards.cards.filter((c) => c.deckId === deckId);
}

export function deckStats(deckId) {
  const cards = getCardsByDeck(deckId);
  const today = todayKey();
  return {
    total: cards.length,
    due: cards.filter((c) => !c.lastReviewed || c.due <= today).length,
    mastered: cards.filter((c) => c.box >= 5).length
  };
}

export function addDeck(name) {
  const deck = { id: uid(), name: String(name || 'New Deck').slice(0, 60), builtin: false };
  state.flashcards.decks.push(deck);
  commitToDevice();
  return deck;
}

export function addCard(deckId, front, back, tag = '') {
  if (!front) return null;
  const card = {
    id: uid(), deckId,
    front: String(front).slice(0, 300),
    back: String(back || '').slice(0, 600),
    tag: String(tag || '').slice(0, 40),
    box: 1, due: todayKey(), lastReviewed: null
  };
  state.flashcards.cards.push(card);
  commitToDevice();
  return card;
}

export function updateCard(cardId, patch) {
  const card = state.flashcards.cards.find((c) => c.id === cardId);
  if (!card) return false;
  if (patch.front != null) card.front = String(patch.front).slice(0, 300);
  if (patch.back != null) card.back = String(patch.back).slice(0, 600);
  if (patch.tag != null) card.tag = String(patch.tag).slice(0, 40);
  commitToDevice();
  return true;
}

export function deleteCard(cardId) {
  const fc = state.flashcards;
  const i = fc.cards.findIndex((c) => c.id === cardId);
  if (i === -1) return false;
  fc.cards.splice(i, 1);
  commitToDevice();
  return true;
}

export function deleteDeck(deckId) {
  const fc = state.flashcards;
  fc.cards = fc.cards.filter((c) => c.deckId !== deckId);
  fc.decks = fc.decks.filter((d) => d.id !== deckId);
  commitToDevice();
  return true;
}
