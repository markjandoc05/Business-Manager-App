import type { PlatformSubscriptionService, SignupPlan } from './platform-subscription-service';
import { PlatformIntegrationNotReadyError } from './platform-subscription-service';

/**
 * Development-only preview data. It is never used by production because the
 * factory requires local Firebase emulator mode and an explicit opt-in flag.
 * It exists only to exercise the future Plan Selection UI before the Platform
 * API is available; it is not commercial configuration.
 */
export const DEVELOPMENT_SIGNUP_PLAN: SignupPlan = {
  code: 'development-preview',
  name: 'Development Signup Plan',
  price: 99,
  currency: 'USD',
  billingInterval: 'year',
  trialDays: 14,
  noCreditCardRequired: true,
  marketing: {
    badge: 'Development preview',
    messages: ['This development-only message verifies Platform-managed plan copy rendering.'],
  },
};

export const developmentPlatformSubscriptionService: PlatformSubscriptionService = {
  getAvailableSignupPlans: async () => [DEVELOPMENT_SIGNUP_PLAN],
  getAvailableSignupPlan: async () => DEVELOPMENT_SIGNUP_PLAN,
  startTrial: async () => {
    throw new PlatformIntegrationNotReadyError('Start trial is waiting for the Developer Console provisioning API.');
  },
  refreshSubscription: async () => {
    throw new PlatformIntegrationNotReadyError('License status is waiting for the Developer Console API.');
  },
};
