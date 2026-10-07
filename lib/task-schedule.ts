/** Legacy wall times have no recoverable source timezone; never migrate them implicitly. */
export function isLegacyTaskSchedule(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value);
}

/** datetime-local is the operator's browser time; explicit offsets identify instants. */
export function normalizeTaskSchedule(value: string, previous?: string) {
  if (previous && isLegacyTaskSchedule(previous) && (value === previous || value === previous.slice(0, 16))) return previous;
  if (previous && !isLegacyTaskSchedule(previous) && isLegacyTaskSchedule(value)) {
    const existing = new Date(previous);
    if (Number.isFinite(existing.getTime())) {
      const localInput = new Date(existing.getTime() - existing.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      if (value === localInput) return existing.toISOString();
    }
  }
  if (!isLegacyTaskSchedule(value) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Choose a valid Task date and time.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid Task date and time.');
  const [year, month, day, hour, minute, second] = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)!.slice(1).map((part) => Number(part || 0));
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) throw new Error('Choose a valid Task date and time.');
  if (isLegacyTaskSchedule(value)) {
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) throw new Error('This local date and time does not exist. Choose another time.');
    for (const minutes of [30, 60, 120]) {
      const later = new Date(date.getTime() + minutes * 60000);
      if (later.getFullYear() === year && later.getMonth() + 1 === month && later.getDate() === day && later.getHours() === hour && later.getMinutes() === minute) throw new Error('This local time occurs twice during a timezone change. Choose an unambiguous time.');
    }
  }
  return date.toISOString();
}
