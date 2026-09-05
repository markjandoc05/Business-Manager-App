'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, Badge, Button } from '@/components/ui/core';
import { ModalHeader } from '@/components/ModalCloseButton';
import { MoneyInput } from '@/components/MoneyInput';
import { SaleItemsField } from '@/components/SaleItemsField';
import { formatCurrency } from '@/lib/formatting';
import { createSaleLineItemsFromDeal, getSaleItemsTotal, normalizeSaleLineItems } from '@/lib/sale-items';
import { getLocalCalendarDate, normalizeSalePayment, SALE_PAYMENT_METHODS } from '@/lib/sale-workflow';
import { searchActiveClients } from '@/lib/repositories/clients';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import type { CreateSaleInput } from '@/lib/repositories/sales';
import type { AppUser } from '@/types/auth';
import type { Client, Deal, DealLineItem, Sale, SaleCustomerType, SaleLineItem, SalePaymentMethod, SalePaymentStatus, SaleSource } from '@/types';

export type DealSalePrefill = {
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  items?: DealLineItem[];
  value: number;
};

type SaleForm = {
  saleDate: string;
  customerType: SaleCustomerType;
  source: SaleSource;
  customerName: string;
  clientId: string;
  dealId: string;
  items: SaleLineItem[];
  paymentStatus: SalePaymentStatus;
  paymentMethod: SalePaymentMethod | '';
  amountPaid: number;
  notes: string;
};

function emptyForm(prefill?: DealSalePrefill, defaults?: { paymentStatus?: SalePaymentStatus; paymentMethod?: SalePaymentMethod }): SaleForm {
  return {
    saleDate: getLocalCalendarDate(),
    customerType: prefill ? 'CLIENT' : 'WALK_IN',
    source: prefill ? 'DEAL' : 'WALK_IN',
    customerName: prefill?.clientName || '',
    clientId: prefill?.clientId || '',
    dealId: prefill?.dealId || '',
    items: prefill ? createSaleLineItemsFromDeal(prefill.items, prefill.dealTitle, prefill.value) : [],
    paymentStatus: defaults?.paymentStatus || 'PAID',
    paymentMethod: defaults?.paymentMethod || 'CASH',
    amountPaid: 0,
    notes: '',
  };
}

function paymentLabel(value: SalePaymentStatus) {
  return value === 'PAID' ? 'Paid' : value === 'PARTIAL' ? 'Partial' : 'Unpaid';
}

export function RecordSaleModal({ user, organizationId, currency, prefill, defaultPaymentStatus, defaultPaymentMethod, onClose, onSubmit }: {
  user: AppUser;
  organizationId: string;
  currency: string;
  prefill?: DealSalePrefill;
  defaultPaymentStatus?: SalePaymentStatus;
  defaultPaymentMethod?: SalePaymentMethod;
  onClose: () => void;
  onSubmit: (input: CreateSaleInput) => Promise<void>;
}) {
  const [form, setForm] = useState<SaleForm>(() => emptyForm(prefill, { paymentStatus: defaultPaymentStatus, paymentMethod: defaultPaymentMethod }));
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientSearchRequest = useRef(0);
  const total = getSaleItemsTotal(form.items);
  const dealValue = prefill?.value;
  const saleDiffersFromDeal = typeof dealValue === 'number' && Math.abs(total - dealValue) > 0.005;
  const variance = typeof dealValue === 'number' ? total - dealValue : 0;
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const paymentSummary = form.paymentStatus === 'PAID'
    ? `Paid${form.paymentMethod ? ` · ${form.paymentMethod.replace('_', ' ')}` : ''} · ${formatCurrency(total, currency)}`
    : form.paymentStatus === 'PARTIAL'
      ? `Partial · Paid ${formatCurrency(form.amountPaid, currency)} · Balance ${formatCurrency(Math.max(0, total - form.amountPaid), currency)}`
      : `Unpaid · Balance ${formatCurrency(total, currency)}`;

  useEffect(() => {
    if (prefill || form.customerType !== 'CLIENT') return;
    const request = ++clientSearchRequest.current;
    if (clientSearch.trim().length < 2) {
      setClients([]);
      setClientsLoading(false);
      return () => undefined;
    }
    const timer = window.setTimeout(() => {
      setClientsLoading(true);
      setError(null);
      void searchActiveClients(user, organizationId, clientSearch)
        .then((result) => { if (request === clientSearchRequest.current) setClients(result); })
        .catch((cause) => { console.error('Unable to search clients', cause); if (request === clientSearchRequest.current) setError('Unable to search clients. Please try again.'); })
        .finally(() => { if (request === clientSearchRequest.current) setClientsLoading(false); });
    }, clientSearch.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [clientSearch, form.customerType, organizationId, prefill, user]);

  const setItems = (items: SaleLineItem[]) => setForm((current) => {
    const nextTotal = getSaleItemsTotal(items);
    const amountPaid = current.paymentStatus === 'PAID' ? nextTotal : current.paymentStatus === 'UNPAID' ? 0 : Math.min(current.amountPaid, Math.max(0, nextTotal - 0.01));
    return { ...current, items, amountPaid };
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      normalizeSaleLineItems(form.items);
      const payment = normalizeSalePayment(total, form.paymentStatus, form.paymentMethod, form.amountPaid);
      await onSubmit({ ...form, ...payment, paymentMethod: payment.paymentMethod, amountPaid: payment.amountPaid });
    } catch (cause) {
      const message = userFacingErrorMessage(cause, 'Unable to record sale.');
      if (/^Sale item|^A sale must include|^Add each catalog item/.test(message)) setProductsExpanded(true);
      if (/payment|amount paid|sale total must|valid payment status/i.test(message)) setPaymentExpanded(true);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Record Sale">
    <form onSubmit={submit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
      <ModalHeader title="Record Sale" subtitle={prefill ? `Review transaction from Won Deal: ${prefill.dealTitle}` : 'This creates an independent sales transaction.'} onClose={onClose} />
      {error && <Alert variant="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Sale date<input required type="date" className="mt-1 w-full" value={form.saleDate} onChange={(event) => setForm({ ...form, saleDate: event.target.value })} /></label>
        {prefill ? <div className="text-sm font-medium">Source<div className="mt-1 flex h-11 items-center rounded-xl border bg-[var(--app-surface-subtle)] px-3"><Badge variant="gray">Deal</Badge><span className="ml-2 text-[var(--app-muted)]">{prefill.dealTitle}</span></div></div> : <label className="text-sm font-medium">Customer source<select className="mt-1 w-full" value={form.customerType} onChange={(event) => { clientSearchRequest.current += 1; setClientSearch(''); setClients([]); setError(null); setForm({ ...form, customerType: event.target.value as SaleCustomerType, source: event.target.value === 'CLIENT' ? 'CLIENT' : 'WALK_IN', customerName: '', clientId: '' }); }}><option value="WALK_IN">Walk-in</option><option value="CLIENT">Client</option></select></label>}
        {prefill ? <div className="text-sm font-medium sm:col-span-2">Client<div className="mt-1 flex min-h-11 items-center rounded-xl border bg-[var(--app-surface-subtle)] px-3 text-[var(--app-text)]">{prefill.clientName}</div></div> : form.customerType === 'WALK_IN' ? <label className="text-sm font-medium sm:col-span-2">Walk-in customer name <span className="font-normal text-[var(--app-muted)]">(optional)</span><input className="mt-1 w-full" value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} placeholder="Customer name" /></label> : <div className="space-y-2 sm:col-span-2"><label className="block text-sm font-medium">Search clients<input className="mt-1 w-full" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search name, company, email, or phone" /></label>{clientsLoading ? <p className="text-xs text-[var(--app-muted)]">Searching clients…</p> : clientSearch.trim().length >= 2 && clients.length === 0 ? <p className="text-xs text-[var(--app-muted)]">No matching clients found.</p> : clientSearch.trim().length >= 2 && <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--app-border)] divide-y divide-[var(--app-border-subtle)]">{clients.map((client) => <button key={client.id} type="button" className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--app-surface-subtle)] ${form.clientId === client.id ? 'bg-[var(--app-accent-soft)]' : ''}`} onClick={() => { setForm((current) => ({ ...current, clientId: client.id, customerName: client.name })); setClients([]); }}><span className="font-semibold text-[var(--app-text)]">{client.name}</span><span className="ml-2 text-xs text-[var(--app-muted)]">{[client.company, client.email, client.phone].filter(Boolean).join(' · ')}</span></button>)}</div>}<div className="flex items-center justify-between gap-3"><p className="text-xs text-[var(--app-muted)]">{form.clientId ? `Selected: ${form.customerName}` : 'Select a Client to continue.'}</p>{form.clientId && <Button type="button" size="sm" variant="outline" onClick={() => { setForm((current) => ({ ...current, clientId: '', customerName: '' })); setClientSearch(''); setClients([]); }}>Clear Client</Button>}</div></div>}
      </div>
      {prefill && typeof dealValue === 'number' && <section aria-label="Deal and sale totals" className="rounded-xl border border-[var(--app-border-subtle)] bg-[var(--app-surface-subtle)] p-3 sm:p-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Deal Value</p><p className="mt-1 text-xl font-bold text-[var(--app-text)]">{formatCurrency(dealValue, currency)}</p><p className="mt-1 text-xs text-[var(--app-muted)]">Original value from the Won Deal</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Sale Total</p><p className="mt-1 text-xl font-bold text-[var(--app-text)]">{formatCurrency(total, currency)}</p><p className="mt-1 text-xs text-[var(--app-muted)]">Actual transaction amount to be recorded</p></div></div>{saleDiffersFromDeal && <p className="mt-3 border-t border-[var(--app-border-subtle)] pt-3 text-xs text-[var(--app-muted)]">Sale Total differs from Deal Value by {variance > 0 ? '+' : ''}{formatCurrency(variance, currency)}.</p>}</section>}
      <SaleItemsField user={user} organizationId={organizationId} items={form.items} currency={currency} expanded={productsExpanded} onToggle={() => setProductsExpanded((current) => !current)} onChange={setItems} />
      <section className="rounded-xl border p-3 sm:p-4"><button type="button" className="flex w-full items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]" onClick={() => setPaymentExpanded((current) => !current)} aria-expanded={paymentExpanded} aria-controls="sale-payment-content"><span className="mt-0.5 shrink-0 text-[var(--app-muted)]">{paymentExpanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}</span><span className="min-w-0 text-sm font-bold text-[var(--app-text)]">Payment · <span className="font-medium">{paymentSummary}</span></span></button>{paymentExpanded && <div id="sale-payment-content"><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium">Status<select className="mt-1 w-full" value={form.paymentStatus} onChange={(event) => { const status = event.target.value as SalePaymentStatus; setForm({ ...form, paymentStatus: status, paymentMethod: status === 'UNPAID' ? '' : form.paymentMethod || 'CASH', amountPaid: status === 'PAID' ? total : 0 }); }}><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="UNPAID">Unpaid</option></select></label>{form.paymentStatus !== 'UNPAID' && <label className="text-sm font-medium">Method<select className="mt-1 w-full" value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as SalePaymentMethod })}>{SALE_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method.replace('_', ' ')}</option>)}</select></label>}{form.paymentStatus === 'PARTIAL' && <label className="text-sm font-medium">Amount paid<MoneyInput className="mt-1 w-full rounded-lg border px-3 py-2" currency={currency} value={form.amountPaid} onChange={(amountPaid) => setForm({ ...form, amountPaid })} /></label>}</div><div className="mt-3 flex flex-wrap gap-4 text-sm"><span>Paid: <b>{formatCurrency(form.paymentStatus === 'PAID' ? total : form.paymentStatus === 'UNPAID' ? 0 : form.amountPaid, currency)}</b></span><span>Balance: <b>{formatCurrency(form.paymentStatus === 'PAID' ? 0 : form.paymentStatus === 'UNPAID' ? total : Math.max(0, total - form.amountPaid), currency)}</b></span></div></div>}</section>
      <label className="block text-sm font-medium">Notes <span className="font-normal text-[var(--app-muted)]">(optional)</span><textarea className="mt-1 min-h-20 w-full" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Recording…' : 'Record Sale'}</Button></div>
    </form>
  </div>;
}

export function SaleDetailsModal({ sale, currency, canManage, onClose, onVoid, onViewDeal, deal, dealLoading }: {
  sale: Sale;
  currency: string;
  canManage: boolean;
  onClose: () => void;
  onVoid?: () => void;
  onViewDeal?: () => void;
  deal?: Pick<Deal, 'title' | 'value'> | null;
  dealLoading?: boolean;
}) {
  const dealDifference = deal ? sale.total - deal.value : 0;
  const dealHasDifference = deal && Math.abs(dealDifference) > 0.005;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Sale details"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"><ModalHeader title={sale.saleNumber} subtitle={`${sale.saleDate} · ${sale.customerName || 'Walk-in customer'}`} onClose={onClose} /><div className="mt-4 space-y-3"><div className="flex flex-wrap gap-2"><Badge variant={sale.status === 'VOIDED' ? 'red' : 'green'}>{sale.status === 'VOIDED' ? 'Voided' : 'Active'}</Badge><Badge variant="gray">{sale.source === 'DEAL' ? 'Deal' : sale.source === 'CLIENT' ? 'Client' : 'Walk-in'}</Badge><Badge variant="gray">{paymentLabel(sale.paymentStatus)}</Badge></div>{sale.source === 'DEAL' && <section aria-label="Originating Deal" aria-busy={dealLoading} className="rounded-xl border border-[var(--app-border-subtle)] bg-[var(--app-surface-subtle)] p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-[var(--app-primary)]">Originating Deal</p>{dealLoading ? <div role="status" aria-label="Loading Deal details" className="mt-2 animate-pulse space-y-2"><span className="block h-4 w-48 max-w-full rounded bg-[var(--app-border-subtle)]" /><span className="block h-3 w-32 rounded bg-[var(--app-border-subtle)]" /></div> : <p className="mt-1 font-semibold text-[var(--app-text)]">{deal?.title ? `Deal: ${deal.title}` : 'Deal information is currently unavailable.'}</p>}</div>{onViewDeal && <Button type="button" size="sm" variant="outline" onClick={onViewDeal}>View Deal</Button>}</div>{dealLoading ? <div className="mt-3 grid gap-3 border-t border-[var(--app-border-subtle)] pt-3 sm:grid-cols-3"><span className="h-10 animate-pulse rounded bg-[var(--app-border-subtle)]" /><span className="h-10 animate-pulse rounded bg-[var(--app-border-subtle)]" /><span className="h-10 animate-pulse rounded bg-[var(--app-border-subtle)]" /></div> : deal && <div className="mt-3 grid gap-3 border-t border-[var(--app-border-subtle)] pt-3 sm:grid-cols-3"><div><p className="text-xs text-[var(--app-muted)]">Deal Value</p><p className="mt-1 font-semibold text-[var(--app-text)]">{formatCurrency(deal.value, currency)}</p></div><div><p className="text-xs text-[var(--app-muted)]">Actual Sale</p><p className="mt-1 font-semibold text-[var(--app-text)]">{formatCurrency(sale.total, currency)}</p></div>{dealHasDifference && <div><p className="text-xs text-[var(--app-muted)]">Difference</p><p className="mt-1 font-semibold text-[var(--app-muted)]">{dealDifference > 0 ? '+' : ''}{formatCurrency(dealDifference, currency)}</p></div>}</div>}</section>}<div className="rounded-xl border p-3"><p className="text-sm font-semibold">Products &amp; Services</p>{sale.items.map((item, index) => <div key={`${item.name}-${index}`} className="mt-2 flex justify-between gap-3 border-t pt-2 text-sm"><span>{item.name} {item.source === 'CATALOG' && `× ${item.quantity}`}</span><b>{formatCurrency(item.subtotal, currency)}</b></div>)}<div className="mt-3 flex justify-between border-t pt-3 font-bold"><span>Sale Total</span><span>{formatCurrency(sale.total, currency)}</span></div></div><div className="grid grid-cols-2 gap-3 text-sm"><p>Payment status<br /><b>{paymentLabel(sale.paymentStatus)}</b></p><p>Payment method<br /><b>{sale.paymentMethod ? sale.paymentMethod.replace('_', ' ') : 'Not specified'}</b></p><p>Amount paid<br /><b>{formatCurrency(sale.amountPaid, currency)}</b></p><p>Outstanding balance<br /><b>{formatCurrency(sale.balance, currency)}</b></p></div>{sale.notes && <p className="rounded-xl bg-[var(--app-surface-subtle)] p-3 text-sm">{sale.notes}</p>}{sale.status === 'VOIDED' && <p className="text-sm text-[var(--app-muted)]">Voided by {sale.voidedBy || '—'}{sale.voidedAt ? ` on ${new Date(sale.voidedAt).toLocaleString()}` : ''}.</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Close</Button>{canManage && sale.status === 'ACTIVE' && onVoid && <Button type="button" variant="danger" onClick={onVoid}>Void Sale</Button>}</div></div></div></div>;
}
