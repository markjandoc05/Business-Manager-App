'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button } from '@/components/ui/core';
import { MoneyInput } from '@/components/MoneyInput';
import { ModalHeader } from '@/components/ModalCloseButton';
import { formatCurrency } from '@/lib/formatting';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { changeDealQuantity, createDealLineItem, createOtherDealLineItem, DEAL_LINE_ITEM_LIMIT, getDealValue, recalculateDealLineItem } from '@/lib/deal-items';
import { listSelectableCatalogItems } from '@/lib/repositories/catalogItems';
import type { AppUser } from '@/types/auth';
import type { CatalogItem, DealLineItem } from '@/types';

type CatalogTypeFilter = 'All' | 'PRODUCT' | 'SERVICE';

function QuantityStepper({ quantity, label, disabled, onChange }: {
  quantity: number;
  label: string;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  return <div className="flex items-center gap-1">
    <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--app-border)] bg-white text-[var(--app-text)] transition-colors hover:bg-[var(--app-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Decrease quantity for ${label}`} onClick={() => onChange(changeDealQuantity(quantity, -1))} disabled={disabled || quantity <= 1}><Minus size={15} aria-hidden="true" /></button>
    <input type="number" min="1" step="1" inputMode="numeric" aria-label={`Quantity for ${label}`} className="h-10 w-14 rounded-lg border border-[var(--app-border)] bg-white px-2 text-center text-sm" value={quantity} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} />
    <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--app-border)] bg-white text-[var(--app-text)] transition-colors hover:bg-[var(--app-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Increase quantity for ${label}`} onClick={() => onChange(changeDealQuantity(quantity, 1))} disabled={disabled}><Plus size={15} aria-hidden="true" /></button>
  </div>;
}

export function DealCatalogItemsField({ user, organizationId, items, currency, dealValue = 0, disabled = false, expanded = true, onToggle, onChange }: {
  user: AppUser;
  organizationId: string;
  items: DealLineItem[];
  currency: string;
  dealValue?: number;
  disabled?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onChange: (items: DealLineItem[]) => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>('All');
  const selectedIds = useMemo(() => new Set(items.filter((item) => item.source === 'CATALOG' && item.catalogItemId).map((item) => item.catalogItemId)), [items]);
  const visibleCatalogItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalogItems.filter((item) => {
      const searchable = [item.name, item.code || '', item.category || ''].join(' ').toLocaleLowerCase();
      return (typeFilter === 'All' || item.type === typeFilter) && (!query || searchable.includes(query));
    });
  }, [catalogItems, search, typeFilter]);

  const openSelector = async () => {
    if (disabled) return;
    setSelectorOpen(true);
    setSearch('');
    setTypeFilter('All');
    setLoading(true);
    setLoadError(null);
    try {
      setCatalogItems(await listSelectableCatalogItems(user, organizationId));
    } catch (error) {
      console.error('Unable to load selectable catalog items', error);
      setLoadError(userFacingErrorMessage(error, 'Unable to load catalog items. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const addCatalogItem = (catalogItem: CatalogItem) => {
    if (items.length >= DEAL_LINE_ITEM_LIMIT || selectedIds.has(catalogItem.id)) return;
    onChange([...items, createDealLineItem(catalogItem)]);
  };

  const addOther = () => {
    if (disabled || items.length >= DEAL_LINE_ITEM_LIMIT) return;
    onChange([...items, createOtherDealLineItem('Other item', 0)]);
  };

  const updateLine = (index: number, changes: Partial<Pick<DealLineItem, 'name' | 'quantity' | 'unitPrice'>>) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? recalculateDealLineItem(item, changes) : item));
  };

  const collapsible = typeof onToggle === 'function';
  const sectionExpanded = collapsible ? expanded : true;
  const summary = `Products & Services · ${items.length} ${items.length === 1 ? 'item' : 'items'} · ${formatCurrency(getDealValue(dealValue, items), currency)}`;

  return <section className="space-y-2 rounded-xl border border-[var(--app-border-subtle)] bg-[var(--app-surface-subtle)]/55 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      {collapsible ? <button type="button" className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" onClick={onToggle} aria-expanded={sectionExpanded} aria-controls="deal-products-services-content" disabled={disabled}>
        <span className="mt-0.5 shrink-0 text-[var(--app-muted)]">{sectionExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span>
        <span className="min-w-0"><span className="block break-words text-sm font-bold text-[var(--app-text)]">{summary}</span><span className="mt-1 block text-xs text-[var(--app-muted)]">{sectionExpanded ? 'Add items from your Catalog or enter a deal-only item that is not listed.' : 'Click to expand and edit line items.'}</span></span>
      </button> : <div className="min-w-0"><h4 className="text-sm font-bold text-[var(--app-text)]">Products &amp; Services</h4><p className="mt-1 text-xs text-[var(--app-muted)]">Add items from your Catalog or enter a deal-only item that is not listed.</p></div>}
      {sectionExpanded && <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => void openSelector()} disabled={disabled || items.length >= DEAL_LINE_ITEM_LIMIT}><Plus size={14} /> Add Product / Service</Button>
        <Button type="button" size="sm" variant="secondary" className="gap-1" onClick={addOther} disabled={disabled || items.length >= DEAL_LINE_ITEM_LIMIT}><Plus size={14} /> Add Other</Button>
      </div>}
    </div>
    {sectionExpanded && <div id="deal-products-services-content">
      {items.length >= DEAL_LINE_ITEM_LIMIT && <p className="text-xs text-[var(--app-muted)]">Maximum of {DEAL_LINE_ITEM_LIMIT} line items reached.</p>}

      {items.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--app-border)] bg-white/65 p-3 text-sm text-[var(--app-muted)]">No products or services added. Select from Catalog or add an Other item.</p> : <div className="space-y-2">
        {items.map((item, index) => {
          const isOther = item.source === 'OTHER';
          const itemLabel = item.name || (isOther ? 'Other item' : 'Catalog item');
          return <article key={`${item.source}-${item.catalogItemId || 'other'}-${index}`} className="rounded-lg border border-[var(--app-border)] bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              {isOther ? <label className="min-w-[min(100%,18rem)] flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Item / Service Name<input aria-label="Other item name" value={item.name} onChange={(event) => updateLine(index, { name: event.target.value })} disabled={disabled} className="mt-1 h-10 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[var(--app-text)]" /></label> : <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold text-[var(--app-text)]">{item.name}</p><Badge variant={item.type === 'PRODUCT' ? 'blue' : 'purple'}>{item.type === 'PRODUCT' ? 'Product' : 'Service'}</Badge></div><p className="mt-0.5 break-words text-xs text-[var(--app-muted)]">{[item.code, item.category].filter(Boolean).join(' • ') || 'Catalog item'}</p></div>}
              {isOther && <Badge variant="gray">Other</Badge>}
            </div>
            <div className={`mt-2 grid grid-cols-2 items-end gap-x-3 gap-y-2 ${isOther ? 'sm:grid-cols-[minmax(10rem,1fr)_auto_auto]' : 'sm:grid-cols-[auto_minmax(10rem,1fr)_auto_auto]'}`}>
              {!isOther && <div className="min-w-0"><span className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Qty</span><div className="mt-1"><QuantityStepper quantity={item.quantity} label={itemLabel} disabled={disabled} onChange={(quantity) => updateLine(index, { quantity })} /></div></div>}
              <label className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Price<MoneyInput aria-label={`Price for ${itemLabel}`} value={item.unitPrice} currency={currency} className="mt-1 rounded-lg border bg-white px-3 py-2 text-sm" onChange={(value) => updateLine(index, { unitPrice: value })} disabled={disabled} /></label>
              <div className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Subtotal<p className="mt-1 truncate text-sm font-bold normal-case tracking-normal text-[var(--app-text)]">{formatCurrency(item.subtotal, currency)}</p></div>
              <Button type="button" size="sm" variant="ghost" className="h-10 w-10 justify-self-start px-0 text-[var(--app-danger)] sm:justify-self-end" aria-label={`Remove ${itemLabel}`} title={`Remove ${itemLabel}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled}><Trash2 size={15} aria-hidden="true" /></Button>
            </div>
          </article>;
        })}
      </div>}
    </div>}

    {sectionExpanded && selectorOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Select Product or Service">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <ModalHeader title="Select Product / Service" subtitle="Only active catalog items are available for new deals." onClose={() => setSelectorOpen(false)} />
        <div className="mt-4 space-y-3">
          <label className="relative block"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" /><span className="sr-only">Search catalog</span><input autoFocus className="w-full rounded-xl border px-3 py-2 pl-9 text-sm" placeholder="Search name, code, or category" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2" aria-label="Filter catalog items by type">{([['All', 'All'], ['PRODUCT', 'Products'], ['SERVICE', 'Services']] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={typeFilter === value ? 'primary' : 'outline'} onClick={() => setTypeFilter(value)}>{label}</Button>)}</div>
          {loading ? <p className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--app-muted)]"><Loader2 size={16} className="animate-spin" /> Loading catalog…</p> : loadError ? <div className="space-y-3 rounded-xl bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]"><p>{loadError}</p><Button type="button" size="sm" variant="outline" onClick={() => void openSelector()}>Retry</Button></div> : visibleCatalogItems.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-6 text-center text-sm text-[var(--app-muted)]">No active catalog items match your search.</p> : <div className="space-y-2">{visibleCatalogItems.map((item) => {
            const selected = selectedIds.has(item.id);
            return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] p-3"><div className="min-w-0"><p className="font-semibold text-[var(--app-text)]">{item.name}</p><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant={item.type === 'PRODUCT' ? 'blue' : 'purple'}>{item.type === 'PRODUCT' ? 'Product' : 'Service'}</Badge>{item.category && <span className="text-xs text-[var(--app-muted)]">{item.category}</span>}{item.code && <span className="text-xs text-[var(--app-tertiary)]">{item.code}</span>}</div><p className="mt-1 text-sm font-semibold text-[var(--app-text)]">{formatCurrency(item.effectivePrice, currency)}</p></div><Button type="button" size="sm" variant={selected ? 'outline' : 'primary'} onClick={() => addCatalogItem(item)} disabled={selected}>{selected ? 'Added' : 'Add'}</Button></div>;
          })}</div>}
        </div>
      </div>
    </div>}

  </section>;
}
