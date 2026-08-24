import React from 'react';
import { Card, Badge } from '@/components/ui/core';
import { formatCurrency } from '@/lib/formatting';
import { DEAL_STAGES, getDealProbability } from '@/lib/deal-workflow';
import type { Deal } from '@/types';

export const PIPELINE_STAGES = DEAL_STAGES;

export function PipelineFunnel({ deals, currency, stageSummary }: { deals: Deal[]; currency: string; stageSummary?: Record<string, { count: number; value: number }> }) {
  const stageColors = ['#2563eb', '#3b82f6', '#0f766e', '#d97706', '#b45309'];

  return <Card className="h-full overflow-hidden border-slate-200 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">Pipeline Overview</h2>
        <p className="mt-1 text-sm text-slate-500">Deal count and value as opportunities progress</p>
      </div>
      <Badge variant="blue">{PIPELINE_STAGES.length} stages</Badge>
    </div>
    <div className="mx-auto mt-5 flex w-full max-w-3xl flex-col items-center gap-1.5" aria-label="Pipeline funnel overview">
      {PIPELINE_STAGES.map((stage, index) => {
        const stageDeals = deals.filter((deal) => deal.stage === stage);
        const summary = stageSummary?.[stage];
        const dealCount = summary?.count ?? stageDeals.length;
        const totalValue = summary?.value ?? stageDeals.reduce((sum, deal) => sum + deal.value, 0);
        const width = `${100 - index * 10}%`;
        const dealLabel = `${dealCount} ${dealCount === 1 ? 'deal' : 'deals'}`;

        return <div key={stage} className="flex min-h-[62px] items-center justify-between gap-3 px-4 py-2.5 text-white shadow-sm transition-[width,filter] duration-200 hover:brightness-105 sm:px-6" style={{ width, backgroundColor: stageColors[index], clipPath: 'polygon(3% 0, 97% 0, 94% 100%, 6% 100%)' }}>
          <div className="min-w-0 pl-1 sm:pl-2">
            <p className="truncate text-sm font-semibold">{stage}</p>
            <p className="truncate text-xs text-white/80">{dealLabel} · {getDealProbability(stage)}% probability</p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums sm:text-base">{formatCurrency(totalValue, currency)}</p>
        </div>;
      })}
    </div>
  </Card>;
}
