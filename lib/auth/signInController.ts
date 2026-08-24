type SignInError = { code?: string };

export interface SignInControllerOptions {
  signInWithPopup: () => Promise<unknown>;
  hasCurrentUser: () => boolean;
  setAuthenticating: (value: boolean) => void;
  clearError: () => void;
  setError: (message: string) => void;
  logError?: (error: unknown) => void;
}

export function createSignInController(options: SignInControllerOptions) {
  let inFlight: Promise<void> | null = null;

  const signIn = () => {
    if (options.hasCurrentUser()) return Promise.resolve();
    if (inFlight) return inFlight;

    options.clearError();
    options.setAuthenticating(true);
    const request: Promise<void> = options.signInWithPopup()
      .then(() => undefined)
      .catch((error: SignInError) => {
        if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
          options.logError?.(error);
          options.setError('We couldn\'t sign you in. Please try again.');
        }
      })
      .finally(() => {
        inFlight = null;
        options.setAuthenticating(false);
      });

    inFlight = request;
    return request;
  };

  return { signIn };
}
