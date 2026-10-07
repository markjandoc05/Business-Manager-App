import { normalizeSaleDate, normalizeSalePayment } from './sale-workflow.ts';
import { getSaleItemsTotal, normalizeSaleLineItems } from './sale-items.ts';

export class FinanceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function financeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
export function moneyCents(value: unknown) {
  // Account for the floating-point scaling error of representable large prices.
  // A fixed epsilon rejects legitimate two-decimal values such as 150000000.02.
  const scaled = typeof value === 'number' ? value * 100 : NaN;
  const cents = Math.round(scaled);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || cents / 100 !== value) {
    throw new FinanceError('Money must be a finite, non-negative amount with at most two decimal places.');
  }
  return cents;
}

function requestFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((field) => !allowed.includes(field))) throw new FinanceError('Unexpected financial request fields.');
}

/** Authoritative snapshot validation; negotiated prices do not depend on live Catalog data. */
export function validateSaleRequest(body: Record<string, unknown>) {
  requestFields(body, ['saleDate', 'customerType', 'source', 'customerName', 'clientId', 'dealId', 'items', 'paymentStatus', 'paymentMethod', 'amountPaid', 'notes']);
  if (!['WALK_IN', 'CLIENT'].includes(String(body.customerType))) throw new FinanceError('Choose a valid customer type.');
  const source = body.source ?? (body.customerType === 'CLIENT' ? 'CLIENT' : 'WALK_IN');
  if (!['WALK_IN', 'CLIENT', 'DEAL'].includes(String(source)) || (body.customerType === 'WALK_IN' ? source !== 'WALK_IN' : source === 'WALK_IN')) throw new FinanceError('The Sale source does not match the customer type.');
  const clientId = body.customerType === 'CLIENT' ? body.clientId : null;
  if (body.customerType === 'CLIENT' && !financeId(clientId)) throw new FinanceError('Choose a valid Client.');
  if (body.customerType === 'WALK_IN' && text(body.clientId)) throw new FinanceError('Walk-in Sales cannot include a Client reference.');
  const dealId = source === 'DEAL' ? body.dealId : undefined;
  if (source === 'DEAL' && !financeId(dealId)) throw new FinanceError('The Deal reference is required.');
  if (source !== 'DEAL' && text(body.dealId)) throw new FinanceError('Only Deal Sales may include a Deal reference.');
  if (!Array.isArray(body.items)) throw new FinanceError('Sale items must be a list.');
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FinanceError('Sale item is invalid.');
    if (!Number.isSafeInteger(raw.quantity) || raw.quantity < 1 || (raw.source === 'OTHER' && raw.quantity !== 1)) throw new FinanceError('Sale item quantity must be a positive whole number (one for Other items).');
    const price = moneyCents(raw.unitPrice);
    const subtotal = moneyCents(raw.subtotal);
    moneyCents(raw.regularPrice);
    if (raw.salePrice !== null && raw.salePrice !== undefined) moneyCents(raw.salePrice);
    if (!Number.isSafeInteger(price * raw.quantity) || subtotal !== price * raw.quantity) throw new FinanceError('Sale item subtotal does not match its quantity and price.');
  }
  const items = normalizeSaleLineItems(body.items);
  const totalCents = items.reduce((sum, item) => sum + moneyCents(item.subtotal), 0);
  if (!Number.isSafeInteger(totalCents)) throw new FinanceError('Sale total is too large.');
  const total = getSaleItemsTotal(items);
  if (moneyCents(total) !== totalCents) throw new FinanceError('Sale totals are invalid.');
  if (body.amountPaid !== undefined) moneyCents(body.amountPaid);
  const payment = normalizeSalePayment(total, body.paymentStatus, body.paymentMethod, body.amountPaid);
  const customerName = text(body.customerName);
  if (body.customerType === 'WALK_IN' && !customerName) throw new FinanceError('Customer name is required.');
  if (body.notes !== undefined && typeof body.notes !== 'string') throw new FinanceError('Notes must be text.');
  return { saleDate: normalizeSaleDate(body.saleDate), customerType: body.customerType as 'WALK_IN' | 'CLIENT', source: source as 'WALK_IN' | 'CLIENT' | 'DEAL', customerName, clientId: clientId as string | null, ...(dealId ? { dealId: dealId as string } : {}), items, subtotal: total, total, ...payment, paymentMethod: payment.paymentMethod || null, notes: text(body.notes) || null };
}
