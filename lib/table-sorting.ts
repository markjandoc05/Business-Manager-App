export type SortDirection = 'asc' | 'desc';

function compareEmptyValues(leftEmpty: boolean, rightEmpty: boolean) {
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  return null;
}

export function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const leftValue = left?.trim() || '';
  const rightValue = right?.trim() || '';
  const emptyComparison = compareEmptyValues(!leftValue, !rightValue);
  if (emptyComparison !== null) return emptyComparison;
  const result = leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base', numeric: true });
  return direction === 'asc' ? result : -result;
}

export function compareNumber(left: number | null | undefined, right: number | null | undefined, direction: SortDirection) {
  const leftEmpty = left === null || left === undefined || !Number.isFinite(left);
  const rightEmpty = right === null || right === undefined || !Number.isFinite(right);
  const emptyComparison = compareEmptyValues(leftEmpty, rightEmpty);
  if (emptyComparison !== null) return emptyComparison;
  const result = (left as number) - (right as number);
  return direction === 'asc' ? result : -result;
}

export function compareDate(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const leftValue = left ? Date.parse(left) : Number.NaN;
  const rightValue = right ? Date.parse(right) : Number.NaN;
  return compareNumber(leftValue, rightValue, direction);
}
