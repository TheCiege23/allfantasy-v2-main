/**
 * Who the injured-starter sweep evaluates, what it links to, and the key that
 * stops it repeating itself — pure, so the cron route stays a thin shell.
 *
 * ⚠ WHY THE AUDIENCE CHANGED (2026-09-06). The sweep evaluated only users with
 * a web-push subscription, on the argument that evaluating the unreachable is
 * pure cost. Measured on production: ZERO push subscriptions, ever; 22 users
 * with a claimed 2026 team, all 22 with an email on file; ZERO injured-starter
 * notifications ever created, across 592 successful sweeps in the last seven
 * days. The sweep was healthy and reached nobody. Email is the channel that
 * exists, so the audience is now everyone with a claimed team in the current
 * season — the dispatcher still gates each of them on category preference,
 * contact availability and quiet hours.
 *
 * ⚠ WHY THE DEDUPE KEY EXISTS. The sweep runs every five minutes and calls the
 * detector directly, not through the alert engine, so the engine's repeat
 * cooldown never applies here; and the dispatcher's email path sends whenever
 * it is called — it never checks the in-app row's sourceKey. Widening the
 * audience without a pre-dispatch check would have emailed 22 people every
 * five minutes for as long as a starter stayed flagged. One message per
 * player, per designation, per day: a fresh downgrade (Questionable → Out)
 * is news and goes out; the same fact again does not.
 */

export type SweepTopAlert = {
  title: string
  leagueId?: string | null
  metadata?: Record<string, unknown>
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The player the alert is about — from the detector's metadata, else parsed from the title it writes. */
export function alertPlayerName(top: SweepTopAlert): string | null {
  const m = top.metadata?.playerName
  if (typeof m === 'string' && m.trim()) return m.trim()
  const fromTitle = top.title.split(' is ')[0]?.trim()
  return fromTitle && fromTitle !== top.title ? fromTitle : null
}

/** `injured-starter:<player>:<designation>:<yyyy-mm-dd>` — the sourceKey prefix; the dispatcher appends `:<userId>`. */
export function injuredStarterDedupeKey(top: SweepTopAlert, now: Date): string {
  const name = alertPlayerName(top)
  const designation = typeof top.metadata?.designation === 'string' ? (top.metadata.designation as string) : 'flagged'
  const day = now.toISOString().slice(0, 10)
  return `injured-starter:${name ? slug(name) : (top.leagueId ?? 'all')}:${slug(designation)}:${day}`
}

/**
 * Where a tap lands: the Player Finder card for that player, which leads with
 * the game-day banner and the verified Open-lineup buttons for every league he
 * starts in — one tap from the notification to the platform's lineup screen.
 */
export function injuredStarterHref(top: SweepTopAlert): string {
  const name = alertPlayerName(top)
  if (name) return `/core/players?q=${encodeURIComponent(name)}`
  return top.leagueId ? `/league/${top.leagueId}` : '/my-players'
}

/** Push-capable users first (they get both channels), then everyone else with a team; unique; capped. */
export function mergeAudience(subscribed: string[], claimed: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...subscribed, ...claimed]) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= limit) break
  }
  return out
}
