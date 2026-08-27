import React from 'react';
import { Shield } from 'lucide-react';

export function SecurityTrustFooter() {
  return (
    <footer className="security-trust-footer" aria-label="Security information">
      <div className="min-w-0">
        <p className="security-trust-footer-title font-medium text-slate-600">
          <Shield size={14} aria-hidden="true" />
          <span>Secure Cloud Infrastructure</span>
        </p>
        <p className="text-xs text-slate-400">Your business data is securely managed using Google Cloud and Firebase infrastructure.</p>
      </div>
    </footer>
  );
}
