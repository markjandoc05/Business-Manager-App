import type { SalePaymentMethod, SalePaymentStatus } from '@/types';
function roundSaleMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const SALE_PAYMENT_STATUSES = ['PAID', 'PARTIAL', 'UNPAID'] as const;
export const SALE_PAYMENT_METHODS = ['CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const;

export function getLocalCalendarDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function normalizeSaleDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Sale date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Sale date is not valid.');
  return value;
}

function paymentMethod(value: unknown): SalePaymentMethod | undefined {
  return SALE_PAYMENT_METHODS.includes(value as SalePaymentMethod) ? value as SalePaymentMethod : undefined;
}

export function normalizeSalePayment(totalValue: unknown, statusValue: unknown, methodValue: unknown, paidValue: unknown) {
  const total = roundSaleMoney(Number(totalValue));
  if (!Number.isFinite(total) || total < 0) throw new Error('Sale total must be zero or greater.');
  if (!SALE_PAYMENT_STATUSES.includes(statusValue as SalePaymentStatus)) throw new Error('Choose a valid payment status.');
  const status = statusValue as SalePaymentStatus;
  const method = paymentMethod(methodValue);
  if (status === 'PAID') {
    if (!method) throw new Error('Choose a payment method for a paid sale.');
    return { paymentStatus: status, paymentMethod: method, amountPaid: total, balance: 0 };
  }
  if (status === 'UNPAID') return { paymentStatus: status, paymentMethod: undefined, amountPaid: 0, balance: total };
  if (!method) throw new Error('Choose a payment method for a partial payment.');
  const amountPaid = roundSaleMoney(Number(paidValue));
  if (!Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid >= total) throw new Error('Partial payment must be greater than zero and less than the sale total.');
  return { paymentStatus: status, paymentMethod: method, amountPaid, balance: roundSaleMoney(total - amountPaid) };
}

export function normalizeAdditionalSalePayment(totalValue: unknown, paidValue: unknown, amountValue: unknown, methodValue: unknown) {
  const total = roundSaleMoney(Number(totalValue));
  const amountPaid = roundSaleMoney(Number(paidValue));
  const amount = roundSaleMoney(Number(amountValue));
  const method = paymentMethod(methodValue);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > total) throw new Error('The Sale payment totals are invalid.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.');
  if (!method) throw new Error('Choose a valid payment method.');
  const balance = roundSaleMoney(total - amountPaid);
  if (amount > balance) throw new Error('Payment amount cannot exceed the outstanding balance.');
  const nextAmountPaid = roundSaleMoney(amountPaid + amount);
  const nextBalance = roundSaleMoney(total - nextAmountPaid);
  return { amount, method, amountPaid: nextAmountPaid, balance: nextBalance, paymentStatus: nextBalance === 0 ? 'PAID' as const : 'PARTIAL' as const };
}

/** Uses Firestore's generated ID, avoiding unsafe count-plus-one sequencing. */
export function createSaleNumber(documentId: string) {
  const suffix = documentId.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase();
  if (!suffix) throw new Error('Unable to generate a sale number.');
  return `S-${suffix}`;
}
