export const DEAL_TERMINAL_STAGES = ['Won', 'Lost'] as const;

type PipelineStage = { name: string; isActive: boolean };

export function getActiveDealCreationStages(pipelineStages: PipelineStage[]) {
  return pipelineStages.filter(
    (stage) => stage.isActive && !DEAL_TERMINAL_STAGES.includes(stage.name as typeof DEAL_TERMINAL_STAGES[number]),
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
