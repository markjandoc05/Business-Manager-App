type StartupPoint = { elapsedMs: number };

type StartupTrace = {
  startedAt: number;
  loginStartedAt?: number;
  points: Map<string, StartupPoint>;
  stages: Map<string, { startedAt: number; endedAt?: number }>;
  counters: Map<string, number>;
  uid?: string;
  emitted: boolean;
};

let trace: StartupTrace | null = null;
let lastEmission = '';

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function elapsed(at: number) {
  return Math.max(0, Math.round(at - (trace?.startedAt || at)));
}

export function beginStartupTrace(uid?: string) {
  if (trace && !trace.emitted && (!uid || !trace.uid || trace.uid === uid)) {
    trace.uid = uid || trace.uid;
    return;
  }
  const startedAt = now();
  trace = {
    startedAt,
    loginStartedAt: uid ? undefined : startedAt,
    points: new Map(),
    stages: new Map(),
    counters: new Map(),
    uid,
    emitted: false,
  };
  lastEmission = '';
}

export function markStartup(label: string) {
  if (process.env.NODE_ENV === 'production' || !trace) return;
  trace.points.set(label, { elapsedMs: elapsed(now()) });
}

export function startStartupStage(stage: string) {
  if (process.env.NODE_ENV === 'production' || !trace) return;
  trace.stages.set(stage, { startedAt: now() });
}

export function finishStartupStage(stage: string) {
  if (process.env.NODE_ENV === 'production' || !trace) return;
  const current = trace.stages.get(stage);
  if (current) current.endedAt = now();
}

/**
 * Records a development-only operation count for the current startup trace.
 * Counters intentionally stay in this module so instrumentation never carries
 * request payloads, IDs, or other user data into the browser console.
 */
export function incrementStartupCounter(counter: string, amount = 1) {
  if (process.env.NODE_ENV === 'production' || !trace) return;
  trace.counters.set(counter, (trace.counters.get(counter) || 0) + amount);
}

function point(label: string) {
  return trace?.points.get(label)?.elapsedMs ?? null;
}

function stageDuration(stage: string) {
  const current = trace?.stages.get(stage);
  return current === undefined ? null : Math.max(0, Math.round((current.endedAt || now()) - current.startedAt));
}

function maxStageDuration(stages: string[]) {
  const durations = stages.map(stageDuration).filter((duration): duration is number => duration !== null);
  return durations.length ? Math.max(...durations) : null;
}

export function observeStartupLcp(selector: string) {
  if (process.env.NODE_ENV === 'production' || !trace || typeof PerformanceObserver === 'undefined') return undefined;
  if (!PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) return undefined;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const candidate = entry as PerformanceEntry & { element?: Element | null };
      if (!candidate.element?.closest(selector)) continue;
      trace?.points.set('kpi-lcp', { elapsedMs: elapsed(candidate.startTime) });
      emitStartupTiming();
    }
  });
  observer.observe({ type: 'largest-contentful-paint', buffered: true });
  return () => observer.disconnect();
}

export function emitStartupTiming() {
  if (process.env.NODE_ENV === 'production' || !trace) return;
  const authReadyMs = point('auth-ready');
  const organizationResolvedMs = point('organization-resolved');
  const shellRenderableMs = point('shell-renderable');
  const timing = {
    startupToAuthReadyMs: authReadyMs,
    googlePopupToAuthReadyMs: authReadyMs === null || trace.loginStartedAt === undefined ? null : authReadyMs,
    rootUserDurationMs: stageDuration('root-user'),
    membershipQueryDurationMs: stageDuration('membership-query'),
    organizationResolutionDurationMs: stageDuration('organization-resolution'),
    startupToRootUserCompleteMs: point('root-user-complete'),
    startupToMembershipCompleteMs: point('membership-complete'),
    startupToOrganizationResolvedMs: organizationResolvedMs,
    authReadyToShellMs: authReadyMs === null || shellRenderableMs === null ? null : Math.max(0, shellRenderableMs - authReadyMs),
    loginClickToShellMs: trace.loginStartedAt === undefined || shellRenderableMs === null ? null : Math.max(0, shellRenderableMs - elapsed(trace.loginStartedAt)),
    organizationResolvedToShellMs: organizationResolvedMs === null || shellRenderableMs === null ? null : Math.max(0, shellRenderableMs - organizationResolvedMs),
    shellRenderableMs,
    startupToDashboardFirstPaintMs: point('dashboard-first-paint'),
    startupToKpiLcpMs: point('kpi-lcp'),
    dashboardReadyMs: point('dashboard-data-ready'),
    dashboardStartMs: point('dashboard-start'),
    workspaceReadyMs: point('workspace-ready'),
    dashboardDataStartMs: point('dashboard-data-start'),
    dashboardCriticalDataReadyMs: point('dashboard-critical-data-ready'),
    dashboardCompleteMs: point('dashboard-complete'),
    dashboardSalesMetricsMs: maxStageDuration(['dashboard-kpi-salesRange', 'dashboard-kpi-salesOutstanding']),
    dashboardDealMetricsMs: maxStageDuration(['dashboard-kpi-dealsOpen', 'dashboard-kpi-dealsWon', 'dashboard-kpi-dealsLost']),
    dashboardTaskMetricsMs: maxStageDuration(['dashboard-kpi-tasksFollowups', 'dashboard-kpi-tasksOverdue']),
    dashboardPipelineAggregatesMs: stageDuration('dashboard-pipeline-aggregates'),
    dashboardGroupDurationsMs: Object.fromEntries(
      [...(trace?.stages.entries() || [])]
        .filter(([stage]) => stage.startsWith('dashboard-'))
        .map(([stage]) => [stage, stageDuration(stage)]),
    ),
    dashboardOperationCounts: Object.fromEntries(
      [...(trace?.counters.entries() || [])]
        .filter(([counter]) => counter.startsWith('dashboard-')),
    ),
  };
  const signature = JSON.stringify(timing);
  if (trace.emitted && signature === lastEmission) return;
  trace.emitted = true;
  lastEmission = signature;
  // Keep the payload machine-readable for local profiling while remaining
  // dev-only and free of organization/user identifiers.
  console.info('[Startup Summary]', JSON.stringify(timing));
}
