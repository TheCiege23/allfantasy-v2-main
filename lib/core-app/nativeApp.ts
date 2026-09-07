/**
 * Native-app links on phones — measured, not assumed.
 *
 * A tap on one of our platform links lands in the platform's APP only where
 * the platform has associated its web domain with its app for that path:
 * Apple universal links (`/.well-known/apple-app-site-association`) on an
 * iPhone, Android App Links (`/.well-known/assetlinks.json`) on Android. Our
 * links are ordinary https URLs, so they already do this wherever the
 * association exists — this module's job is to SAY where the tap will land,
 * so a manager at kickoff minus twenty is not surprised by a login page.
 *
 * No custom URL scheme is used. None of the launch providers publishes one,
 * and inventing a `sleeper://…` would send a manager to a broken screen at
 * the worst possible moment. If a provider documents one, it goes through
 * the same verification the deep links did (Guap opens it on his phone and
 * the format is flipped to verified with the ids recorded).
 *
 * ⚠ MEASURED 2026-09-06 from each host's own association files:
 *
 *   sleeper.com (and sleeper.app)
 *     iPhone: universal links cover ONLY /topics/*, /channels/*, /topic/*,
 *       /message/* — NOT /leagues/*. Every league screen we link to opens in
 *       Safari, not the app, and the file marks that as deliberate.
 *     Android: com.sleeperbot claims the domain (handle_all_urls); which paths
 *       open in-app is decided by the app's own manifest, which we cannot read.
 *   fantasy.espn.com
 *     iPhone: com.espn.fantasyFootball covers /＊/team, /＊/players/add,
 *       /＊/league and its sub-pages — so lineup (team), waivers (players/add),
 *       trade (the partner's team page) and the league page all open the app.
 *     Android: com.espn.fantasy.lm.football claims the domain.
 *   football.fantasysports.yahoo.com
 *     iPhone: com.yahoo.ffootball2009 covers /f1/＊/＊ — lineup (/f1/L/T),
 *       waivers (/f1/L/players) and trade (/f1/L/T/proposetrade) open the
 *       app; the league page (/f1/L, one segment) does NOT.
 *     Android: com.yahoo.mobile.client.android.fantasyfootball claims it.
 *
 * Re-measure with `curl -sL https://<host>/.well-known/apple-app-site-association`
 * and `…/assetlinks.json`. A platform can change this without telling us,
 * which is why the table carries its date: a stale claim is visibly stale.
 * Pure and client-safe.
 */

export const APP_LINKS_MEASURED_ON = '2026-09-06'

export type AppLinkLanding = 'app' | 'web' | 'unknown'
export type PhoneOs = 'ios' | 'android'
type Screen = 'lineup' | 'waivers' | 'trade' | 'league'

const IOS: Record<string, Record<Screen, AppLinkLanding>> = {
  sleeper: { lineup: 'web', waivers: 'web', trade: 'web', league: 'web' },
  espn: { lineup: 'app', waivers: 'app', trade: 'app', league: 'app' },
  yahoo: { lineup: 'app', waivers: 'app', trade: 'app', league: 'web' },
}

/** The domain is claimed by the app on Android; the paths it opens are the app's own business. */
const ANDROID_CLAIMED = new Set(['sleeper', 'espn', 'yahoo'])

const LABEL: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo' }

/** "ios" for an iPhone/iPad/iPod, "android" for Android, null for anything else (desktop, unknown). */
export function phoneOs(userAgent: string | null | undefined): PhoneOs | null {
  const ua = userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

function platformKey(platform: string | null | undefined): string | null {
  const key = (platform ?? '').trim().toLowerCase()
  return key in IOS ? key : null
}

function screenKey(screen: string | null | undefined): Screen | null {
  const s = (screen ?? '').trim().toLowerCase()
  return s === 'lineup' || s === 'waivers' || s === 'trade' || s === 'league' ? s : null
}

/**
 * Where a tap on this platform's screen lands on this phone. Null when we
 * hold no measurement for the platform, the screen or the device — a desktop,
 * an AllFantasy-native league, an unverified screen — so nothing is claimed.
 */
export function appLinkLanding(platform: string | null | undefined, screen: string | null | undefined, os: PhoneOs | null): AppLinkLanding | null {
  const p = platformKey(platform)
  const s = screenKey(screen)
  if (!p || !s || !os) return null
  if (os === 'ios') return IOS[p]![s]
  return ANDROID_CLAIMED.has(p) ? 'unknown' : null
}

/** The one line under the button: "Opens in the Yahoo app when it's installed". Null when nothing is known. */
export function appLinkHint(platform: string | null | undefined, screen: string | null | undefined, os: PhoneOs | null): string | null {
  const landing = appLinkLanding(platform, screen, os)
  if (!landing) return null
  const name = LABEL[platformKey(platform)!] ?? platform
  if (landing === 'app') return `Opens in the ${name} app when it’s installed`
  if (landing === 'unknown') return `May open the ${name} app`
  return os === 'ios' && platformKey(platform) === 'sleeper'
    ? `Opens ${name} on the web — its app does not take league links on iPhone`
    : `Opens ${name} on the web`
}
