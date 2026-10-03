type LoadedListStatusProps = {
  loadedCount: number;
  visibleCount?: number;
  hasMore: boolean;
  noun: string;
  loadedScope?: string;
};

export function LoadedListStatus({ loadedCount, visibleCount = loadedCount, hasMore, noun, loadedScope }: LoadedListStatusProps) {
  const countLabel = visibleCount === loadedCount
    ? `${loadedCount} ${noun} loaded.`
    : `${visibleCount} of ${loadedCount} loaded ${noun} shown.`;

  return (
    <p className="text-center text-xs text-[var(--app-muted)]" role="status">
      {countLabel}{' '}
      {hasMore ? 'More records are available.' : 'End of list.'}
      {hasMore && loadedScope ? ` ${loadedScope} apply to loaded records.` : ''}
    </p>
  );
}
