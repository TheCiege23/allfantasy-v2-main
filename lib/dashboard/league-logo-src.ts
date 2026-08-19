import { sleeperAvatarUrl } from '@/lib/sleeper-avatar'

/**
 * Resolve a league's display logo to a URL safe to hand a plain `<img>`, or null when there is
 * nothing usable to show.
 *
 * Two different fields feed this, with different shapes and different trust levels:
 *
 * - `logoUrl` is free text from the commissioner's League Settings "Logo URL" input
 *   (`components/league-settings/tabs/GeneralTab.tsx`), which PATCHes on every keystroke with no
 *   validation. It can therefore hold a half-typed value (`h`, `https:/`), a bare relative path, or
 *   a host on no allowlist. Anything not already absolute or root-relative is normalized to a
 *   root-relative path so it resolves to a 404 the caller's `onError` can catch, rather than being
 *   passed through as a malformed src.
 * - `avatarUrl` is a Sleeper value. Import paths mostly store a full CDN URL, but a few store a
 *   bare avatar hash (e.g. `app/api/league/transfer/route.ts`), so both shapes must work.
 *
 * Deliberately returns a src for a plain `<img>`, not `next/image`. `next/image` throws — taking
 * the whole card down rather than degrading — on both a malformed src and any hostname absent from
 * `next.config.js`'s 17-entry `remotePatterns` allowlist. A commissioner pointing `logoUrl` at
 * their own CDN is a reasonable thing to do and must not crash the dashboard.
 */
export function resolveLeagueLogoSrc(
  logoUrl: string | null | undefined,
  avatarUrl: string | null | undefined,
): string | null {
  const custom = logoUrl?.trim()
  if (custom) {
    if (/^https?:\/\//i.test(custom) || custom.startsWith('/')) return custom
    return `/${custom.replace(/^\/+/, '')}`
  }

  const avatar = avatarUrl?.trim()
  if (!avatar) return null
  // Already a site-relative path — must not be prefixed onto the Sleeper CDN.
  if (avatar.startsWith('/')) return avatar
  return sleeperAvatarUrl(avatar)
}

/**
 * Up-to-2-letter initials for a league name, used when there is no logo or the logo fails to load.
 * Identifies the specific league, unlike a sport badge which is identical across every league in
 * that sport.
 *
 * Code-point aware on purpose: real league names very often carry emoji (e.g. "Gridiron Goonz 🏈",
 * "La Raza 🇲🇽🏈"), and a naive `charAt(0)` on an emoji token returns a lone UTF-16 surrogate. A lone
 * surrogate cannot be encoded in the UTF-8 SSR HTML stream — it serializes as U+FFFD (�) — while the
 * client re-computes the raw surrogate, so the two never match and React throws a hydration error on
 * every logo-less emoji-named league card. We therefore derive each initial from the first
 * letter/number code point of a word and ignore emoji/symbol-only tokens, so the monogram reads as
 * the league's words (never a broken glyph) and is byte-identical on server and client.
 */
export function leagueInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'

  // First letter/number of a token, iterating by code point (never code unit). Returns null for a
  // token with no alphanumeric character (a pure emoji/symbol like "🏈" or "🇲🇽"), so it is skipped.
  const firstAlnum = (token: string): string | null => {
    for (const ch of token) {
      if (/[\p{L}\p{N}]/u.test(ch)) return ch.toUpperCase()
    }
    return null
  }

  const initials = trimmed
    .split(/\s+/)
    .map(firstAlnum)
    .filter((c): c is string => c !== null)

  // All-emoji / all-symbol name: fall back to the first WHOLE code point (Array.from splits by code
  // point, so this is a complete emoji, never a lone surrogate) rather than an unhelpful "?".
  if (initials.length === 0) return Array.from(trimmed)[0] ?? '?'
  if (initials.length === 1) return initials[0]!
  return `${initials[0]}${initials[initials.length - 1]}`
}
