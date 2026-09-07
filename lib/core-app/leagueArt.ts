/**
 * A league's artwork, as a URL that will actually load.
 *
 * ⚠ `avatarUrl` IS NOT ALWAYS A URL, AND THAT IS THE WHOLE REASON THIS EXISTS.
 * Sleeper stores an avatar *id* in the same column other providers put a link
 * in, so passing the raw value into an `<img src>` renders a broken image on
 * every Sleeper league — roughly half the leagues on a real account. Three
 * modules had each grown their own private copy of this expansion
 * (`imageOf` in dash34.ts, `asImageUrl` in myTeamPulse.ts, and the inline one in
 * matchupPulse.ts) and a fourth call path — `getDraftHqAll` — had none at all
 * and was handed the raw column by both of its call sites.
 *
 * ⚠ AND `logoUrl` BEATS `avatarUrl` WHEN BOTH EXIST. `logoUrl` is a commissioner
 * upload and always a real URL; `avatarUrl` is whatever the platform published.
 * Measured on production: `logoUrl` is null on all 115 leagues and has never
 * been written, while `avatarUrl` is populated on 48 — so the order matters far
 * less than it looks, but a commissioner who does upload one should see it.
 *
 * ⚠ NULL IS A REAL ANSWER, NOT A FAILURE. 67 of those 115 leagues have no
 * avatar on the platform either; the surfaces render a tinted monogram for
 * them, which is the correct rendering of "there is no artwork" rather than a
 * placeholder waiting to be filled.
 *
 * Client-safe: no prisma, no 'server-only'. Both loaders and components use it.
 */

/** Sleeper's thumbnail CDN. The full-size path is `/avatars/<id>`; thumbs are enough at 22–36px. */
const SLEEPER_AVATAR_CDN = 'https://sleepercdn.com/avatars/thumbs/'

export function leagueArtUrl(input: {
  logoUrl?: string | null
  avatarUrl?: string | null
  platform?: string | null
}): string | null {
  const logo = input.logoUrl?.trim()
  if (logo && /^https?:\/\//i.test(logo)) return logo

  const avatar = input.avatarUrl?.trim()
  if (!avatar) return null
  if (/^https?:\/\//i.test(avatar)) return avatar

  /*
   * A bare id is only meaningful against a platform that issues them. For
   * anybody else it is a value we cannot interpret, and guessing a CDN for it
   * would produce a 404 rather than a monogram.
   */
  if (String(input.platform ?? '').toLowerCase() === 'sleeper') {
    return `${SLEEPER_AVATAR_CDN}${encodeURIComponent(avatar)}`
  }
  return null
}

/**
 * A manager's avatar on the platform, same rules.
 *
 * Sleeper's user avatars live under the same CDN as its league avatars — the id
 * space is shared — so one expansion covers both.
 */
export function managerArtUrl(input: {
  avatarUrl?: string | null
  platform?: string | null
}): string | null {
  return leagueArtUrl({ avatarUrl: input.avatarUrl, platform: input.platform })
}
