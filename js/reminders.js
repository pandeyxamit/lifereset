// reminders.js — in-app nudge text + downloadable .ics for a native iOS daily alert.
import { state } from './state.js';
import { START_DATE_MS, TOTAL_DAYS, pad2 } from './util.js';

// Short nudge for the Today screen. Returns null when nothing is pending.
export function nudgeText({ currentDay, questsLeft, cardsDue }) {
  if (currentDay < 1 || currentDay > TOTAL_DAYS) return null;
  const bits = [];
  if (questsLeft > 0) bits.push(`${questsLeft} quest${questsLeft === 1 ? '' : 's'}`);
  if (cardsDue > 0) bits.push(`${cardsDue} flashcard${cardsDue === 1 ? '' : 's'}`);
  if (bits.length === 0) return null;
  return `⏳ ${bits.join(' + ')} left today — finish strong.`;
}

function icsDate(dateMs) {
  const d = new Date(dateMs);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

// Build a floating-local-time daily recurring reminder for the 66-day window.
export function buildICS() {
  const [hh, mm] = (state.settings.reminderTime || '06:30').split(':');
  const start = new Date(START_DATE_MS);
  const dtStart = `${icsDate(START_DATE_MS)}T${pad2(parseInt(hh, 10) || 6)}${pad2(parseInt(mm, 10) || 30)}00`;
  const stamp = `${icsDate(Date.now())}T000000Z`;
  void start;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//66DayLifeReset//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:lifereset-daily-quest@local',
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    'DURATION:PT15M',
    `RRULE:FREQ=DAILY;COUNT=${TOTAL_DAYS}`,
    "SUMMARY:66 Day Life Reset — Today's Quests",
    'DESCRIPTION:Complete your physical + mental quests and review your flashcards.',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Life Reset',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}
