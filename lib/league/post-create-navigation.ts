/**
 * Canonical “first URL” after a successful league/tournament create.
 * All native leagues with a `League.id` land on `/league/[leagueId]` — specialty behavior
 * is driven by `league.leagueType`, `settings`, and `conceptRules`, not separate app roots.
 *
 * Query flags:
 * - `created=1` — post-create handoff; league page may skip legacy tournament redirect.
 * - `guide=settings` — setup guide affordance.
 * - `openChat=league` — open league chat.
 * - `showInvite=1` — invite panel when applicable.
 * - `playIntro=1` — reserve intro playback intent for league shell follow-up handling.
 *
 * Tournament exception: tournament creates always land on `/tournament/[tournamentId]?created=1&showInvite=1`,
 * bypassing league-shell query flags and feeder `leagueId` routing.
 */

type PostCreateLeagueHomeArgs = {
  /** Canonical `League.id` — required for all routes except missing-id fallback. */
  leagueId?: string
  /** Wizard / format id (e.g. `tournament`, `survivor`, `redraft`). */
  leagueType: string
  /** From `/api/tournament/create` — when set with `leagueType: 'tournament'`, redirect goes to `/tournament/[tournamentId]`. */
  tournamentId?: string | null
  /** Mirrors wizard invite step — adds `showInvite=1`. */
  allowInviteLink?: boolean
  /** Zombie multi-pack hint — surfaced via query for first-run banners only; shell still `/league/...`. */
  zombieUniverseTier?: 'single_gamma' | 'beta_trio' | 'alpha_hex' | null
}

function appendCommonLeagueQuery(q: URLSearchParams, args: PostCreateLeagueHomeArgs): void {
  q.set('created', '1')
  q.set('guide', 'settings')
  q.set('openChat', 'league')
  q.set('playIntro', '1')
  if (args.allowInviteLink) q.set('showInvite', '1')
  const zt = args.zombieUniverseTier
  if (zt === 'beta_trio' || zt === 'alpha_hex') {
    q.set('zombieTier', zt)
  }
}

/**
 * Build post-submit navigation URL.
 * Primary destination: `/league/[leagueId]?...` for every format with a league row.
 * Tournament hubs: pass `tournamentId` so the shell can link hub tools without leaving the league route.
 */
export function buildPostCreateLeagueHomeHref(args: PostCreateLeagueHomeArgs): string {
  const lt = String(args.leagueType ?? '').trim().toLowerCase()
  const tid = typeof args.tournamentId === 'string' ? args.tournamentId.trim() : ''
  const leagueId = typeof args.leagueId === 'string' ? args.leagueId.trim() : ''

  // Tournament post-create always lands on the tournament shell, regardless of feeder leagueId.
  if (lt === 'tournament' && tid) {
    return `/tournament/${encodeURIComponent(tid)}?created=1&showInvite=1`
  }

  if (!leagueId) {
    return '/dashboard'
  }

  const q = new URLSearchParams()
  appendCommonLeagueQuery(q, args)

  return `/league/${encodeURIComponent(leagueId)}?${q.toString()}`
}

/**
 * When true, `/league/[leagueId]` should not auto-redirect to `/tournament/...` so the
 * canonical league shell renders for post-create handoff.
 */
export function isPostCreateLeagueShellHandoff(searchParams: Record<string, string | string[] | undefined>): boolean {
  const raw = searchParams.created
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  return v === '1' || v === 'true'
}
