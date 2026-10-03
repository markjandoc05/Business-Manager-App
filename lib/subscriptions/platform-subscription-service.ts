import type { BusinessType } from '@/types';
import type { LicensePlan } from '@/types/auth';

export interface SignupPlanMarketing {
  /** Platform-owned display copy. It is never used for authorization or provisioning. */
  badge?: string;
  messages: string[];
}

export interface SignupPlan {
  code: string;
  name: string;
  price: number;
  currency: string;
  billingInterval: string;
  trialDays: number;
  noCreditCardRequired: boolean;
  marketing?: SignupPlanMarketing;
}

export type PlatformLicenseStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
export type PlatformSubscriptionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_PLAN'
  | 'PLAN_UNAVAILABLE'
  | 'FOUNDING_LIMIT_REACHED'
  | 'TRIAL_ALREADY_EXISTS'
  | 'WORKSPACE_ALREADY_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_REQUEST'
  | 'LICENSE_NOT_FOUND'
  | 'PROVISIONING_FAILED'
  | 'INTERNAL_ERROR'
  | 'PLATFORM_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'platform-integration-not-ready';

export interface LicenseStatus {
  planCode: string;
  planName?: string;
  plan: LicensePlan;
  status: PlatformLicenseStatus;
  maxUsers: number;
  trialStartedAt?: string;
  trialEndsAt?: string;
  subscriptionStartedAt?: string | null;
  renewalDate?: string | null;
  expirationDate?: string | null;
  billingInterval?: string;
}

export interface StartTrialRequest {
  planCode: string;
  idempotencyKey: string;
  workspace: {
    name: string;
    requestedSlug?: string;
    businessType: BusinessType;
    phone: string;
    website: string;
    currency: string;
    timezone: string;
  };
}

export interface StartTrialResult {
  workspaceId: string;
  organizationId: string;
  productCode: string;
  legacy: false;
  idempotent: boolean;
  provisioningStatus: 'PROVISIONED';
  license: LicenseStatus;
}

export interface PlatformSubscriptionService {
  getAvailableSignupPlans(): Promise<SignupPlan[]>;
  /** Retained for callers that only support one currently public signup plan. */
  getAvailableSignupPlan(): Promise<SignupPlan>;
  startTrial(request: StartTrialRequest): Promise<StartTrialResult>;
  /**
   * Ask the Platform to refresh subscription state for an authorized workspace.
   * The public V1 contract does not define a subscription response shape, so
   * Client authorization continues to come exclusively from canonical Firestore.
   */
  refreshSubscription(workspaceId: string): Promise<void>;
}

export class PlatformSubscriptionError extends Error {
  readonly code: PlatformSubscriptionErrorCode;

  constructor(code: PlatformSubscriptionErrorCode, message = 'The Platform request could not be completed.') {
    super(message);
    this.name = 'PlatformSubscriptionError';
    this.code = code;
  }
}

/** Retained for the explicitly gated local preview service. */
export class PlatformIntegrationNotReadyError extends PlatformSubscriptionError {
  constructor(message = 'Subscription onboarding will be available when the Platform API is connected.') {
    super('platform-integration-not-ready', message);
    this.name = 'PlatformIntegrationNotReadyError';
  }
}

type FetchLike = typeof fetch;
type TokenProvider = () => Promise<string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 300): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= maxLength;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isLicensePlan(value: unknown): value is LicensePlan {
  return typeof value === 'string' && ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'].includes(value);
}

function isLicenseStatus(value: unknown): value is PlatformLicenseStatus {
  return typeof value === 'string' && ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(value);
}

function validDate(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function platformError(value: unknown, fallback = 'INTERNAL_ERROR'): PlatformSubscriptionError {
  if (isRecord(value) && value.success === false && isRecord(value.error) && nonEmptyString(value.error.code, 100)) {
    const code = value.error.code as PlatformSubscriptionErrorCode;
    const message = nonEmptyString(value.error.message) ? value.error.message : undefined;
    return new PlatformSubscriptionError(code, message);
  }
  return new PlatformSubscriptionError(fallback as PlatformSubscriptionErrorCode);
}

async function unavailableBrowserToken() { return null; }

function parsePlanMarketing(value: unknown): SignupPlanMarketing | undefined {
  if (!isRecord(value)) return undefined;
  const { badge, messages } = value;
  if ((badge !== undefined && !nonEmptyString(badge, 160))
    || !Array.isArray(messages)
    || messages.length === 0
    || messages.length > 3
    || !messages.every((message) => nonEmptyString(message, 300))) return undefined;
  return {
    ...(nonEmptyString(badge, 160) ? { badge: badge.trim() } : {}),
    messages: messages.map((message) => message.trim()),
  };
}

function parsePlans(value: unknown): SignupPlan[] {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data) || !Array.isArray(value.data.plans)) {
    throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned invalid signup plans.');
  }
  const plans: SignupPlan[] = [];
  for (const candidate of value.data.plans) {
    if (!isRecord(candidate)) continue;
    const { code, name, price, currency, billingInterval, trialDays, requiresCard, available, marketing } = candidate;
    if (available !== true
      || !nonEmptyString(code, 128)
      || !nonEmptyString(name, 160)
      || typeof price !== 'number' || !Number.isFinite(price) || price < 0
      || !nonEmptyString(currency, 12)
      || !nonEmptyString(billingInterval, 32)
      || typeof trialDays !== 'number' || !Number.isInteger(trialDays) || trialDays < 0 || trialDays > 366
      || typeof requiresCard !== 'boolean') continue;
    const parsedMarketing = parsePlanMarketing(marketing);
    plans.push({
      code,
      name,
      price,
      currency,
      billingInterval,
      trialDays,
      noCreditCardRequired: !requiresCard,
      ...(parsedMarketing ? { marketing: parsedMarketing } : {}),
    });
  }
  return plans;
}

function parseLicense(value: unknown, productCode: string): LicenseStatus {
  if (!isRecord(value)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid license.');
  const { plan, status, maxUsers, trialStartedAt, trialEndsAt, subscriptionStartedAt, renewalDate, expirationDate, billingInterval } = value;
  if (!isLicensePlan(plan) || !isLicenseStatus(status) || !positiveInteger(maxUsers)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid license.');
  if (status === 'TRIAL' && plan !== 'TRIAL') throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid trial license.');
  if (status === 'ACTIVE' && plan === 'TRIAL') throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid active license.');
  if (trialStartedAt !== undefined && trialStartedAt !== null && !validDate(trialStartedAt)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned invalid trial dates.');
  if (trialEndsAt !== undefined && trialEndsAt !== null && !validDate(trialEndsAt)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned invalid trial dates.');
  if (subscriptionStartedAt !== undefined && subscriptionStartedAt !== null && !validDate(subscriptionStartedAt)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned invalid subscription dates.');
  if (renewalDate !== undefined && renewalDate !== null && !validDate(renewalDate)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid renewal date.');
  if (expirationDate !== undefined && expirationDate !== null && !validDate(expirationDate)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid expiration date.');
  if (billingInterval !== undefined && !nonEmptyString(billingInterval, 32)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid billing interval.');
  return {
    planCode: productCode,
    plan,
    status,
    maxUsers,
    ...(validDate(trialStartedAt) ? { trialStartedAt } : {}),
    ...(validDate(trialEndsAt) ? { trialEndsAt } : {}),
    ...(subscriptionStartedAt === null || validDate(subscriptionStartedAt) ? { subscriptionStartedAt } : {}),
    ...(renewalDate === null || validDate(renewalDate) ? { renewalDate } : {}),
    ...(expirationDate === null || validDate(expirationDate) ? { expirationDate } : {}),
    ...(nonEmptyString(billingInterval, 32) ? { billingInterval } : {}),
  };
}

function parseProvisioning(value: unknown, requestedPlanCode: string): StartTrialResult {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid provisioning response.');
  const data = value.data;
  if (!nonEmptyString(data.workspaceId, 128)
    || !nonEmptyString(data.organizationId, 128)
    || !nonEmptyString(data.productCode, 128)
    || data.productCode !== requestedPlanCode
    || data.legacy !== false
    || typeof data.idempotent !== 'boolean'
    || data.provisioningStatus !== 'PROVISIONED') throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid provisioning response.');
  const license = parseLicense(data.license, data.productCode);
  if (license.plan !== 'TRIAL' || license.status !== 'TRIAL' || !validDate(license.trialStartedAt) || !validDate(license.trialEndsAt) || !validDate(license.expirationDate)) {
    throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid trial provision.');
  }
  return {
    workspaceId: data.workspaceId,
    organizationId: data.organizationId,
    productCode: data.productCode,
    legacy: false,
    idempotent: data.idempotent,
    provisioningStatus: 'PROVISIONED',
    license,
  };
}

async function proxyRequest(fetchFn: FetchLike, path: string, options: RequestInit = {}, authenticated = false, tokenProvider: TokenProvider = unavailableBrowserToken) {
  const headers = new Headers(options.headers);
  if (authenticated) {
    const token = await tokenProvider();
    if (!token) throw new PlatformSubscriptionError('UNAUTHENTICATED', 'Please sign in again before continuing.');
    headers.set('Authorization', `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetchFn(path, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new PlatformSubscriptionError('PLATFORM_UNAVAILABLE', 'Platform onboarding is temporarily unavailable. Please try again.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PlatformSubscriptionError('INVALID_RESPONSE', 'The Platform returned an invalid response.');
  }
  if (!response.ok || !isRecord(payload) || payload.success !== true) throw platformError(payload);
  return payload;
}

/** The browser talks only to same-origin Client App routes. */
export function createPlatformApiSubscriptionService(dependencies: { fetchFn?: FetchLike; tokenProvider?: TokenProvider } = {}): PlatformSubscriptionService {
  const fetchFn = dependencies.fetchFn || fetch;
  const tokenProvider = dependencies.tokenProvider || unavailableBrowserToken;
  return {
    async getAvailableSignupPlans() {
      return parsePlans(await proxyRequest(fetchFn, '/api/platform/plans'));
    },
    async getAvailableSignupPlan() {
      const plans = await this.getAvailableSignupPlans();
      if (!plans.length) throw new PlatformSubscriptionError('PLAN_UNAVAILABLE', 'No signup plan is currently available.');
      return plans[0];
    },
    async startTrial(request) {
      const phone = request.workspace.phone.trim();
      const website = request.workspace.website.trim();
      const payload = await proxyRequest(fetchFn, '/api/platform/trials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({
          productCode: request.planCode,
          workspace: {
            businessName: request.workspace.name,
            ...(request.workspace.requestedSlug ? { requestedSlug: request.workspace.requestedSlug } : {}),
            businessType: request.workspace.businessType,
            ...(phone ? { phone } : {}),
            ...(website ? { website } : {}),
            currency: request.workspace.currency,
            timezone: request.workspace.timezone,
          },
        }),
      }, true, tokenProvider);
      return parseProvisioning(payload, request.planCode);
    },
    async refreshSubscription(workspaceId) {
      // The canonical Firestore license remains the authorization source after
      // this Platform refresh request; its response is never used to grant access.
      await proxyRequest(fetchFn, `/api/platform/subscription?workspaceId=${encodeURIComponent(workspaceId)}`, {}, true, tokenProvider);
    },
  };
}

export function createPlatformSubscriptionService(implementation?: PlatformSubscriptionService): PlatformSubscriptionService {
  return implementation || createPlatformApiSubscriptionService();
}
