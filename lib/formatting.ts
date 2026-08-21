export function formatCurrency(value: number, currency = 'USD') {
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: safeCurrency,
    maximumFractionDigits: 0,
  }).format(safeValue);
}
