import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/core';
import { ModalCloseButton } from '@/components/ModalCloseButton';

export type KpiCustomizationOption = {
  id: string;
  label: string;
  description: string;
  context?: string;
};

export type KpiCustomizationCategory = {
  id: string;
  label: string;
  description: string;
  optionIds: readonly string[];
};

type KpiCustomizationModalProps = {
  idPrefix: string;
  ariaLabel: string;
  title: string;
  subtitle: string;
  draftIds: readonly string[];
  defaultIds: readonly string[];
  options: readonly KpiCustomizationOption[];
  categories: readonly KpiCustomizationCategory[];
  minimum?: number;
  maximum?: number;
  initialOpenCategoryIds?: readonly string[];
  onDraftChange: (ids: string[]) => void;
  onSave: (ids: string[]) => void;
  onClose: () => void;
};

export function KpiCustomizationModal({
  idPrefix,
  ariaLabel,
  title,
  subtitle,
  draftIds,
  defaultIds,
  options,
  categories,
  minimum = 3,
  maximum = 8,
  initialOpenCategoryIds,
  onDraftChange,
  onSave,
  onClose,
}: KpiCustomizationModalProps) {
  const optionById = new Map(options.map((option) => [option.id, option]));
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(initialOpenCategoryIds ?? []),
  );
  const overLimit = draftIds.length > maximum;

  const toggleOption = (id: string) => {
    const selected = draftIds.includes(id);
    if (!selected && draftIds.length >= maximum) return;
    if (selected && draftIds.length <= minimum) return;
    onDraftChange(selected ? draftIds.filter((currentId) => currentId !== id) : [...draftIds, id]);
  };

  const moveDraft = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= draftIds.length) return;
    const next = [...draftIds];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onDraftChange(next);
  };

  return (
    <div className="app-modal customize-dashboard-overlay fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-6">
      <div className="app-modal-panel customize-dashboard-modal relative flex w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] max-w-[780px] flex-col overflow-hidden p-0 sm:w-[calc(100vw-3rem)] sm:max-h-[calc(100dvh-3rem)]" role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <header className="shrink-0 border-b border-[var(--app-border-subtle)] px-4 py-4 sm:px-6">
          <div className="absolute right-2 top-2"><ModalCloseButton onClose={onClose} /></div>
          <h3 className="pr-10 text-lg font-bold text-[var(--app-text)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{subtitle}</p>
          <p className="mt-1 text-sm font-medium text-[var(--app-text)]">Selected {draftIds.length} of {maximum}</p>
          {draftIds.length === maximum && <p className="mt-1 text-xs text-[var(--app-tertiary)]">Maximum {maximum} KPI cards.</p>}
          {draftIds.length > maximum && <p className="mt-1 text-xs text-[var(--app-warning)]">Select {maximum} or fewer KPI cards before saving.</p>}
          {draftIds.length < minimum && <p className="mt-1 text-xs text-[var(--app-warning)]">Select at least {minimum} KPI cards.</p>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <section aria-label="KPI cards" className="min-w-0 space-y-2">
              {categories.map((category) => {
                const isOpen = openCategories.has(category.id);
                const categoryOptions = category.optionIds.map((id) => optionById.get(id)).filter((option): option is KpiCustomizationOption => Boolean(option));
                const selectedCount = categoryOptions.filter((option) => draftIds.includes(option.id)).length;
                return <section key={category.id} className="overflow-hidden rounded-lg border border-[var(--app-border-subtle)]">
                  <button type="button" aria-expanded={isOpen} aria-controls={`${idPrefix}-kpis-${category.id}`} onClick={() => setOpenCategories((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-primary)]/30">
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--app-text)]">{category.label}</span><span className="block text-xs text-[var(--app-muted)]">{category.description}</span></span>
                    <span className="text-xs font-medium text-[var(--app-muted)]">{selectedCount}/{categoryOptions.length}</span><ChevronDown size={16} aria-hidden="true" className={isOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  {isOpen && <div id={`${idPrefix}-kpis-${category.id}`} className="border-t border-[var(--app-border-subtle)] px-2 py-1">
                    {categoryOptions.map((option) => {
                      const checked = draftIds.includes(option.id);
                      const atMaximum = !checked && draftIds.length >= maximum;
                      const atMinimum = checked && draftIds.length <= minimum;
                      return <label key={option.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--app-surface-subtle)] ${atMaximum || atMinimum ? 'cursor-not-allowed opacity-55' : ''}`}>
                        <input type="checkbox" className="mt-0.5 shrink-0" checked={checked} disabled={atMaximum || atMinimum} onChange={() => toggleOption(option.id)} />
                        <span className="min-w-0"><span className="block text-sm font-medium text-[var(--app-text)]">{option.label}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">{option.description}</span>{option.context && <span className="mt-1 block text-[11px] text-[var(--app-tertiary)]">{option.context}</span>}</span>
                      </label>;
                    })}
                  </div>}
                </section>;
              })}
            </section>
            <section aria-label="Card order" className="min-w-0 border-t border-[var(--app-border-subtle)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
              <h4 className="text-sm font-semibold text-[var(--app-text)]">Card Order</h4><p className="mb-3 text-xs text-[var(--app-muted)]">Choose the order your KPI cards appear.</p>
              <div className="space-y-1">
                {draftIds.map((id, index) => {
                  const label = optionById.get(id)?.label ?? id;
                  return <div key={id} className="flex min-h-10 items-center gap-2 rounded-md bg-[var(--app-surface-subtle)] px-2"><span className="w-4 text-xs font-semibold text-[var(--app-tertiary)]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm text-[var(--app-text)]">{label}</span><span className="flex shrink-0 gap-1"><button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => moveDraft(index, -1)} className="rounded p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-surface)] disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${label} down`} disabled={index === draftIds.length - 1} onClick={() => moveDraft(index, 1)} className="rounded p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-surface)] disabled:cursor-not-allowed disabled:opacity-30"><ArrowDown size={16} /></button></span></div>;
                })}
              </div>
            </section>
          </div>
        </div>
        <footer className="app-modal-footer shrink-0 justify-between border-t border-[var(--app-border-subtle)] bg-[var(--app-surface)] px-4 py-3 sm:px-6"><Button type="button" variant="outline" onClick={() => onDraftChange([...defaultIds])}>Reset to Default</Button><span className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={draftIds.length < minimum || overLimit} onClick={() => onSave([...draftIds])}>Save Changes</Button></span></footer>
      </div>
    </div>
  );
}
