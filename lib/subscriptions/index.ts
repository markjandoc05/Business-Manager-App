import { isLocalFirebaseEmulatorMode } from '@/lib/firebase/environment';
import { auth } from '@/lib/firebase/client';
import { developmentPlatformSubscriptionService } from './development-mock';
import { createPlatformApiSubscriptionService, type PlatformSubscriptionService } from './platform-subscription-service';

export * from './platform-subscription-service';

/**
 * An explicit local-only switch keeps the development preview isolated from
 * production and makes replacement with the real Platform API unambiguous.
 */
export function getPlatformSubscriptionService(): PlatformSubscriptionService {
  const useDevelopmentMock = isLocalFirebaseEmulatorMode()
    && process.env.NEXT_PUBLIC_ENABLE_PLATFORM_SUBSCRIPTION_MOCK === 'true';
  if (useDevelopmentMock) return developmentPlatformSubscriptionService;
  return createPlatformApiSubscriptionService({
    tokenProvider: async () => auth.currentUser ? auth.currentUser.getIdToken() : null,
  });
}

export function isPlatformOnboardingEnabled() {
  // This controls availability of new Platform onboarding only. A false value
  // blocks new provisioning; it never restores the retired browser Firestore
  // bootstrap path.
  return process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ONBOARDING === 'true';
}
