/**
 * Reviewed ESPN → Sleeper links the automatic linker cannot make, and should not be loosened to make.
 *
 * ⚠ WHY A LIST, NOT A LOOSER MATCHER. `linkEspnIdentitiesToCanonical` links an ESPN athlete to a
 * canonical player on a name corroborated by a birthday, and REFUSES when the birthday contradicts.
 * That refusal is right in general — `Player(NFL)` holds real twins who share a birthday, position
 * and surname (the Pounceys, the McCourtys, Gabriel and Grayson Murphy), so no name-plus-something
 * rule is safe to automate. It is wrong for a handful of players where one provider has simply
 * typed a date wrong, or where one man is stored under his nickname and his legal name. Those are
 * settled here, one reviewed line at a time, owner's call 2026-11-17.
 *
 * Measured that day: 258 of 262 distinct players on ESPN NFL rosters translated. These are the
 * other four. Each entry was checked against BOTH providers' own records — same name (or a
 * documented nickname), same position, same club — and carries the reason the linker refused it.
 * An entry is evidence, not a default: do not add one without the same check.
 *
 * Applied after the scheduled linker (`ingestEspnAthleteIdentities`, cron `import-players`). It
 * only ever FILLS an empty id and refuses every disagreement, so a later correction upstream, or a
 * conflicting link made some other way, is reported rather than overwritten.
 */

import { prisma } from '@/lib/prisma'

export type EspnIdentityOverride = {
  espnId: string
  sleeperId: string
  name: string
  position: string
  team: string
  /** Why the automatic linker refused it. Required — an override without one is a guess. */
  reason: string
  /**
   * Only when NO identity-map row holds `sleeperId`: the one existing row to complete instead,
   * matched exactly and only if it holds neither id yet.
   */
  adoptRow?: { normalizedName: string; position: string }
}

export const ESPN_IDENTITY_OVERRIDES: readonly EspnIdentityOverride[] = [
  {
    espnId: '4870653', sleeperId: '13298', name: 'KC Concepcion', position: 'WR', team: 'CLE',
    reason: 'birthday 2004-09-24 on ESPN, 2004-09-23 from Sleeper; on 7 of 10 ESPN leagues',
  },
  {
    espnId: '4869461', sleeperId: '13545', name: 'Trey Smack', position: 'K', team: 'GB',
    reason: 'birthday 2003-07-12 on ESPN, 2003-06-12 from Sleeper',
  },
  {
    espnId: '4870847', sleeperId: '13293', name: "Ja'Kobi Lane", position: 'WR', team: 'BAL',
    reason: 'birthday 2004-08-05 on ESPN, 2004-05-05 from Sleeper',
  },
  {
    espnId: '4427728', sleeperId: '8122', name: 'Zonovan "Bam" Knight', position: 'RB', team: 'ARI',
    reason:
      'one man stored twice: ESPN, Rolling Insights and TheSportsDB under "Bam Knight", Sleeper under ' +
      '"Zonovan Knight" — same birthday 2001-04-11, position and club. No identity-map row holds 8122.',
    adoptRow: { normalizedName: 'bam knight', position: 'RB' },
  },
]

/** The identity-map facts the planner decides from. */
export type IdentityRow = { id: string; sleeperId: string | null; espnId: string | null }

export type OverrideAction =
  | { kind: 'already'; override: EspnIdentityOverride }
  | { kind: 'set-espn'; override: EspnIdentityOverride; rowId: string }
  | { kind: 'adopt'; override: EspnIdentityOverride; rowId: string }
  | { kind: 'refused'; override: EspnIdentityOverride; why: string }

/**
 * Decide what each override may do, from what the identity map holds now. Pure, so every refusal
 * is testable without a database.
 *
 * Refuses — never overwrites — whenever the map disagrees: the ESPN id already sits on another
 * player's row, the Sleeper row already names a different ESPN id, or the row to adopt is not
 * exactly one empty row.
 */
export function planEspnIdentityOverrides(
  overrides: readonly EspnIdentityOverride[],
  facts: {
    bySleeperId: ReadonlyMap<string, IdentityRow[]>
    byEspnId: ReadonlyMap<string, IdentityRow[]>
    adoptCandidates: ReadonlyMap<string, IdentityRow[]>
  },
): OverrideAction[] {
  return overrides.map((override): OverrideAction => {
    const holdingEspn = facts.byEspnId.get(override.espnId) ?? []
    if (holdingEspn.length > 0) {
      return holdingEspn.length === 1 && holdingEspn[0].sleeperId === override.sleeperId
        ? { kind: 'already', override }
        : { kind: 'refused', override, why: `ESPN ${override.espnId} is already on another identity row` }
    }

    const holdingSleeper = facts.bySleeperId.get(override.sleeperId) ?? []
    if (holdingSleeper.length === 1) {
      const row = holdingSleeper[0]
      return row.espnId == null
        ? { kind: 'set-espn', override, rowId: row.id }
        : { kind: 'refused', override, why: `the Sleeper ${override.sleeperId} row already names ESPN ${row.espnId}` }
    }
    if (holdingSleeper.length > 1) {
      return { kind: 'refused', override, why: `${holdingSleeper.length} rows hold Sleeper ${override.sleeperId}` }
    }

    if (!override.adoptRow) {
      return { kind: 'refused', override, why: `no identity row holds Sleeper ${override.sleeperId}` }
    }
    const candidates = (facts.adoptCandidates.get(override.espnId) ?? []).filter(
      (row) => row.sleeperId == null && row.espnId == null,
    )
    return candidates.length === 1
      ? { kind: 'adopt', override, rowId: candidates[0].id }
      : { kind: 'refused', override, why: `${candidates.length} empty rows match the row to adopt, need exactly 1` }
  })
}

export type EspnOverrideSummary = {
  already: number
  written: number
  refused: Array<{ espnId: string; why: string }>
}

/** Read the facts, plan, and write. One failed write never costs the others. */
export async function applyEspnIdentityOverrides(
  overrides: readonly EspnIdentityOverride[] = ESPN_IDENTITY_OVERRIDES,
  sportKey = 'NFL',
): Promise<EspnOverrideSummary> {
  const summary: EspnOverrideSummary = { already: 0, written: 0, refused: [] }
  if (overrides.length === 0) return summary

  const select = { id: true, sleeperId: true, espnId: true, normalizedName: true, position: true } as const
  const [sleeperRows, espnRows, adoptRows] = await Promise.all([
    prisma.playerIdentityMap.findMany({ where: { sport: sportKey, sleeperId: { in: overrides.map((o) => o.sleeperId) } }, select }),
    prisma.playerIdentityMap.findMany({ where: { sport: sportKey, espnId: { in: overrides.map((o) => o.espnId) } }, select }),
    prisma.playerIdentityMap.findMany({
      where: {
        sport: sportKey,
        normalizedName: { in: overrides.flatMap((o) => (o.adoptRow ? [o.adoptRow.normalizedName] : [])) },
      },
      select,
    }),
  ])

  const group = <K>(rows: typeof sleeperRows, key: (r: (typeof sleeperRows)[number]) => K | null) => {
    const out = new Map<K, IdentityRow[]>()
    for (const r of rows) {
      const k = key(r)
      if (k == null) continue
      out.set(k, [...(out.get(k) ?? []), { id: r.id, sleeperId: r.sleeperId, espnId: r.espnId }])
    }
    return out
  }
  const adoptCandidates = new Map<string, IdentityRow[]>()
  for (const o of overrides) {
    if (!o.adoptRow) continue
    const want = o.adoptRow
    adoptCandidates.set(
      o.espnId,
      adoptRows
        .filter((r) => r.normalizedName === want.normalizedName && (r.position ?? '').toUpperCase() === want.position)
        .map((r) => ({ id: r.id, sleeperId: r.sleeperId, espnId: r.espnId })),
    )
  }

  const plan = planEspnIdentityOverrides(overrides, {
    bySleeperId: group(sleeperRows, (r) => r.sleeperId),
    byEspnId: group(espnRows, (r) => r.espnId),
    adoptCandidates,
  })

  for (const action of plan) {
    if (action.kind === 'already') {
      summary.already += 1
      continue
    }
    if (action.kind === 'refused') {
      summary.refused.push({ espnId: action.override.espnId, why: action.why })
      continue
    }
    try {
      /* The `null` guards make each write a no-op if the row changed since it was read. */
      const updated = await prisma.playerIdentityMap.updateMany({
        where:
          action.kind === 'set-espn'
            ? { id: action.rowId, espnId: null, sleeperId: action.override.sleeperId }
            : { id: action.rowId, espnId: null, sleeperId: null },
        data:
          action.kind === 'set-espn'
            ? { espnId: action.override.espnId }
            : { espnId: action.override.espnId, sleeperId: action.override.sleeperId },
      })
      if (updated.count === 1) summary.written += 1
      else summary.refused.push({ espnId: action.override.espnId, why: 'row changed before the write' })
    } catch (error) {
      summary.refused.push({
        espnId: action.override.espnId,
        why: error instanceof Error ? error.message.slice(0, 120) : 'write failed',
      })
    }
  }
  return summary
}
