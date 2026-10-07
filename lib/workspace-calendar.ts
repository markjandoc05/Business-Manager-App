const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let value = formatters.get(timeZone);
  if (!value) { value = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); formatters.set(timeZone, value); }
  return value;
}

export function getWorkspaceCalendarDate(date = new Date(), timeZone = 'UTC') {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function calendarDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid calendar date.');
  const value = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== day) throw new Error('Choose a valid calendar date.');
  return value;
}

export function addCalendarDays(day: string, days: number) {
  const value = calendarDate(day); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** First instant in a workspace day, including zones with midnight DST gaps. */
export function workspaceDayStart(day: string, timeZone = 'UTC') {
  const midnight = calendarDate(day).getTime();
  let low = midnight - 36 * 3_600_000; let high = midnight + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (getWorkspaceCalendarDate(new Date(middle), timeZone) < day) low = middle + 1; else high = middle;
  }
  if (getWorkspaceCalendarDate(new Date(low), timeZone) !== day) throw new Error('This calendar date does not exist in the workspace timezone.');
  return new Date(low);
}

export function workspaceCalendarRange(startDay: string, endDay: string, timeZone = 'UTC') {
  if (startDay >= endDay) throw new Error('The end date must follow the start date.');
  return { start: workspaceDayStart(startDay, timeZone), end: workspaceDayStart(endDay, timeZone), startDay, endDay, timeZone };
}

export function rollingWorkspaceRange(days: number, now = new Date(), timeZone = 'UTC') {
  const today = getWorkspaceCalendarDate(now, timeZone);
  return workspaceCalendarRange(addCalendarDays(today, 1 - days), addCalendarDays(today, 1), timeZone);
}

export type ReportPeriod = 'ThisMonth' | 'LastMonth' | 'ThisQuarter' | 'ThisYear';
export function workspaceReportRange(period: ReportPeriod, now = new Date(), timeZone = 'UTC') {
  const today = getWorkspaceCalendarDate(now, timeZone); const [year, month] = today.split('-').map(Number);
  let startDay = `${year}-${String(month).padStart(2, '0')}-01`; let endDay = addCalendarDays(today, 1);
  if (period === 'LastMonth') { endDay = startDay; startDay = addCalendarDays(startDay, -1).slice(0, 7) + '-01'; }
  if (period === 'ThisQuarter') startDay = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  if (period === 'ThisYear') startDay = `${year}-01-01`;
  return workspaceCalendarRange(startDay, endDay, timeZone);
}
