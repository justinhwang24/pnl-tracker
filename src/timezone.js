export const defaultTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function dateFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export function dateInZone(timestamp, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function timeZones() {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['UTC', defaultTimeZone(), 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', ...supported])].sort();
}
