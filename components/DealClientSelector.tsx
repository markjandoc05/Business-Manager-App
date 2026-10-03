'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/core';
import {
  createDealClientSearchCache,
  DEAL_CLIENT_SEARCH_DEBOUNCE_MS,
  DEAL_CLIENT_SEARCH_LIMIT,
  DEAL_CLIENT_SEARCH_MIN_LENGTH,
  getInitialDealClientOptions,
  isSelectableDealClient,
} from '@/lib/deal-client-selector';
import { searchActiveClients } from '@/lib/repositories/clients';
import type { Client } from '@/types';
import type { AppUser } from '@/types/auth';

export function DealClientSelector({
  user,
  organizationId,
  initialClients,
  initialLoading,
  selectedClient,
  disabled = false,
  onSelect,
}: {
  user: AppUser;
  organizationId: string;
  initialClients: Client[];
  initialLoading: boolean;
  selectedClient: Client | null;
  disabled?: boolean;
  onSelect: (client: Client | null) => void;
}) {
  const inputId = useId();
  const statusId = useId();
  const listboxId = useId();
  const defaultOptions = useMemo(() => getInitialDealClientOptions(initialClients), [initialClients]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Client[]>(defaultOptions);
  const [listOpen, setListOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const cacheRef = useRef(createDealClientSearchCache<Client>());
  const scopeRef = useRef(organizationId);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    let cancelled = false;
    if (scopeRef.current !== organizationId) {
      cacheRef.current.clear();
      scopeRef.current = organizationId;
    }

    const term = query.trim();
    setError(false);
    if (term.length > 0 && term.length < DEAL_CLIENT_SEARCH_MIN_LENGTH) {
      setSearching(false);
      setResults([]);
      setActiveIndex(-1);
      return () => { cancelled = true; };
    }
    if (!term && (initialLoading || defaultOptions.length > 0)) {
      setSearching(false);
      setResults(defaultOptions);
      setActiveIndex(-1);
      return () => { cancelled = true; };
    }

    setSearching(true);
    if (term) setResults([]);
    const timer = window.setTimeout(() => {
      void cacheRef.current.resolve(
        organizationId,
        term,
        () => searchActiveClients(user, organizationId, term, DEAL_CLIENT_SEARCH_LIMIT),
      ).then((clients) => {
        if (cancelled || requestId !== requestRef.current || scopeRef.current !== organizationId) return;
        setResults(clients.filter(isSelectableDealClient).slice(0, DEAL_CLIENT_SEARCH_LIMIT));
        setActiveIndex(-1);
      }).catch((cause) => {
        console.error('Unable to search Deal clients', cause);
        if (!cancelled && requestId === requestRef.current && scopeRef.current === organizationId) setError(true);
      }).finally(() => {
        if (!cancelled && requestId === requestRef.current && scopeRef.current === organizationId) setSearching(false);
      });
    }, term ? DEAL_CLIENT_SEARCH_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [defaultOptions, initialLoading, organizationId, query, retryVersion, user]);

  const term = query.trim();
  const showResults = !searching && !error && (term.length === 0 || term.length >= DEAL_CLIENT_SEARCH_MIN_LENGTH);
  const resultListVisible = listOpen && showResults && results.length > 0;
  const activeOptionId = resultListVisible && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  const selectClient = (client: Client) => {
    onSelect(client);
    setQuery('');
    setListOpen(false);
    setActiveIndex(-1);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && listOpen) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setListOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setListOpen(true);
      if (results.length === 0) return;
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') return current < 0 || current >= results.length - 1 ? 0 : current + 1;
        return current <= 0 ? results.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === 'Enter' && resultListVisible && activeIndex >= 0) {
      event.preventDefault();
      selectClient(results[activeIndex]);
    }
  };

  return <div className="space-y-2">
    <label htmlFor={inputId} className="block text-sm font-medium text-[var(--app-text)]">
      Client
      <span className="ml-1 text-[var(--app-danger)]" aria-hidden="true">*</span>
    </label>
    {selectedClient && <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-accent-soft)] px-3 py-2.5" aria-live="polite">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--app-text)]">{selectedClient.name}</p>
        {selectedClient.company && <p className="truncate text-xs text-[var(--app-muted)]">{selectedClient.company}</p>}
      </div>
      <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={disabled} onClick={() => onSelect(null)}><X size={15} aria-hidden="true" /> Clear</Button>
    </div>}
    <div className="relative">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" />
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        className="w-full rounded-xl border py-2 pl-9 pr-3 text-base sm:text-sm"
        value={query}
        disabled={disabled}
        aria-describedby={statusId}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={resultListVisible}
        aria-activedescendant={activeOptionId}
        placeholder={selectedClient ? 'Search to change Client' : 'Search name, company, email, or phone'}
        onFocus={() => setListOpen(true)}
        onKeyDown={handleSearchKeyDown}
        onChange={(event) => { setQuery(event.target.value); setListOpen(true); setActiveIndex(-1); }}
      />
    </div>
    <div id={statusId} aria-live="polite">
      {initialLoading && !term && defaultOptions.length === 0 ? <p className="text-xs text-[var(--app-muted)]">Loading Clients…</p>
        : searching ? <p className="text-xs text-[var(--app-muted)]">Searching Clients…</p>
          : error ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--app-surface-subtle)] p-2.5 text-xs text-[var(--app-muted)]"><span>Unable to search Clients. Check your connection and try again.</span><Button type="button" size="sm" variant="outline" onClick={() => { cacheRef.current.clear(); setRetryVersion((current) => current + 1); }}>Retry</Button></div>
            : term.length > 0 && term.length < DEAL_CLIENT_SEARCH_MIN_LENGTH ? <p className="text-xs text-[var(--app-muted)]">Enter at least {DEAL_CLIENT_SEARCH_MIN_LENGTH} characters to search.</p>
              : showResults && results.length === 0 ? <p className="text-xs text-[var(--app-muted)]">{term ? 'No matching active Clients found.' : 'No active Clients available.'}</p>
                : null}
    </div>
    {resultListVisible && <div id={listboxId} role="listbox" className="max-h-44 divide-y divide-[var(--app-border-subtle)] overflow-y-auto rounded-xl border border-[var(--app-border)]" aria-label={term ? 'Matching Clients' : 'Available Clients'}>
      {results.map((client, index) => <button
        key={client.id}
        id={`${listboxId}-option-${index}`}
        type="button"
        role="option"
        tabIndex={-1}
        className={`block min-h-11 w-full px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-subtle)] ${activeIndex === index ? 'bg-[var(--app-accent-soft)] ring-2 ring-inset ring-[var(--app-primary)]' : selectedClient?.id === client.id ? 'bg-[var(--app-accent-soft)]' : 'bg-white'}`}
        aria-selected={selectedClient?.id === client.id}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectClient(client)}
      >
        <span className="block truncate text-sm font-semibold text-[var(--app-text)]">{client.name}</span>
        <span className="block truncate text-xs text-[var(--app-muted)]">{[client.company, client.email, client.phone].filter(Boolean).join(' · ') || 'Client record'}</span>
      </button>)}
    </div>}
    {!selectedClient && <p className="text-xs text-[var(--app-muted)]">Select an active Client to create this Deal.</p>}
  </div>;
}
