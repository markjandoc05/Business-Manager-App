type StartupPoint = { elapsedMs: number };

type StartupTrace = {
  startedAt: number;
  loginStartedAt?: number;
  sessionId: string;
  points: Map<string, StartupPoint>;
  stages: Map<string, { startedAt: number; endedAt?: number }>;
  counters: Map<string, number>;
  serverTiming?: Record<string, number>;
  uid?: string;
  emitted: boolean;
  summaryEmitted: boolean;
};

let trace: StartupTrace | null = null;
let lastEmission = '';

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Development by default; production only with an explicit diagnostic flag. */
function diagnosticsEnabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('startupDebug') === '1';
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `startup-${Math.random().toString(36).slice(2, 10)}`;
}

function elapsed(at: number) {
  return Math.max(0, Math.round(at - (trace?.startedAt || at)));
}

export function beginStartupTrace(uid?: string) {
  if (!diagnosticsEnabled()) return;
  if (trace && !trace.emitted && (!uid || !trace.uid || trace.uid === uid)) {
    trace.uid = uid || trace.uid;
    return;
  }
  const startedAt = now();
  trace = {
    startedAt,
    loginStartedAt: uid ? undefined : startedAt,
    sessionId: createSessionId(),
    points: new Map(),
    stages: new Map(),
    counters: new Map(),
    uid,
    emitted: false,
    summaryEmitted: false,
  };
  lastEmission = '';
}

export function markStartup(label: string) {
  if (!diagnosticsEnabled() || !trace) return;
  trace.points.set(label, { elapsedMs: elapsed(now()) });
}

/** Records a named browser Performance mark and its relative startup point. */
export function markStartupEvent(label: string) {
  if (!diagnosticsEnabled() || !trace) return;
  // A startup session represents the first authenticated path. Repeated
  // Firebase callbacks or workspace refreshes must not move its boundaries.
  if (trace.points.has(label)) return;
  const at = now();
  trace.points.set(label, { elapsedMs: elapsed(at) });
  if (typeof performance !== 'undefined') {
    try { performance.mark(`bsm-startup:${trace.sessionId}:${label}`); } catch { /* diagnostics must never affect startup */ }
  }
}

/** Retains only numeric Server-Timing metrics for safe browser diagnostics. */
export function recordStartupServerTiming(header: string | null) {
  if (!diagnosticsEnabled() || !trace || !header) return;
  const timing: Record<string, number> = {};
  for (const part of header.split(',')) {
    const match = part.trim().match(/^([A-Za-z][A-Za-z0-9-]*)\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)$/);
    if (match) timing[match[1]] = Math.round(Number(match[2]));
  }
  if (Object.keys(timing).length) trace.serverTiming = timing;
}

export function startStartupStage(stage: string) {
  if (!diagnosticsEnabled() || !trace) return;
  trace.stages.set(stage, { startedAt: now() });
}

export function finishStartupStage(stage: string) {
  if (!diagnosticsEnabled() || !trace) return;
  const current = trace.stages.get(stage);
  if (current) current.endedAt = now();
}

/**
 * Records a development-only operation count for the current startup trace.
 * Counters intentionally stay in this module so instrumentation never carries
 * request payloads, IDs, or other user data into the browser console.
 */
export function incrementStartupCounter(counter: string, amount = 1) {
  if (!diagnosticsEnabled() || !trace) return;
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
  if (!diagnosticsEnabled() || !trace || typeof PerformanceObserver === 'undefined') return undefined;
  if (!PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) return undefined;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const candidate = entry as PerformanceEntry & { element?: Element | null };
      if (!candidate.element?.closest(selector)) continue;
      trace?.points.set('kpi-lcp', { elapsedMs: elapsed(candidate.startTime) });
    }
  });
  observer.observe({ type: 'largest-contentful-paint', buffered: true });
  return () => observer.disconnect();
}

export function emitStartupTiming() {
  if (!diagnosticsEnabled() || !trace || trace.summaryEmitted || !trace.points.has('DASHBOARD_COMPLETE')) return;
  trace.summaryEmitted = true;
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
    browserMarks: Object.fromEntries([...trace.points.entries()].map(([label, value]) => [label, value.elapsedMs])),
    bootstrapServerTiming: trace.serverTiming || null,
  };
  const signature = JSON.stringify(timing);
  if (trace.emitted && signature === lastEmission) return;
  trace.emitted = true;
  lastEmission = signature;
  const markDuration = (start: string, end: string) => {
    const startPoint = trace?.points.get(start)?.elapsedMs;
    const endPoint = trace?.points.get(end)?.elapsedMs;
    if (startPoint === undefined || endPoint === undefined) return null;
    if (typeof performance !== 'undefined' && trace) {
      try {
        performance.measure(`bsm-startup:${trace.sessionId}:${start}->${end}`, {
          start: `bsm-startup:${trace.sessionId}:${start}`,
          end: `bsm-startup:${trace.sessionId}:${end}`,
        });
      } catch { /* missing marks must not affect startup */ }
    }
    return Math.max(0, endPoint - startPoint);
  };
  const summary = {
    'Google Auth': markDuration('GOOGLE_AUTH_START', 'GOOGLE_AUTH_RESOLVED'),
    'Firebase Auth Transition': markDuration('FIREBASE_AUTH_CALLBACK_START', 'FIREBASE_AUTH_CALLBACK_END'),
    'Token Acquisition': markDuration('TOKEN_REQUEST_START', 'TOKEN_READY'),
    'Bootstrap Network': markDuration('BOOTSTRAP_REQUEST_START', 'BOOTSTRAP_RESPONSE_RECEIVED'),
    'Workspace Finalization': markDuration('WORKSPACE_RESOLUTION_START', 'WORKSPACE_RESOLUTION_COMPLETE'),
    'AuthGate → Dashboard': markDuration('AUTH_GATE_RELEASE', 'DASHBOARD_MOUNT'),
    'Dashboard Critical Data': markDuration('DASHBOARD_DATA_START', 'DASHBOARD_CRITICAL_DATA_READY'),
    'Dashboard Complete': markDuration('DASHBOARD_MOUNT', 'DASHBOARD_COMPLETE'),
    'Login → Dashboard': markDuration('LOGIN_CLICK', 'DASHBOARD_COMPLETE'),
  };
  console.info('BSM Startup Performance');
  console.table(summary);
  console.info('[Startup Marks]', timing.browserMarks, timing.bootstrapServerTiming ? { serverTimingMs: timing.bootstrapServerTiming } : '');
}
