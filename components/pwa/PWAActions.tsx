"use client";

import { useEffect, useState } from 'react';
import { canInstallApp, isInstalled, shareApp, triggerInstall } from '@/lib/pwa';

export function InstallButton({
  className = '',
  hideWhenInstalled = false,
}: {
  className?: string;
  /**
   * Render nothing once the app is installed, instead of an "App Installed" chip.
   * For surfaces where this is a nudge rather than a status line — the alerts ask on
   * /core/notifications, where an already-installed user has no reason to see it.
   */
  hideWhenInstalled?: boolean;
}) {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setInstalled(isInstalled());
    setCanInstall(canInstallApp());

    const onReady = () => setCanInstall(true);
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
    };

    window.addEventListener('af-install-ready', onReady);
    window.addEventListener('af-installed', onInstalled);

    return () => {
      window.removeEventListener('af-install-ready', onReady);
      window.removeEventListener('af-installed', onInstalled);
    };
  }, []);

  if (installed && hideWhenInstalled) {
    return null;
  }

  if (installed) {
    return (
      <span
        className={`inline-flex cursor-default items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white/60 ${className}`}
      >
        <span aria-hidden="true">✓</span>
        <span>App Installed</span>
      </span>
    );
  }

  if (!canInstall) {
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white/70 transition-all hover:border-cyan-500/50 hover:text-white ${className}`}
        onClick={() => alert(getInstallInstructions())}
      >
        <DownloadIcon />
        <span>Add to Home Screen</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={installing}
      onClick={async () => {
        setInstalling(true);
        try {
          await triggerInstall();
        } finally {
          setInstalling(false);
        }
      }}
      className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
    >
      <DownloadIcon />
      <span>{installing ? 'Installing…' : 'Download App'}</span>
    </button>
  );
}

export function ShareButton({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const result = await shareApp();
    if (result === 'copied') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleShare();
      }}
      className={`inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white/70 transition-all hover:border-white/40 hover:text-white ${className}`}
    >
      <ShareIcon />
      <span>{copied ? 'Link Copied!' : 'Share'}</span>
    </button>
  );
}

function getInstallInstructions(): string {
  const ua = navigator.userAgent;

  if (/iPhone|iPad/.test(ua)) {
    return `To install on iOS:
1. Tap the Share button (box with arrow up) in Safari
2. Scroll down and tap "Add to Home Screen"
3. Tap "Add"`;
  }

  if (/Android/.test(ua)) {
    return `To install on Android:
1. Tap the browser menu (⋮ or …)
2. Tap "Add to Home Screen" or "Install App"
3. Tap "Install"`;
  }

  return `To install on desktop:
1. Look for the install icon (⊕) in your browser address bar
2. Click "Install"

Or: Chrome Menu → More tools → Create shortcut → check "Open as window"`;
}

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 1v9M4.5 7l3.5 3.5L11.5 7M2 13h12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M11 2l3 3-3 3M14 5H6a3 3 0 000 6h1M5 11l-3-3 3-3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
