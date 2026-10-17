/**
 * The first thing a commissioner sees after creating a league, as ONE sequence with one owner:
 *
 *   1. intro   — exactly one intro video: the format's own first-entry intro where one exists
 *                (Survivor, Big Brother, Guillotine, C2C, Devy, IDP — video plus quick tips),
 *                otherwise the concept intro.
 *   2. ready   — the "your league is ready" sheet: league info, invite link + QR + share, next steps.
 *   3. done
 *
 * 🛑 WHY THIS EXISTS. Before it, five independent overlays each decided for themselves: the
 * settings modal opened on the Invite panel first, the concept intro waited behind it, and the
 * specialty formats ALSO mounted their own first-entry intro on top — so a new Survivor league
 * played two intro videos with the invite stacked in between. Each had its own z-index and its own
 * "seen" storage. And the post-create query flags were never cleared, so every refresh replayed
 * the invite.
 */

/** Flags `buildPostCreateLeagueHomeHref` adds. Cleared once the league page has read them. */
export const POST_CREATE_HANDOFF_KEYS = ['created', 'showInvite', 'playIntro', 'guide', 'openChat'] as const

function truthy(value: string | null): boolean {
  return value === '1' || value === 'true'
}

/**
 * The query string with the post-create handoff flags removed, or `null` when there is nothing to
 * remove. Only a real handoff (`created=1`) is stripped: `?openChat=league` on its own is a normal
 * deep link other pages use and must survive.
 */
export function stripPostCreateHandoff(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (!truthy(params.get('created'))) return null
  for (const key of POST_CREATE_HANDOFF_KEYS) params.delete(key)
  return params.toString()
}

export function shouldStartPostCreateWelcome(input: {
  createdFromLeagueCreate: boolean
  isCommissioner: boolean
  defaultShowInvite: boolean
  shouldPlayIntro: boolean
  embedMode: boolean
}): boolean {
  return (
    input.createdFromLeagueCreate &&
    input.isCommissioner &&
    !input.embedMode &&
    (input.defaultShowInvite || input.shouldPlayIntro)
  )
}

export type FirstEntryIntroKind = 'survivor' | 'big_brother' | 'guillotine' | 'c2c' | 'devy' | 'idp'

/**
 * The format intros a league mounts, highest priority first — the same conditions `LeagueShell`
 * uses to mount each first-entry modal. More than one can apply (a Guillotine IDP league).
 */
export function firstEntryIntroKinds(league: {
  leagueVariant?: string | null
  leagueType?: string | null
  guillotineMode?: boolean | null
}): FirstEntryIntroKind[] {
  const variant = String(league.leagueVariant ?? '')
  const kinds: FirstEntryIntroKind[] = []
  if (variant === 'survivor') kinds.push('survivor')
  if (variant === 'big_brother') kinds.push('big_brother')
  if (league.guillotineMode) kinds.push('guillotine')
  if (variant === 'merged_devy_c2c') kinds.push('c2c')
  if (league.leagueType === 'devy' || variant === 'devy_dynasty') kinds.push('devy')
  if (variant === 'idp' || variant === 'dynasty_idp') kinds.push('idp')
  return kinds
}

const SEEN_PREFIX: Record<FirstEntryIntroKind, string> = {
  survivor: 'survivor_intro_seen_',
  big_brother: 'bb_intro_seen_',
  guillotine: 'guillotine_intro_seen_',
  c2c: 'c2c_intro_seen_',
  devy: 'devy_intro_seen_',
  idp: 'idp_intro_seen_',
}

/**
 * The localStorage key each first-entry modal uses to remember it was seen. The modals read their
 * key from here, so the welcome flow and the modals cannot drift apart. Guillotine's key has never
 * included the user, and changing it would replay the intro for everyone who has seen it.
 */
export function firstEntryIntroStorageKey(kind: FirstEntryIntroKind, leagueId: string, userId: string): string {
  return kind === 'guillotine' ? `${SEEN_PREFIX[kind]}${leagueId}` : `${SEEN_PREFIX[kind]}${leagueId}_${userId}`
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function isFirstEntryIntroSeen(kind: FirstEntryIntroKind, leagueId: string, userId: string): boolean {
  try {
    return Boolean(storage()?.getItem(firstEntryIntroStorageKey(kind, leagueId, userId)))
  } catch {
    return false
  }
}

/** Marks every format intro this league mounts as seen, so none pops up after the welcome sheet. */
export function markFirstEntryIntrosSeen(kinds: readonly FirstEntryIntroKind[], leagueId: string, userId: string): void {
  const store = storage()
  if (!store) return
  for (const kind of kinds) {
    try {
      store.setItem(firstEntryIntroStorageKey(kind, leagueId, userId), '1')
    } catch {
      /* private mode or a full store: the worst case is one extra intro later */
    }
  }
}

/**
 * Who plays the single intro: the highest-priority format intro not already seen, else the concept
 * intro. `null` kind means the concept intro.
 */
export function chooseWelcomeIntro(kinds: readonly FirstEntryIntroKind[], leagueId: string, userId: string): FirstEntryIntroKind | null {
  return kinds.find((kind) => !isFirstEntryIntroSeen(kind, leagueId, userId)) ?? null
}
