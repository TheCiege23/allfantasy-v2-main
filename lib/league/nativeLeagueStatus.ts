/**
 * `League.status` for a league that plays on AllFantasy, kept in step with its lifecycle.
 *
 * 🛑 IT READ `setup` FOR THE LEAGUE'S WHOLE LIFE. Creation writes `status: 'setup'` and nothing
 * moved it afterwards: `status` is the provider's word for an imported league, and our own state
 * machine writes `lifecycleState` only. But a dozen readers ask `league.status ?? league.lifecycleState`,
 * and a string that is never null always wins, so a native league in week 9 still read as
 * pre-draft to them: My Team's `preDraft` flag, automatic lineup subs (`nativeAutoSubs.ts`, which
 * needs `active` / `in_season`), the commissioner hub, the lineup-lock snapshots. Found on the redraft
 * and dynasty walkthroughs (2026-11-18).
 *
 * So every native lifecycle write also writes `status`, in the vocabulary those readers already
 * know (the provider spellings: `pre_draft`, `drafting`, `in_season`, `complete`).
 *
 *   setup            → setup
 *   pre_draft        → pre_draft
 *   drafting         → drafting
 *   post_draft       → in_season   (a native league's season is activated when its draft finishes)
 *   in_season        → in_season
 *   playoffs         → in_season   (still being played; the readers have no playoff spelling)
 *   completed        → complete
 *   offseason        → complete
 *   renewal_pending  → complete
 *   archived         → unchanged   (archiving never touches `status`, lib/core-app/archivedLeagues.ts)
 *
 * ⚠ NATIVE LEAGUES ONLY. An imported league's `status` is what its provider last said and its sync
 * owns it; the patch is empty for one.
 *
 * Pure.
 */
import { isNativePlatform } from '@/lib/dashboard/platform-label'

const STATUS_BY_LIFECYCLE: Record<string, string> = {
  setup: 'setup',
  pre_draft: 'pre_draft',
  drafting: 'drafting',
  post_draft: 'in_season',
  in_season: 'in_season',
  playoffs: 'in_season',
  completed: 'complete',
  offseason: 'complete',
  renewal_pending: 'complete',
}

/** The status a native league in this lifecycle state carries, or null when the state says nothing. */
export function nativeLeagueStatusForLifecycle(state: string | null | undefined): string | null {
  return STATUS_BY_LIFECYCLE[String(state ?? '').trim().toLowerCase()] ?? null
}

/**
 * The `status` to write beside a `lifecycleState` write: `{ status }` for a native league, `{}` for an
 * imported one or a state with no status. Spread it into the update's `data`.
 */
export function nativeLeagueStatusPatch(
  platform: string | null | undefined,
  nextLifecycleState: string | null | undefined,
): { status?: string } {
  if (!isNativePlatform(platform)) return {}
  const status = nativeLeagueStatusForLifecycle(nextLifecycleState)
  return status ? { status } : {}
}
