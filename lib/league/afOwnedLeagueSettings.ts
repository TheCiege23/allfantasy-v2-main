/**
 * The `League.settings` keys that belong to AllFantasy, not to the league's
 * platform — and the one function every provider-driven settings write must go
 * through so a re-import or refresh does not erase them.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * `League.settings` holds two kinds of thing in one JSON blob: the platform's
 * league rules (scoring, rosters, playoffs, trade deadline …), and state that
 * AllFantasy itself wrote — a commissioner's "publish standings" choice, the dues
 * tracker and its payment link, the invite code, a human-confirmed league type.
 *
 * Every provider-driven write replaced the blob wholesale with the fresh payload:
 * `ImportedLeagueCommitService` on a forced re-import, `syncLeague`, the Sleeper
 * refresh route, the `/api/import-sleeper` upserts. Each silently erased the
 * second kind. A league a commissioner had published went private again, with no
 * error and no audit row, the next time anyone re-imported it.
 *
 * ── Why an allowlist, not `{ ...current, ...fresh }` ────────────────────────
 *
 * A blanket merge would also keep every PROVIDER key the provider has since
 * removed — a deleted rule, a renamed setting — and the league would carry a rule
 * its platform no longer has. So only the keys below are carried forward, and
 * everything else is exactly what the platform sent.
 *
 * ── What belongs on this list ───────────────────────────────────────────────
 *
 * A key belongs here when BOTH are true:
 *
 *   1. AllFantasy code writes it (a route, a service, a commissioner control).
 *   2. It is AllFantasy product state, not a copy of a league rule. A key that
 *      mirrors a platform rule (`playoffSettings`, `sportConfig`, `lineupLockRule`,
 *      `division_config`, `scheduleSettings`, `conceptRules`, the per-sport
 *      `*_config` blobs) is deliberately NOT here: preserving an AllFantasy copy
 *      would shadow the fresh platform value for every reader that prefers it.
 *
 * No importer writes any of these names — `__tests__/league/af-owned-settings-survive-reimport.test.ts`
 * builds a real import payload and asserts there is no overlap, so a platform
 * mapper that starts emitting one of them fails loudly instead of being overridden.
 *
 * Census 2026-09-16 (writers: `settings: { ...current, key }` updates and
 * `settingsMerge` callers; readers: `(settings as Record<string, unknown>).key`).
 * When you add a new AllFantasy-owned key to `League.settings`, add it here in the
 * same change — otherwise the next re-import deletes it.
 */

export const AF_OWNED_LEAGUE_SETTINGS_KEYS = [
  // ── Visibility and access (commissioner choices) ──────────────────────────
  'publicStandings', // PublishStandingsToggle → PATCH /api/league/settings
  'publicDashboard', // /api/commissioner/leagues/[id]/operations
  'rankedVisibility', // ditto
  'orphanSeeking', // ditto
  'orphanDifficulty', // ditto
  'orphan_adoption_requests', // lib/orphan-marketplace/settings.ts
  'leagueListingVisibility', // LeagueSettingsPanel settingsMerge
  'leagueDescription', // LeagueSettingsPanel settingsMerge (AF-authored text)
  'inviteCode', // /api/commissioner/leagues/[id]/invite, /api/leagues/join
  'inviteLink', // ditto
  'inviteExpiresAt', // ditto

  // ── Money ─────────────────────────────────────────────────────────────────
  'dues_tracker', // /api/commissioner/leagues/[id]/dues — amount, payment link, paid flags

  // ── What a human told us about the league ─────────────────────────────────
  'leagueTypeConfirmation', // lib/career/leagueTypeConfirmation.ts — the only verified league type
  'concept_rules_overlay', // ConceptRulesTab settingsMerge — an AF overlay ON TOP of platform rules
  'devy_league_config', // execute-league-settings-patch — devy has no platform counterpart
  'c2cImport', // lib/league-import/c2cMultiSourceCommit.ts — links the college + pro sources
  'c2cTaxiLockMode', // /api/c2c/settings

  // ── Notifications, feed and automation preferences ────────────────────────
  'leagueNotificationPrefs', // NotificationsSettingsPanel settingsMerge
  'leagueFeed', // lib/league-feed/leagueFeedSettings.ts
  'commissionerRecipes', // Commissioner Hub automation switches (PR #954)
  'idpChimmyPrefs', // lib/idp/ai/idpChimmy.ts
  'chimmySpeaksUp', // lib/league-chat/chimmyIdentity.ts — "Chimmy speaks up in league chat" (Commissioner Hub)

  // ── AllFantasy commissioner tools and their state ─────────────────────────
  'commissioner_ratings', // /api/leagues/[id]/commissioner-rating
  'last_rating_prompt_season', // lib/commissioner/CommissionerRatingTrigger.ts
  'commissionerLastResetAt', // /api/commissioner/leagues/[id]/reset
  'commissionerLastResetBy', // ditto
  'commissionerLastResetMode', // ditto
  'rookie_devy_lock', // lib/league/rookieDevyLock.ts
  'rookie_draft_order', // lib/league/rookieDraftOrder.ts
  'draft_order_mode', // lib/draft-lottery/lotteryConfigStorage.ts
  'draft_lottery_config', // ditto
  'draft_lottery_last_seed', // ditto
  'draft_lottery_last_run_at', // ditto
  'draft_lottery_last_result', // ditto
  'dispersalDraftLastCompletion', // lib/dispersal-draft/DispersalDraftEngine.ts
  'audit', // lib/league-settings-engine/UnifiedLeagueSettingsService.ts change log

  // ── Import bookkeeping AllFantasy stamps AFTER the payload is written ─────
  'historicalBackfillStatus', // ImportedLeagueCommitService, backfill sweeper, retry route
  'historicalBackfillStartedAt', // ditto
  'historicalBackfillError', // ditto
  'historicalBackfillSweptAt', // /api/cron/import-backfill-sweeper
] as const

export type AfOwnedLeagueSettingsKey = (typeof AF_OWNED_LEAGUE_SETTINGS_KEYS)[number]

/**
 * AllFantasy-owned values that live INSIDE a platform-owned object.
 *
 * `conceptRules` comes from the import's canonical bundle, so the object itself is
 * replaced on re-import — but the Commissioner OS template pin sits at
 * `conceptRules.extensions.commissionerTemplate` (lib/commissioner-os/profile/templatePin.ts),
 * and it is how the EFL format hub finds a league. Carried as a path, so the rest of
 * `conceptRules` is still exactly what the platform sent.
 */
export const AF_OWNED_LEAGUE_SETTINGS_PATHS: ReadonlyArray<readonly string[]> = [
  ['conceptRules', 'extensions', 'commissionerTemplate'],
  // The pre-`extensions` spelling the reader still accepts as a fallback.
  ['conceptRules', 'commissionerTemplate'],
]

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = root
  for (const segment of path) {
    const rec = asRecord(node)
    if (!rec || !Object.prototype.hasOwnProperty.call(rec, segment)) return undefined
    node = rec[segment]
  }
  return node
}

/** Writes `value` at `path`, copying every object on the way so `target`'s originals are never mutated. */
function writePath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i]
    const child = asRecord(node[segment])
    const copy = child ? { ...child } : {}
    node[segment] = copy
    node = copy
  }
  node[path[path.length - 1]] = value
}

/**
 * The settings blob to write: the platform's fresh `settings`, with every
 * AllFantasy-owned value from the row's current settings carried forward.
 *
 * - Only listed keys and paths move; nothing else from `current` survives.
 * - The AllFantasy value wins over a same-named fresh value — the key is ours by
 *   definition, and the overlap test keeps that case from arising unnoticed.
 * - `current` that is missing or not an object leaves `fresh` untouched.
 * - Never mutates either argument.
 */
export function carryAfOwnedLeagueSettings(
  current: unknown,
  fresh: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(fresh ?? {}) }
  const cur = asRecord(current)
  if (!cur) return out

  for (const key of AF_OWNED_LEAGUE_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(cur, key) && cur[key] !== undefined) {
      out[key] = cur[key]
    }
  }

  for (const path of AF_OWNED_LEAGUE_SETTINGS_PATHS) {
    const value = readPath(cur, path)
    if (value !== undefined) writePath(out, path, value)
  }

  return out
}
