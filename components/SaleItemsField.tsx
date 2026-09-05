'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button } from '@/components/ui/core';
import { MoneyInput } from '@/components/MoneyInput';
import { ModalHeader } from '@/components/ModalCloseButton';
import { formatCurrency } from '@/lib/formatting';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { changeSaleQuantity, createOtherSaleLineItem, createSaleLineItem, getSaleItemsTotal, recalculateSaleLineItem, SALE_LINE_ITEM_LIMIT } from '@/lib/sale-items';
import { listSelectableCatalogItems } from '@/lib/repositories/catalogItems';
import type { AppUser } from '@/types/auth';
import type { CatalogItem, SaleLineItem } from '@/types';

type CatalogTypeFilter = 'All' | 'PRODUCT' | 'SERVICE';

function QuantityStepper({ quantity, label, disabled, onChange }: { quantity: number; label: string; disabled: boolean; onChange: (value: number) => void }) {
  return <div className="flex items-center gap-1"><button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--app-border)] bg-white disabled:opacity-50" aria-label={`Decrease quantity for ${label}`} disabled={disabled || quantity <= 1} onClick={() => onChange(changeSaleQuantity(quantity, -1))}><Minus size={15} /></button><input className="h-10 w-14 rounded-lg border border-[var(--app-border)] text-center text-sm" type="number" min="1" step="1" inputMode="numeric" value={quantity} disabled={disabled} aria-label={`Quantity for ${label}`} onChange={(event) => onChange(Number(event.target.value))} /><button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--app-border)] bg-white disabled:opacity-50" aria-label={`Increase quantity for ${label}`} disabled={disabled} onClick={() => onChange(changeSaleQuantity(quantity, 1))}><Plus size={15} /></button></div>;
}

export function SaleItemsField({ user, organizationId, items, currency, disabled = false, expanded = true, onToggle, onChange }: { user: AppUser; organizationId: string; items: SaleLineItem[]; currency: string; disabled?: boolean; expanded?: boolean; onToggle?: () => void; onChange: (items: SaleLineItem[]) => void }) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>('All');
  const selectedIds = useMemo(() => new Set(items.flatMap((item) => item.source === 'CATALOG' && item.catalogItemId ? [item.catalogItemId] : [])), [items]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalogItems.filter((item) => (typeFilter === 'All' || item.type === typeFilter) && (!term || [item.name, item.code, item.category].filter(Boolean).join(' ').toLowerCase().includes(term)));
  }, [catalogItems, search, typeFilter]);
  const openSelector = async () => {
    if (disabled) return;
    setSelectorOpen(true); setLoading(true); setLoadError(null); setSearch(''); setTypeFilter('All');
    try { setCatalogItems(await listSelectableCatalogItems(user, organizationId)); }
    catch (error) { setLoadError(userFacingErrorMessage(error, 'Unable to load Catalog items.')); }
    finally { setLoading(false); }
  };
  const update = (index: number, changes: Partial<Pick<SaleLineItem, 'name' | 'quantity' | 'unitPrice'>>) => onChange(items.map((item, itemIndex) => itemIndex === index ? recalculateSaleLineItem(item, changes) : item));
  return <section className="space-y-2 rounded-xl border p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><button type="button" className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]" onClick={onToggle} aria-expanded={expanded} aria-controls="sale-products-services-content"><span className="mt-0.5 shrink-0 text-[var(--app-muted)]">{expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}</span><span className="min-w-0"><span className="block text-sm font-bold text-[var(--app-text)]">Products &amp; Services · {items.length} {items.length === 1 ? 'item' : 'items'} · {formatCurrency(getSaleItemsTotal(items), currency)}</span><span className="mt-1 block text-xs text-[var(--app-muted)]">Prices are captured on this sale and can be adjusted here.</span></span></button>{expanded && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void openSelector()} disabled={disabled || items.length >= SALE_LINE_ITEM_LIMIT}><Plus size={14} /> Add Product / Service</Button><Button type="button" size="sm" variant="secondary" onClick={() => onChange([...items, createOtherSaleLineItem('Other item', 0)])} disabled={disabled || items.length >= SALE_LINE_ITEM_LIMIT}><Plus size={14} /> Add Other</Button></div>}</div>
    {expanded && <div id="sale-products-services-content">{items.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--app-border)] bg-white/65 p-3 text-sm text-[var(--app-muted)]">Add at least one product, service, or other item.</p> : <div className="space-y-2">{items.map((item, index) => {
      const other = item.source === 'OTHER'; const label = item.name || (other ? 'Other item' : 'Catalog item');
      return <article key={`${item.source}-${item.catalogItemId || 'other'}-${index}`} className="rounded-lg border border-[var(--app-border)] bg-white px-2.5 py-2"><div className={`grid grid-cols-1 items-end gap-2 ${other ? 'sm:grid-cols-[minmax(0,1.7fr)_minmax(8rem,.8fr)_auto_auto]' : 'sm:grid-cols-[auto_minmax(0,1.7fr)_minmax(8rem,.8fr)_auto_auto]'}`}>
        {!other && <div><span className="text-xs font-semibold text-[var(--app-muted)]">Qty</span><div className="mt-0.5"><QuantityStepper quantity={item.quantity} label={label} disabled={disabled} onChange={(quantity) => update(index, { quantity })} /></div></div>}
        <div className="min-w-0">{other ? <label className="text-xs font-semibold text-[var(--app-muted)]">Item / Service<input aria-label="Item / Service" className="mt-0.5 h-9 w-full rounded-lg border border-[var(--app-border)] px-2.5 text-sm font-normal text-[var(--app-text)]" value={item.name} disabled={disabled} onChange={(event) => update(index, { name: event.target.value })} /></label> : <div><div className="flex min-w-0 flex-wrap items-center gap-2"><p className="truncate font-semibold text-[var(--app-text)]">{item.name}</p><Badge variant={item.type === 'PRODUCT' ? 'blue' : 'purple'}>{item.type === 'PRODUCT' ? 'Product' : 'Service'}</Badge></div><p className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{[item.code, item.category].filter(Boolean).join(' • ') || 'Catalog item'}</p></div>}</div>
        <label className="text-xs font-semibold text-[var(--app-muted)]">Price<MoneyInput aria-label={`Price for ${label}`} value={item.unitPrice} currency={currency} disabled={disabled} className="mt-0.5 rounded-lg border bg-white px-2.5 py-1.5 text-sm" onChange={(unitPrice) => update(index, { unitPrice })} /></label>
        <div className="text-xs font-semibold text-[var(--app-muted)]">Subtotal<p className="mt-0.5 text-sm font-bold text-[var(--app-text)]">{formatCurrency(item.subtotal, currency)}</p></div>
        <Button type="button" size="sm" variant="ghost" className="h-9 w-9 justify-self-start px-0 text-[var(--app-danger)] sm:justify-self-end" aria-label={`Remove ${label}`} title={`Remove ${label}`} disabled={disabled} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></Button>
      </div></article>;
    })}</div>}</div>}
    {expanded && selectorOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Select Product or Service"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"><ModalHeader title="Select Product / Service" subtitle="Only active Catalog items are available for a new sale." onClose={() => setSelectorOpen(false)} /><div className="mt-4 space-y-3"><label className="relative block"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" /><span className="sr-only">Search Catalog</span><input autoFocus className="w-full rounded-xl border px-3 py-2 pl-9 text-sm" placeholder="Search name, code, or category" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="flex gap-2">{([['All', 'All'], ['PRODUCT', 'Products'], ['SERVICE', 'Services']] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={typeFilter === value ? 'primary' : 'outline'} onClick={() => setTypeFilter(value)}>{label}</Button>)}</div>{loading ? <p className="flex justify-center gap-2 py-8 text-sm text-[var(--app-muted)]"><Loader2 size={16} className="animate-spin" /> Loading Catalog…</p> : loadError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-[var(--app-danger)]">{loadError}</p> : filtered.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-[var(--app-muted)]">No active Catalog items match your search.</p> : <div className="space-y-2">{filtered.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-[var(--app-muted)]">{item.type === 'PRODUCT' ? 'Product' : 'Service'} · {formatCurrency(item.effectivePrice, currency)}</p></div><Button type="button" size="sm" variant={selectedIds.has(item.id) ? 'outline' : 'primary'} disabled={selectedIds.has(item.id)} onClick={() => onChange([...items, createSaleLineItem(item)])}>{selectedIds.has(item.id) ? 'Added' : 'Add'}</Button></div>)}</div>}</div></div></div>}
  </section>;
}
