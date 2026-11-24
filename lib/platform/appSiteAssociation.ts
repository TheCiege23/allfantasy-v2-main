/**
 * The apple-app-site-association document: which links on this site open the iOS app. PURE.
 *
 * Served at /.well-known/apple-app-site-association (next.config rewrite → app/api/ios/
 * app-site-association). Apple fetches it from the host named in the app's
 * `com.apple.developer.associated-domains` entitlement (ios-app/ios/App/App/App.entitlements):
 * `www.allfantasy.ai`, the site's canonical origin, which is the host every emailed link uses.
 * `allfantasy.ai` is redirected to www by Cloudflare, and Apple refuses a redirected association.
 *
 * 🛑 ONLY THE EMAIL-VERIFICATION LINK, ON PURPOSE (2026-09-29). A new user who signs up in the app
 * gets a verify email; tapping it opened Safari, so the account was verified in a browser while the
 * app still showed "verify your email". Claiming more paths would also pull ordinary allfantasy.ai
 * links out of Safari for everyone with the app installed — a separate decision, not a side effect.
 *
 * `webcredentials` (2026-11-24) is a DIFFERENT claim and opens no links: it lets the app use this
 * site's passkeys (Face ID sign-in, lib/auth/passkeys.ts — rpID www.allfantasy.ai), so a passkey
 * made on the website signs in inside the app and the reverse. The app asks for it with
 * `webcredentials:www.allfantasy.ai` in its associated-domains entitlement (ios-testflight.yml,
 * `passkeys` input). Serving it to a build that does not ask is harmless.
 */

const IOS_APP_BUNDLE_ID = 'ai.allfantasy.app'

/** The paths that open the app. `*` matches any suffix, including the query string. */
export const IOS_APP_LINK_PATHS = ['/verify/email*'] as const

/** Apple Team IDs are 10 upper-case letters or digits. */
export function isAppleTeamId(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^[A-Z0-9]{10}$/.test(v.trim())
}

export function appSiteAssociation(teamId: string) {
  const appId = `${teamId.trim()}.${IOS_APP_BUNDLE_ID}`
  return {
    webcredentials: { apps: [appId] },
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: IOS_APP_LINK_PATHS.map((path) => ({
            '/': path,
            comment: 'Email verification links reopen the app that asked for them.',
          })),
        },
      ],
    },
  }
}
