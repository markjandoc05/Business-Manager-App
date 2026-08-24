export const DEAL_TERMINAL_STAGES = ['Won', 'Lost'] as const;
export const DEAL_ACTIVE_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation'] as const;
export const DEAL_STAGES = [...DEAL_ACTIVE_STAGES, ...DEAL_TERMINAL_STAGES] as const;

export type CanonicalDealStage = typeof DEAL_STAGES[number];

type PipelineStage = { name: string; isActive: boolean };

export function isCanonicalDealStage(stage: string): stage is CanonicalDealStage {
  return DEAL_STAGES.includes(stage as CanonicalDealStage);
}

export function getActiveDealCreationStages(_pipelineStages?: PipelineStage[]) {
  return DEAL_ACTIVE_STAGES.map((name) => ({ name, isActive: true }));
}

export function getDefaultDealCreationStage(_pipelineStages?: PipelineStage[]) {
  return 'New';
}

export function getDealStatusForStage(stage: string): 'Active' | 'Won' | 'Lost' {
  if (stage === 'Won') return 'Won';
  if (stage === 'Lost') return 'Lost';
  return 'Active';
}

export function getDealProbability(stage: string): number {
  switch (stage) {
    case 'New': return 10;
    case 'Qualified': return 25;
    case 'Proposal': return 40;
    case 'Negotiation': return 70;
    case 'Won': return 100;
    case 'Lost': return 0;
    default: return 0;
  }
}
