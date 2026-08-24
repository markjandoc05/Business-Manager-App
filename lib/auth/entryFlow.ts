export type EntryIntent = 'create' | 'signin';

export function getNoMembershipDestination(intent: EntryIntent | null) {
  return intent === 'create' ? 'onboarding' : 'no-workspace';
}
