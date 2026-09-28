/**
 * A league's Discord invite link — what a member taps to get into the league's server.
 *
 * Pure and client-safe on purpose: the setup screen checks a pasted link with THIS function before
 * sending it, and `PATCH /api/discord/league` checks it again with the same one. The server is the
 * authority; the screen only saves a round trip.
 *
 * ⚠ ONLY TWO SHAPES ARE ACCEPTED, AND THE STORED VALUE IS REBUILT, NOT ECHOED.
 * `https://discord.gg/<code>` and `https://discord.com/invite/<code>`. The URL is parsed, the host is
 * compared exactly (so `discord.gg.evil.example` and `discord.gg@evil.example` fail), and what gets
 * stored is rebuilt from the host and the code alone — no query, no fragment, nothing from the pasted
 * text survives except a code that matched `[A-Za-z0-9-]`. Every member of the league is sent to
 * this link, so it is treated as the untrusted input it is.
 *
 * ⚠ READS RE-CHECK TOO. `storedDiscordInvite` runs the same validation over whatever sits in
 * `League.settings`, so a value written by anything else (an import, a hand edit) is never handed to
 * a member unless it is a real invite.
 */

/** The `League.settings` key the invite lives under. No schema change: `settings` is JSON. */
export const DISCORD_INVITE_SETTINGS_KEY = 'discordInviteUrl'

/** Longer than any real invite; stops a pasted essay from being parsed at all. */
export const DISCORD_INVITE_MAX_LENGTH = 200

/** What a commissioner is told when a pasted link is refused — on the screen and from the route. */
export const INVALID_DISCORD_INVITE_MESSAGE =
  'That isn’t a Discord invite link. Copy it from Discord — it starts with https://discord.gg/ or https://discord.com/invite/.'

/** Invite codes and vanity URLs: letters, digits and hyphens. */
const CODE = '([A-Za-z0-9-]{2,32})'
const GG_PATH = new RegExp(`^/${CODE}/?$`)
const COM_PATH = new RegExp(`^/invite/${CODE}/?$`)

/**
 * The link as TYPED: scheme, then the host immediately followed by the path. Checked on the raw text
 * because `new URL` resolves `/abc/../../x` to `/x` and decodes nothing it is not asked to — a
 * pasted link has to be an invite as written, not become one after normalisation. Anything between
 * the host and the path (`@`, `:port`, `\`) fails here.
 */
const AS_TYPED = /^https:\/\/(discord\.gg|discord\.com)(\/[^?#]*)(?:[?#].*)?$/i

/** The canonical invite for a pasted link, or null when it is not a Discord invite. */
export function normalizeDiscordInviteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > DISCORD_INVITE_MAX_LENGTH) return null

  const typed = AS_TYPED.exec(text)
  if (!typed) return null
  const [, typedHost, typedPath] = typed

  // And as a browser would read it: the same host, with nothing smuggled in front of it.
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (url.hostname !== typedHost.toLowerCase()) return null

  if (url.hostname === 'discord.gg') {
    const code = GG_PATH.exec(typedPath)?.[1]
    return code ? `https://discord.gg/${code}` : null
  }
  if (url.hostname === 'discord.com') {
    const code = COM_PATH.exec(typedPath)?.[1]
    return code ? `https://discord.com/invite/${code}` : null
  }
  return null
}

/** The invite stored on a league's settings, re-validated — null when absent or not an invite. */
export function storedDiscordInvite(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return normalizeDiscordInviteUrl((settings as Record<string, unknown>)[DISCORD_INVITE_SETTINGS_KEY])
}
