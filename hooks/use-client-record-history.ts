'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPagedRecordFeed } from '@/lib/paged-record-feed';
import type { AppUser } from '@/types/auth';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';

export function useClientRecordHistory<T extends { id: string }>(user: AppUser | null, organizationId: string | null, clientId: string | null, role: string | undefined, ready: boolean, archived: boolean, enabled: boolean, reloadToken: number, loader: (user: AppUser | null, organizationId: string, clientId: string, cursor: FirestoreCursor, archived: boolean) => Promise<PageResult<T>>) {
  // A new feed hides prior identity/tenant/Client/role data immediately. Its
  // disposal also invalidates pending responses, including Strict Mode replay.
  const feed = useMemo(() => createPagedRecordFeed<T, FirestoreCursor>(async (cursor) => {
    if (!user || !organizationId || !clientId || !ready || !enabled) return { items: [], nextCursor: null, hasMore: false };
    return loader(user, organizationId, clientId, cursor, archived);
  }), [user, organizationId, clientId, role, ready, archived, enabled, loader]);
  const state = useSyncExternalStore(feed.subscribe, feed.snapshot, feed.snapshot);
  useEffect(() => { void feed.start(); return feed.dispose; }, [feed]);
  const lastRefresh = useRef({ feed, reloadToken });
  useEffect(() => {
    if (lastRefresh.current.feed === feed && lastRefresh.current.reloadToken !== reloadToken) void feed.refresh();
    lastRefresh.current = { feed, reloadToken };
  }, [feed, reloadToken]);
  // Block actions in the render that requests a refresh, before effects run:
  // retained rows can still contain the status from before a successful write.
  const refreshRequested = lastRefresh.current.feed === feed && lastRefresh.current.reloadToken !== reloadToken;
  return { ...state, loading: state.loading || refreshRequested, loadMore: feed.loadMore, reload: feed.retry };
}
