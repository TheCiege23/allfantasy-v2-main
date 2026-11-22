let installPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;

export function initPWA() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('af-install-ready'));
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    window.dispatchEvent(new Event('af-installed'));
    console.log('[AF] PWA installed');
  });

  // Service worker is registered from app/layout via beforeInteractive script so
  // auditors (e.g. PWABuilder) and installability checks see a controller without waiting for React.
}

export function canInstallApp(): boolean {
  return installPrompt !== null;
}

export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!installPrompt) return 'unavailable';

  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome;
}

export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function shareApp(): Promise<'copied' | void> {
  const shareData = {
    title: 'AllFantasy.ai',
    text: 'Fantasy Sports With Chimmy Superpowers — Draft smarter, dominate waivers, win your league.',
    url: 'https://www.allfantasy.ai',
  };

  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }

  await navigator.clipboard.writeText(shareData.url);
  return 'copied';
}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
}
