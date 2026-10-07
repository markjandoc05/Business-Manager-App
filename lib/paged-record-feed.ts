import { appendUniqueById, userFacingErrorMessage } from './repositories/pagination.ts';

export function createPagedRecordFeed<T extends { id: string }, Cursor>(load: (cursor: Cursor | null) => Promise<{ items: T[]; nextCursor: Cursor | null; hasMore: boolean }>) {
  const empty = () => ({ items: [] as T[], cursor: null as Cursor | null, hasMore: false, loading: false, error: null as string | null });
  let state = empty(); let epoch = 0; let active = false; let loadedPages = 0;
  let failedRequest: 'initial' | 'more' | 'refresh' | null = null;
  const listeners = new Set<() => void>();
  function publish(next: typeof state) { state = next; listeners.forEach((listener) => listener()); }
  async function request(reset: boolean) {
    if (!active || state.loading || (!reset && (!state.hasMore || failedRequest === 'refresh'))) return false;
    const ticket = epoch; const cursor = reset ? null : state.cursor;
    publish({ ...state, loading: true, error: null });
    try {
      const page = await load(cursor);
      if (!active || ticket !== epoch) return false;
      loadedPages = reset ? 1 : loadedPages + 1; failedRequest = null;
      publish({ items: appendUniqueById(reset ? [] : state.items, page.items), cursor: page.nextCursor, hasMore: page.hasMore, loading: false, error: null });
      return true;
    } catch (error) {
      if (!active || ticket !== epoch) return false;
      failedRequest = reset ? 'initial' : 'more';
      publish({ ...state, loading: false, error: userFacingErrorMessage(error, 'Unable to load this Client history. Please try again.') });
      return false;
    }
  }
  async function refresh() {
    if (!active) return false;
    const ticket = ++epoch; const pagesToLoad = Math.max(1, loadedPages);
    // Preserve visible rows (and open details) while rebuilding the same loaded
    // window. A new identity receives a separate empty feed instead.
    publish({ ...state, loading: true, error: null });
    let items: T[] = []; let cursor: Cursor | null = null; let hasMore = false; let pages = 0;
    try {
      do {
        const page = await load(cursor);
        if (!active || ticket !== epoch) return false;
        items = appendUniqueById(items, page.items); cursor = page.nextCursor; hasMore = page.hasMore; pages++;
      } while (hasMore && pages < pagesToLoad);
      loadedPages = pages; failedRequest = null;
      publish({ items, cursor, hasMore, loading: false, error: null });
      return true;
    } catch (error) {
      if (!active || ticket !== epoch) return false;
      failedRequest = 'refresh';
      publish({ ...state, loading: false, error: userFacingErrorMessage(error, 'Unable to load this Client history. Please try again.') });
      return false;
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => { epoch++; active = true; loadedPages = 0; failedRequest = null; publish(empty()); return request(true); },
    loadMore: () => request(false),
    refresh,
    retry: () => state.loading ? Promise.resolve(false) : failedRequest === 'more' ? request(false) : refresh(),
    dispose: () => { active = false; epoch++; },
  };
}
