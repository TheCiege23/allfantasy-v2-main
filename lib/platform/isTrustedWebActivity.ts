/**
 * Is this page running inside our Android Trusted Web Activity?
 *
 * ⚠ WHY THIS EXISTS, AND IT IS A POLICY QUESTION RATHER THAN A UX ONE. The TWA
 * (docs/play-store/twa-manifest.json) opens https://allfantasy.ai/core in a
 * Chrome container shipped through Google Play. Everything on this site is
 * therefore *inside an Android app*, and Google Play's payments policy requires
 * digital goods sold to app users to go through Google Play Billing. A Stripe
 * checkout for subscriptions or tokens reachable in that container is the
 * classic rejection at production review, and can mean removal afterwards.
 *
 * So the purchase path is closed inside the TWA until one of these is true:
 *   - Play Billing is wired via the Digital Goods API + Payment Request API, or
 *   - the US external-billing allowance is deliberately adopted, with its own
 *     link-out compliance requirements.
 *
 * Nothing changes on the open web. The same page in a normal browser, on
 * desktop, or in the iOS PWA still checks out through Stripe exactly as before.
 *
 * ⚠ DETECTION IS BY `document.referrer`, WHICH IS THE DOCUMENTED SIGNAL AND ALSO
 * THE ONLY ONE THAT WORKS. A TWA launch sets the referrer to
 * `android-app://<package>`; there is no navigator flag, no user-agent token
 * that separates a TWA from ordinary Chrome on Android, and `display-mode:
 * standalone` matches an installed PWA too — which is NOT distributed through
 * Play and must keep its Stripe checkout.
 *
 * ⚠ AND THE REFERRER ONLY SURVIVES THE FIRST NAVIGATION. This app is a single
 * page app: route changes replace it, so a check run on /pricing after the user
 * navigated there from /core would read empty and wrongly report "not a TWA" —
 * failing OPEN, which is the dangerous direction for a policy gate. The answer
 * is latched into sessionStorage on first evaluation and reused for the rest of
 * the session.
 */

const STORAGE_KEY = 'af_twa'
const ANDROID_APP_REFERRER = 'android-app://'

/**
 * The package our own TWA ships as. Checked rather than accepting any
 * `android-app://` referrer, so another app linking into the site is not
 * mistaken for our Play distribution and does not lose its checkout.
 */
const TWA_PACKAGE = 'ai.allfantasy.app'

export function isTrustedWebActivity(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    /*
     * Server render. Returning false is correct rather than merely safe: the
     * server cannot see the referrer of the eventual client navigation, and the
     * gate below runs in the browser at click time, which is the only moment
     * that matters.
     */
    return false
  }

  try {
    const latched = window.sessionStorage.getItem(STORAGE_KEY)
    if (latched === '1') return true
    if (latched === '0') return false
  } catch {
    /* Private mode, or storage blocked. Fall through and evaluate directly. */
  }

  const referrer = document.referrer || ''
  const inTwa =
    referrer.startsWith(`${ANDROID_APP_REFERRER}${TWA_PACKAGE}`) ||
    /*
     * A TWA may report the referrer with a trailing path. Prefix-matching the
     * package covers both, while still refusing a different package.
     */
    referrer.startsWith(`${ANDROID_APP_REFERRER}${TWA_PACKAGE}/`)

  try {
    window.sessionStorage.setItem(STORAGE_KEY, inTwa ? '1' : '0')
  } catch {
    /* Nothing to do — the value is recomputed next call. */
  }

  return inTwa
}
