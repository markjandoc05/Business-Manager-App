export const DEAL_TERMINAL_STAGES = ['Won', 'Lost'] as const;
export const DEAL_ACTIVE_STAGES = ['Opportunity', 'Proposal', 'Negotiation'] as const;

type PipelineStage = { name: string; isActive: boolean };

export function getActiveDealCreationStages(pipelineStages: PipelineStage[]) {
  return pipelineStages.filter(
    (stage) => stage.isActive
      && DEAL_ACTIVE_STAGES.includes(stage.name as typeof DEAL_ACTIVE_STAGES[number])
      && !DEAL_TERMINAL_STAGES.includes(stage.name as typeof DEAL_TERMINAL_STAGES[number]),
  );
}

export function getDefaultDealCreationStage(pipelineStages: PipelineStage[]) {
  return getActiveDealCreationStages(pipelineStages)[0]?.name ?? '';
}

export function getDealStatusForStage(stage: string): 'Active' | 'Won' | 'Lost' {
  if (stage === 'Won') return 'Won';
  if (stage === 'Lost') return 'Lost';
  return 'Active';
}

export function getDealProbability(stage: string): number {
  switch (stage) {
    case 'Opportunity': return 20;
    case 'Proposal': return 40;
    case 'Negotiation': return 70;
    case 'Won': return 100;
    case 'Lost': return 0;
    default: return 0;
  }
}
