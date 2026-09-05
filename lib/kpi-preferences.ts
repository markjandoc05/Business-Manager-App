export function readKpiPreference(storage: Pick<Storage, 'getItem'> | null | undefined, key: string, defaults: readonly string[], knownIds: readonly string[], minimum = 3, maximum = 8) {
  if (!storage) return [...defaults];
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!Array.isArray(saved)) return [...defaults];
    const known = new Set(knownIds);
    const ids = [...new Set(saved.filter((id): id is string => typeof id === 'string' && known.has(id)))];
    if (ids.length >= minimum && ids.length <= maximum) return ids;
  } catch { /* use defaults */ }
  return [...defaults];
}

export function writeKpiPreference(storage: Pick<Storage, 'setItem'> | null | undefined, key: string, ids: readonly string[]) {
  try { storage?.setItem(key, JSON.stringify(ids)); } catch { /* preferences are best effort */ }
}

export function reorderKpiIds(items: readonly string[], fromId: string, toId: string) {
  const next = [...items]; const fromIndex = next.indexOf(fromId); const toIndex = next.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return next;
  next.splice(fromIndex, 1); next.splice(toIndex, 0, fromId); return next;
}
