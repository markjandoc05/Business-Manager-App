export type FirebaseAuthFailureClassification =
  | 'AUTH_TOKEN_REVOKED'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_USER_DISABLED'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_PROJECT_MISMATCH'
  | 'AUTH_ARGUMENT_INVALID'
  | 'AUTH_CERTIFICATE_ERROR'
  | 'AUTH_INTERNAL'
  | 'AUTH_UNKNOWN';

export interface FirebaseAuthDiagnostic {
  classification: FirebaseAuthFailureClassification;
  firebaseCode: string;
  message: string;
}

function errorField(error: unknown, field: 'code' | 'message') {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeFirebaseAuthMessage(message: string) {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'Firebase authentication failed.';
}

export function classifyFirebaseAuthError(error: unknown): FirebaseAuthFailureClassification {
  try {
    const code = errorField(error, 'code').toLowerCase();
    const message = errorField(error, 'message').toLowerCase();

    if (code === 'auth/id-token-revoked' || message.includes('revoked')) return 'AUTH_TOKEN_REVOKED';
    if (code === 'auth/id-token-expired' || message.includes('expired')) return 'AUTH_TOKEN_EXPIRED';
    if (code === 'auth/user-disabled' || message.includes('disabled')) return 'AUTH_USER_DISABLED';
    if (code === 'auth/project-id-mismatch' || code === 'auth/id-token-project-id-mismatch' || code === 'auth/id-token-issuer-mismatch') return 'AUTH_PROJECT_MISMATCH';
    if (code === 'auth/argument-error' || code === 'auth/invalid-argument') return 'AUTH_ARGUMENT_INVALID';
    if (code === 'auth/certificate-fetch-failed' || code === 'auth/certificate-fetch-error' || message.includes('certificate') || message.includes('public key')) return 'AUTH_CERTIFICATE_ERROR';
    if (code === 'auth/internal-error' || code === 'auth/internal') return 'AUTH_INTERNAL';
    if (code === 'auth/invalid-id-token' || code === 'auth/invalid-token' || code === 'auth/id-token-signature-invalid') return 'AUTH_TOKEN_INVALID';
    if (message.includes('incorrect') && (message.includes('aud') || message.includes('issuer') || message.includes('project'))) return 'AUTH_PROJECT_MISMATCH';
    if (message.includes('argument') || message.includes('expected a string')) return 'AUTH_ARGUMENT_INVALID';
    if (message.includes('signature') || message.includes('jwt') || message.includes('id token') || message.includes('token')) return 'AUTH_TOKEN_INVALID';
    return 'AUTH_UNKNOWN';
  } catch {
    return 'AUTH_UNKNOWN';
  }
}

export function describeFirebaseAuthError(error: unknown): FirebaseAuthDiagnostic {
  const firebaseCode = errorField(error, 'code') || 'unknown';
  const message = sanitizeFirebaseAuthMessage(errorField(error, 'message'));
  return { classification: classifyFirebaseAuthError(error), firebaseCode, message };
}
