/**
 * Local Firebase emulator mode is deliberately opt-in and development-only.
 * Keeping this check in one place prevents a public environment variable from
 * ever switching a production build away from the configured Firebase project.
 */
export function isLocalFirebaseEmulatorMode(environment?: Record<string, string | undefined>) {
  // Keep the direct references intact so Next.js can inline public variables
  // into the browser bundle. A dynamic `process.env` object is empty there.
  const nodeEnv = environment?.NODE_ENV ?? process.env.NODE_ENV;
  const emulatorFlag = environment?.NEXT_PUBLIC_USE_FIREBASE_EMULATORS ?? process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
  const projectId = environment?.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const localUatFlag = environment?.NEXT_PUBLIC_LOCAL_UAT ?? process.env.NEXT_PUBLIC_LOCAL_UAT;
  const isDemoProject = projectId === 'demo-bsm-client-app';
  // A production build may opt into the emulator only for the explicitly
  // marked local-UAT demo project. The real BSM project can never be switched
  // to an emulator by a public flag.
  return emulatorFlag === 'true' && isDemoProject && (nodeEnv !== 'production' || localUatFlag === 'true');
}
