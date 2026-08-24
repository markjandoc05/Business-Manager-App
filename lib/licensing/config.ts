export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_TRIAL_MAX_USERS = 3;
export const DEFAULT_LEGACY_MAX_USERS = 3;

export const DEFAULT_LICENSE_FEATURES: Record<string, boolean> = {
  crm: true,
  reports: true,
  documents: true,
};

export const LICENSE_PLANS = ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'] as const;
export const LICENSE_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'] as const;

