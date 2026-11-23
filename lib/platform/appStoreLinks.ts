/**
 * Public store listings for the AllFantasy apps, in one import for the store badges.
 *
 * Re-exports only: the App Store listing is defined in lib/platform/iosAppStore.ts and the Google Play
 * listing in lib/platform/androidApp.ts. Do not define a URL here — a second copy is how two links drift.
 */
export { APP_STORE_URL } from '@/lib/platform/iosAppStore'
export { PLAY_STORE_URL } from '@/lib/platform/androidApp'
