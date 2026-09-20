import { defaultTimeZone, dateFormatter } from './timezone.js';

export function calendarPreferences(user, fallbackTimeZone = defaultTimeZone()) {
  const saved = user?.user_metadata?.calendar_preferences || {};
  let timeZone = saved.timeZone || fallbackTimeZone;
  try { dateFormatter(timeZone); } catch { timeZone = defaultTimeZone(); }
  return {
    timeZone,
    showTrades: typeof saved.showTrades === 'boolean' ? saved.showTrades : true,
    rounding: typeof saved.rounding === 'boolean' ? saved.rounding : true,
    weekStart: Number.isInteger(saved.weekStart) && saved.weekStart >= 0 && saved.weekStart <= 6 ? saved.weekStart : 1,
  };
}
