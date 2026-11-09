/**
 * Which canonical NFL `Player` rows are second copies of a player we already hold, and where
 * each one should fold.
 *
 * ⚠ PURE ON PURPOSE: NO PRISMA. The canonical backfill (`backfillCanonical.ts`) and the
 * one-off merge script (`scripts/merge-duplicate-nfl-players.ts`) must agree on which row
 * survives. If they disagreed, a later backfill would rebuild the copy the merge removed, and
 * would point its provider identities back at it (`writeIdentityBatches` re-points on
 * conflict). One rule, in one place, read by both.
 *
 * ── How the copies came about, measured on production 2026-11-09 ──
 *
 * The backfill keys an NFL row by its Sleeper id when it has one, and otherwise by
 * (name, position, team). TheSportsDB rows carry no Sleeper id. They also use their own
 * position labels (`OT`, `G`, `CB`, where Sleeper says `OL`, `DB`) and sometimes a stale team.
 * So the same athlete got a second canonical row. All 13,010 NFL rows come from one run on
 * 2026-07-21:
 *
 *   rows with no Sleeper id                                   1,048
 *     of those, with a birthday                                 528
 *     exactly one Sleeper-backed row with that name + birthday  479
 *     two such rows (ambiguous, left alone)                       2
 *
 * The copies hold real data the Sleeper row lacks: 260 Rolling Insights identities, 36 ESPN
 * identities and 17 images. That is why the ESPN linker dead-ends: it linked Travis Etienne
 * and Kyle Pitts to the copy, which has no Sleeper identity.
 *
 * ── The rule ──
 *
 * A row folds into a twin only when all of these hold:
 *   - it carries no Sleeper id, and the twin does;
 *   - the twin has the same normalized name AND the same birthday, and is the ONLY such row;
 *   - no provider would end up with two different ids on the merged player, whether from the
 *     survivor or from a second copy folding into the same survivor. That happens for 25 rows,
 *     because TheSportsDB itself has two records for the athlete. Those are reported and
 *     skipped, never resolved by picking one.
 *
 * A name alone is never enough (see `matchProviderAthlete`). Two Sleeper-backed rows that share
 * a name and a birthday are NOT handled here either: that is Sleeper's own duplicate (17 such
 * groups, e.g. Chris Campbell 5350/5105), and choosing between Sleeper ids is a separate
 * question.
 */
import { birthDay } from '@/lib/player-identity/matchProviderAthlete'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

export type CanonicalPlayerRow = {
  id: string
  name: string
  birthDate: string | Date | null
  /** `Player.provider_ids`: provider -> that provider's id for this player. */
  providerIds: Record<string, unknown> | null
}

export type ProviderIdentityRow = { playerId: string; provider: string; providerPlayerId: string }

export type DuplicateMerge = { dupId: string; keepId: string }

export type SkippedDuplicate = {
  dupId: string
  reason: 'ambiguous_twin' | 'provider_clash'
  /** For a clash: the providers that would carry two different ids. */
  providers?: string[]
  keepIds: string[]
}

export type DuplicateMergePlan = {
  merges: DuplicateMerge[]
  skipped: SkippedDuplicate[]
  /** Rows with no Sleeper id that could not even be considered: no birthday or no name. */
  noEvidence: number
  /** Rows with no Sleeper id and a birthday, but no Sleeper-backed twin. */
  noTwin: number
}

/**
 * Name + birthday, or null when either is missing. Shared with the backfill's guard.
 *
 * A trailing generational suffix is dropped: TheSportsDB writes "Aaron Jones Sr." where Sleeper
 * writes "Aaron Jones", and `normalizePlayerName` keeps the suffix. That is safe only because the
 * birthday must match too. A father and son who share a name do not share a birthday.
 */
export function twinKey(name: string | null | undefined, birth: string | Date | null | undefined): string | null {
  const n = normalizePlayerName(name).replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '').trim()
  const d = birthDay(birth ?? null)
  return n && d ? `${n}|${d}` : null
}

export function hasSleeperId(providerIds: Record<string, unknown> | null | undefined): boolean {
  const v = providerIds?.sleeper
  return v != null && String(v).trim() !== ''
}

export function planDuplicatePlayerMerges(
  players: readonly CanonicalPlayerRow[],
  identities: readonly ProviderIdentityRow[],
): DuplicateMergePlan {
  const plan: DuplicateMergePlan = { merges: [], skipped: [], noEvidence: 0, noTwin: 0 }

  const keepersByKey = new Map<string, string[]>()
  for (const p of players) {
    if (!hasSleeperId(p.providerIds)) continue
    const key = twinKey(p.name, p.birthDate)
    if (!key) continue
    const list = keepersByKey.get(key)
    if (list) list.push(p.id)
    else keepersByKey.set(key, [p.id])
  }

  const idsByPlayer = new Map<string, Map<string, Set<string>>>()
  for (const i of identities) {
    let byProvider = idsByPlayer.get(i.playerId)
    if (!byProvider) idsByPlayer.set(i.playerId, (byProvider = new Map()))
    let ids = byProvider.get(i.provider)
    if (!ids) byProvider.set(i.provider, (ids = new Set()))
    ids.add(i.providerPlayerId)
  }

  for (const p of players) {
    if (hasSleeperId(p.providerIds)) continue
    const key = twinKey(p.name, p.birthDate)
    if (!key) {
      plan.noEvidence++
      continue
    }
    const keepIds = keepersByKey.get(key) ?? []
    if (keepIds.length === 0) {
      plan.noTwin++
      continue
    }
    if (keepIds.length > 1) {
      plan.skipped.push({ dupId: p.id, reason: 'ambiguous_twin', keepIds })
      continue
    }
    const keepId = keepIds[0]!

    const dupIds = idsByPlayer.get(p.id) ?? new Map<string, Set<string>>()
    const keepIdsByProvider = idsByPlayer.get(keepId) ?? new Map<string, Set<string>>()
    const clashes: string[] = []
    for (const [provider, ids] of dupIds) {
      const theirs = keepIdsByProvider.get(provider)
      if (!theirs) continue
      if ([...ids].some((id) => !theirs.has(id))) clashes.push(provider)
    }
    if (clashes.length) {
      plan.skipped.push({ dupId: p.id, reason: 'provider_clash', providers: clashes.sort(), keepIds: [keepId] })
      continue
    }
    plan.merges.push({ dupId: p.id, keepId })
  }

  /* Two copies folding into ONE survivor must not contradict each other either, or the merge
     would give the survivor two ids from one provider by the back door. */
  const byKeep = new Map<string, DuplicateMerge[]>()
  for (const m of plan.merges) {
    const list = byKeep.get(m.keepId)
    if (list) list.push(m)
    else byKeep.set(m.keepId, [m])
  }
  const refused = new Set<string>()
  for (const [keepId, group] of byKeep) {
    if (group.length < 2) continue
    const seen = new Map<string, Set<string>>()
    for (const m of group) {
      for (const [provider, ids] of idsByPlayer.get(m.dupId) ?? []) {
        const all = seen.get(provider) ?? new Set<string>()
        ids.forEach((id) => all.add(id))
        seen.set(provider, all)
      }
    }
    const clashing = [...seen].filter(([, ids]) => ids.size > 1).map(([provider]) => provider).sort()
    if (!clashing.length) continue
    for (const m of group) {
      refused.add(m.dupId)
      plan.skipped.push({ dupId: m.dupId, reason: 'provider_clash', providers: clashing, keepIds: [keepId] })
    }
  }
  if (refused.size) plan.merges = plan.merges.filter((m) => !refused.has(m.dupId))
  return plan
}

/**
 * The backfill's side of the same rule. Pure.
 *
 * `unkeyed` are canonical groups built from NFL source rows with no Sleeper id, each with the
 * twin keys of its rows and the providers it would write identities for. `keyed` are the
 * Sleeper-backed players a group could fold into, from this run and from the database, with
 * the provider ids each already holds. A group folds only into the ONE candidate sharing its
 * key, and only when no provider would end up with two ids. These are the same refusals
 * `planDuplicatePlayerMerges` applies, so a re-run lands where the merge left things.
 */
export function foldTargetsForUnkeyedGroups(
  unkeyed: ReadonlyArray<{ groupId: string; keys: ReadonlyArray<string | null>; providerIds: ReadonlyArray<[provider: string, id: string]> }>,
  keyed: ReadonlyArray<{ id: string; key: string | null; providerIds: ReadonlyArray<[provider: string, id: string]> }>,
): Map<string, string> {
  const candidatesByKey = new Map<string, Set<string>>()
  const idsByCandidate = new Map<string, Map<string, Set<string>>>()
  for (const k of keyed) {
    if (k.key) {
      const set = candidatesByKey.get(k.key) ?? new Set<string>()
      set.add(k.id)
      candidatesByKey.set(k.key, set)
    }
    const byProvider = idsByCandidate.get(k.id) ?? new Map<string, Set<string>>()
    for (const [provider, id] of k.providerIds) {
      const ids = byProvider.get(provider) ?? new Set<string>()
      ids.add(id)
      byProvider.set(provider, ids)
    }
    idsByCandidate.set(k.id, byProvider)
  }

  const out = new Map<string, string>()
  for (const g of unkeyed) {
    const keys = new Set(g.keys.filter((k): k is string => Boolean(k)))
    if (keys.size !== 1) continue // no birthday, or rows that disagree about who this is
    const candidates = candidatesByKey.get([...keys][0]!)
    if (!candidates || candidates.size !== 1) continue
    const target = [...candidates][0]!
    const theirs = idsByCandidate.get(target)
    const clash = g.providerIds.some(([provider, id]) => {
      const ids = theirs?.get(provider)
      return Boolean(ids && !ids.has(id))
    })
    if (clash) continue
    out.set(g.groupId, target)
  }
  return out
}

/**
 * The survivor's `provider_ids` after a merge: the copy's entries are added, and the
 * survivor's own value wins wherever both name a provider.
 */
export function mergedProviderIds(
  keep: Record<string, unknown> | null | undefined,
  dup: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...(dup ?? {}), ...(keep ?? {}) }
}
