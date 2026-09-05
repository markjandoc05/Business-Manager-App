'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { Card, Badge } from '@/components/ui/core';
import { formatCurrency } from '@/lib/formatting';
import { DEAL_STAGES, getDealProbability } from '@/lib/deal-workflow';
import type { Deal } from '@/types';

export const PIPELINE_STAGES = DEAL_STAGES;
export const PIPELINE_STAGE_COLORS = ['#9BE15D', '#00B957', '#078B47', '#056B4F', '#032D20', '#B34D3E'] as const;

const STAGE_DESCRIPTIONS: Record<typeof DEAL_STAGES[number], string> = {
  New: 'New opportunities that have just been added to the sales pipeline.',
  Qualified: 'Opportunities that have been reviewed and identified as potential sales.',
  Proposal: 'Opportunities where a proposal, quotation, or solution has been presented.',
  Negotiation: 'Opportunities where pricing, terms, or other details are being discussed.',
  Won: 'Deals that have been successfully closed and won. The value shown is the Won Deal Value.',
  Lost: 'Deals that were not successfully closed. The value shown is the Lost Deal Value.',
};

export function PipelineFunnel({ deals, currency, stageSummary }: { deals: Deal[]; currency: string; stageSummary?: Record<string, { count: number; value: number }> }) {
  const [activeStage, setActiveStage] = useState<typeof DEAL_STAGES[number] | null>(null);
  const pipelineInfoId = useId();
  const hasAuthoritativeSummary = stageSummary !== undefined;

  return <Card className="h-full overflow-visible border-[var(--app-border)] p-4 sm:p-5">
    <div className="flex items-start justify-between gap-4 border-b border-[var(--app-border-subtle)] pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold tracking-tight text-[var(--app-text)]">Pipeline Overview</h2>
          <button type="button" aria-label="About Pipeline Overview" aria-describedby={pipelineInfoId} title="Pipeline values represent Deal Value from opportunities. Won Deal Value may differ from actual Sales recorded in Sales Log." className="group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-tertiary)] transition-colors hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30">
            <Info size={15} aria-hidden="true" />
            <span id={pipelineInfoId} role="tooltip" className="pointer-events-none absolute left-0 top-7 z-20 hidden w-64 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-left text-xs font-normal leading-5 text-[var(--app-text)] shadow-[var(--app-shadow-sm)] group-hover:block group-focus-visible:block">Pipeline values represent Deal Value from opportunities. Won Deal Value may differ from actual Sales recorded in Sales Log.</span>
          </button>
        </div>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Deal count and value as opportunities move through your sales pipeline.</p>
        <p className="mt-1 text-xs text-[var(--app-tertiary)]">Values shown are Deal Value, not recorded Sales.</p>
      </div>
      <Badge variant="blue">{PIPELINE_STAGES.length} stages</Badge>
    </div>
    <div className="mx-auto mt-5 flex w-full max-w-3xl flex-col items-center gap-1.5" aria-label="Pipeline funnel overview">
      {PIPELINE_STAGES.map((stage, index) => {
        const stageDeals = deals.filter((deal) => deal.stage === stage);
        const summary = stageSummary?.[stage];
        const dealCount = hasAuthoritativeSummary ? summary?.count ?? 0 : stageDeals.length;
        const totalValue = hasAuthoritativeSummary ? summary?.value ?? 0 : stageDeals.reduce((sum, deal) => sum + deal.value, 0);
        const width = `${100 - index * 10}%`;
        const dealLabel = `${dealCount} ${dealCount === 1 ? 'deal' : 'deals'}`;

        return <FunnelStage key={stage} stage={stage} color={PIPELINE_STAGE_COLORS[index]} width={width} dealLabel={dealLabel} totalValue={formatCurrency(totalValue, currency)} probability={getDealProbability(stage)} description={STAGE_DESCRIPTIONS[stage]} active={activeStage === stage} onShow={() => setActiveStage(stage)} onHide={() => setActiveStage((current) => current === stage ? null : current)} />;
      })}
    </div>
  </Card>;
}

function FunnelStage({ stage, color, width, dealLabel, totalValue, probability, description, active, onShow, onHide }: {
  stage: typeof DEAL_STAGES[number];
  color: string;
  width: string;
  dealLabel: string;
  totalValue: string;
  probability: number;
  description: string;
  active: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [positionedStage, setPositionedStage] = useState<typeof DEAL_STAGES[number] | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;

    const dismissOnOutsideTouch = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && !stageRef.current?.contains(event.target as Node)) onHide();
    };

    document.addEventListener('pointerdown', dismissOnOutsideTouch);
    return () => document.removeEventListener('pointerdown', dismissOnOutsideTouch);
  }, [active, onHide]);

  useLayoutEffect(() => {
    if (!active) return;

    const updateTooltipPosition = () => {
      const stageElement = stageRef.current;
      const tooltipElement = tooltipRef.current;
      if (!stageElement || !tooltipElement) return;

      const stageRect = stageElement.getBoundingClientRect();
      const tooltipRect = tooltipElement.getBoundingClientRect();
      const edgePadding = 10;
      const gap = 14;
      const maxLeft = Math.max(edgePadding, window.innerWidth - tooltipRect.width - edgePadding);
      const maxTop = Math.max(edgePadding, window.innerHeight - tooltipRect.height - edgePadding);

      let left: number;
      let top: number;
      if (pointerPosition) {
        left = pointerPosition.x + gap;
        top = pointerPosition.y + gap;
        if (left + tooltipRect.width > window.innerWidth - edgePadding) left = pointerPosition.x - tooltipRect.width - gap;
        if (top + tooltipRect.height > window.innerHeight - edgePadding) top = pointerPosition.y - tooltipRect.height - gap;
        left = Math.min(Math.max(left, edgePadding), maxLeft);
        top = Math.min(Math.max(top, edgePadding), maxTop);
      } else {
        const canPlaceRight = stageRect.right + gap + tooltipRect.width <= window.innerWidth - edgePadding;
        const canPlaceLeft = stageRect.left - gap - tooltipRect.width >= edgePadding;
        const centeredTop = stageRect.top + (stageRect.height - tooltipRect.height) / 2;
        if (canPlaceRight) {
          left = stageRect.right + gap;
          top = Math.min(Math.max(centeredTop, edgePadding), maxTop);
        } else if (canPlaceLeft) {
          left = stageRect.left - gap - tooltipRect.width;
          top = Math.min(Math.max(centeredTop, edgePadding), maxTop);
        } else {
          left = Math.min(Math.max(stageRect.left + (stageRect.width - tooltipRect.width) / 2, edgePadding), maxLeft);
          const belowTop = stageRect.bottom + gap;
          const aboveTop = stageRect.top - tooltipRect.height - gap;
          top = belowTop <= maxTop ? belowTop : Math.max(edgePadding, aboveTop);
        }
      }

      setTooltipPosition({ top, left });
      setPositionedStage(stage);
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [active, pointerPosition, stage]);

  return <>
    <div
      ref={stageRef}
      tabIndex={0}
      role="group"
      aria-describedby={active ? tooltipId : undefined}
      onMouseEnter={(event) => {
        setPointerPosition({ x: event.clientX, y: event.clientY });
        onShow();
      }}
      onMouseLeave={onHide}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') setPointerPosition({ x: event.clientX, y: event.clientY });
      }}
      onFocus={() => {
        setPointerPosition(null);
        onShow();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPointerPosition(null);
          onHide();
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') {
          setPointerPosition(null);
          if (active) onHide();
          else onShow();
        }
      }}
      className="flex min-h-[62px] items-center justify-center px-4 py-2.5 shadow-sm transition-[filter,box-shadow] duration-200 hover:brightness-105 focus-visible:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:px-6"
      style={{ width, color: color === PIPELINE_STAGE_COLORS[0] ? '#032D20' : '#FFFFFF', backgroundColor: color, clipPath: 'polygon(3% 0, 97% 0, 94% 100%, 6% 100%)' }}
    >
      <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
        <div className="flex min-w-0 items-center justify-center gap-3 text-sm font-semibold sm:text-base">
          <span className="truncate">{stage}</span>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current/25" />
          <span className="shrink-0 tabular-nums">{totalValue}</span>
        </div>
        <p className="truncate text-xs opacity-80">{dealLabel} · {probability}% probability{stage === 'Won' ? ' · Won Deal Value' : stage === 'Lost' ? ' · Lost Deal Value' : ''}</p>
      </div>
    </div>
    {active && typeof document !== 'undefined' && createPortal(
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        aria-hidden={positionedStage !== stage}
        style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
      className={`pointer-events-none fixed z-[1000] w-[min(260px,calc(100vw-1.25rem))] rounded-lg border border-[var(--app-border)] bg-white p-3 text-left shadow-[var(--app-shadow-md)] transition-opacity duration-150 ${positionedStage === stage ? 'opacity-100' : 'opacity-0'}`}
      >
        <p className="text-sm font-semibold text-[var(--app-text)]">{stage}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">{description}</p>
      </div>,
      document.body,
    )}
  </>;
}
