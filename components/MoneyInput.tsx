'use client';

import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { getCurrencySymbol } from '@/lib/formatting';

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'inputMode'> & {
  value: number;
  currency: string;
  onChange: (value: number) => void;
  containerClassName?: string;
};

function sanitizeMoneyInput(value: string) {
  let result = '';
  let hasDecimal = false;
  let fractionDigits = 0;

  for (const character of value) {
    if (/\d/.test(character)) {
      if (hasDecimal) {
        if (fractionDigits >= 2) continue;
        fractionDigits += 1;
      }
      result += character;
    } else if (character === ',') {
      continue;
    } else if (character === '.' && !hasDecimal) {
      hasDecimal = true;
      result += character;
    }
  }

  return result;
}

function formatMoneyInput(value: string) {
  if (!value) return '';
  const parts = value.split('.');
  const integerPart = parts[0] || '';
  const fractionPart = parts[1];
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const groupedInteger = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fractionPart === undefined ? groupedInteger : groupedInteger + '.' + fractionPart;
}

function parseMoneyInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function countMeaningfulCharacters(value: string) {
  return value.replace(/,/g, '').length;
}

function getCursorPosition(formattedValue: string, meaningfulCharacterCount: number) {
  if (meaningfulCharacterCount === 0) return 0;
  let seen = 0;
  for (let index = 0; index < formattedValue.length; index += 1) {
    if (formattedValue[index] !== ',') seen += 1;
    if (seen === meaningfulCharacterCount) return index + 1;
  }
  return formattedValue.length;
}

export function MoneyInput({ value, currency, onChange, containerClassName = '', className = '', ...inputProps }: MoneyInputProps) {
  const [draft, setDraft] = useState(() => formatMoneyInput(String(value)));
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const currencySymbol = getCurrencySymbol(currency);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatMoneyInput(String(value)));
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const rawCursor = event.target.selectionStart ?? rawValue.length;
    const normalizedValue = sanitizeMoneyInput(rawValue);
    const formattedValue = formatMoneyInput(normalizedValue);
    const meaningfulBeforeCursor = countMeaningfulCharacters(sanitizeMoneyInput(rawValue.slice(0, rawCursor)));
    const nextCursor = getCursorPosition(formattedValue, meaningfulBeforeCursor);

    setDraft(formattedValue);
    onChange(parseMoneyInput(normalizedValue));
    window.requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const normalizedValue = sanitizeMoneyInput(draft);
    const numericValue = parseMoneyInput(normalizedValue || '0');
    setDraft(formatMoneyInput(normalizedValue || '0'));
    onChange(numericValue);
  };

  return <div className={'relative ' + containerClassName}>
    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--app-muted)]" aria-hidden="true">{currencySymbol}</span>
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => { focusedRef.current = true; }}
      onChange={handleChange}
      onBlur={handleBlur}
      className={'w-full !pl-8 ' + className}
    />
  </div>;
}
