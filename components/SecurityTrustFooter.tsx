import React from 'react';
import { Shield } from 'lucide-react';

export function SecurityTrustFooter() {
  return (
    <footer className="security-trust-footer" aria-label="Security information">
      <div className="min-w-0">
        <p className="security-trust-footer-title font-medium text-[var(--app-muted)]">
          <Shield size={14} aria-hidden="true" />
          <span>Secure Cloud Infrastructure</span>
        </p>
        <p className="text-xs text-[var(--app-tertiary)]">Your business data is securely managed using Google Cloud and Firebase infrastructure.</p>
      </div>
    </footer>
  );
}
