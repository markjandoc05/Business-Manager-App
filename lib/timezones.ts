export const COMMON_TIMEZONES = [
  'Asia/Manila',
  'UTC',
  'Asia/Singapore',
  'Australia/Sydney',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
] as const;

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}
