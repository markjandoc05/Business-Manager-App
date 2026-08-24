export function formatCurrency(value: number, currency = 'USD') {
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  const roundedValue = Math.round((safeValue + Math.sign(safeValue) * Number.EPSILON) * 100) / 100;
  const hasCents = Math.round(Math.abs(roundedValue) * 100) % 100 !== 0;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: safeCurrency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(roundedValue);
}

export function getCurrencySymbol(currency = 'USD') {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: safeCurrency,
  }).formatToParts(0).find((part) => part.type === 'currency')?.value || safeCurrency;
}

export type CurrencyDisplayParts = {
  beforeDecimal: string;
  decimal: string;
  afterDecimal: string;
};

export function formatCurrencyParts(value: number, currency = 'USD'): CurrencyDisplayParts {
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  const roundedValue = Math.round((safeValue + Math.sign(safeValue) * Number.EPSILON) * 100) / 100;
  const hasCents = Math.round(Math.abs(roundedValue) * 100) % 100 !== 0;
  const parts = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: safeCurrency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).formatToParts(roundedValue);
  const decimalIndex = parts.findIndex((part) => part.type === 'decimal');

  if (decimalIndex === -1) {
    return { beforeDecimal: parts.map((part) => part.value).join(''), decimal: '', afterDecimal: '' };
  }

  return {
    beforeDecimal: parts.slice(0, decimalIndex).map((part) => part.value).join(''),
    decimal: parts.slice(decimalIndex, decimalIndex + 2).map((part) => part.value).join(''),
    afterDecimal: parts.slice(decimalIndex + 2).map((part) => part.value).join(''),
  };
}
