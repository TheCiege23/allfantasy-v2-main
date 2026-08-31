/**
 * Renumber legacy Fantrax `LeagueTeam.externalId` values in place.
 *
 * 🛑 WHY A BACKFILL AND NOT A SQL MIGRATION. The new id is an FNV-1a hash of
 * Fantrax's own team id (see `lib/league-import/fantrax/fantraxTeamIds.ts`).
 * Reimplementing that hash in SQL would create a SECOND definition of the
 * mapping, and the two drifting by one character renumbers teams rather than
 * failing — so the mapping has exactly one implementation and this script calls
 * it. The schema migration adds no column for this; only row values change.
 *
 * 🛑 UPDATE IN PLACE, NEVER DELETE-AND-CREATE. `LeagueTeam.claimedByUserId` is
 * what puts a league on /core/portfolio at all, and it lives on the row. A
 * delete+create would drop every claim and every league would silently vanish
 * from its owner's portfolio — the exact bug `ImportedLeagueCommitService`
 * documents having already been fixed once. `UPDATE ... SET "externalId"` keeps
 * the row, so the claim, the team name and the owner all survive untouched.
 *
 * ⚠ DRY RUN BY DEFAULT. Pass --apply to write. Reports every league it would
 * change and, for each, whether a claimed row is among them.
 *
 * ⚠ KEYS ON FANTRAX'S OWN TEAM ID, READ OUT OF THE SNAPSHOT. An earlier revision
 * of this script keyed on the team NAME, on the reasoning that `LeagueTeam` never
 * stored a Fantrax id and so nothing here could reach one. That was wrong, and
 * wrong in a way that quietly cost a second renumber: `FantraxLeague.standings`
 * has carried `fantraxTeamId` per row since `summarise` was written. Measured on
 * production 2026-08-31 — Cream Bowl, 12 of 12 standings rows carrying one.
 *
 * It matters because the importer prefers the durable id. A name-keyed backfill
 * lands on different numbers, so the next live re-import renumbers every team a
 * SECOND time — and between those two runs, any `WeeklyMatchup` row written
 * against the first numbering silently belongs to the wrong team. Keying on the
 * same id the importer uses makes the two agree by construction, which is the
 * property `fantraxTeamIds.ts` says they MUST have.
 *
 * The name remains the fallback for a snapshot with no ids (a CSV-era upload, or
 * one whose `getStandings` call failed at import time).
 *
 *     npx tsx scripts/backfill-fantrax-team-ids.ts
 *     npx tsx scripts/backfill-fantrax-team-ids.ts --apply
 *
 * ⚠ RE-RUNNABLE. Only rows whose id still matches the legacy `fantrax-team:`
 * shape are considered, so a second run is a no-op rather than a second
 * renumbering.
 */

import { prisma } from '../lib/prisma'
import {
  assignFantraxTeamIds,
  isLegacyFantraxTeamId,
  normalizeFantraxTeamName,
} from '../lib/league-import/fantrax/fantraxTeamIds'

type Row = {
  id: string
  externalId: string
  teamName: string | null
  ownerName: string | null
  claimedByUserId: string | null
}

async function main() {
  const apply = process.argv.includes('--apply')

  const leagues = await prisma.league.findMany({
    where: { platform: 'fantrax' },
    select: { id: true, name: true, season: true, platformLeagueId: true },
  })

  /*
   * The snapshots behind those leagues. `League.platformLeagueId` for Fantrax is
   * the `FantraxLeague` row's uuid, which is what makes this join possible at all.
   */
  const snapshots = await prisma.fantraxLeague.findMany({
    where: { id: { in: leagues.map((l) => l.platformLeagueId).filter(Boolean) as string[] } },
    select: { id: true, standings: true },
  })
  const sourceIdsBySnapshot = new Map<string, Map<string, string>>()
  for (const snap of snapshots) {
    const rows = Array.isArray(snap.standings)
      ? (snap.standings as Array<Record<string, unknown>>)
      : []
    const byName = new Map<string, string>()
    for (const row of rows) {
      const id = String(row?.fantraxTeamId ?? '').trim()
      const name = normalizeFantraxTeamName(String(row?.team ?? ''))
      if (id && name) byName.set(name, id)
    }
    sourceIdsBySnapshot.set(snap.id, byName)
  }

  let leaguesTouched = 0
  let rowsPlanned = 0
  let claimsInvolved = 0
  let skippedNoName = 0

  for (const league of leagues) {
    const teams = (await prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: {
        id: true,
        externalId: true,
        teamName: true,
        ownerName: true,
        claimedByUserId: true,
      },
    })) as Row[]

    const legacy = teams.filter((t) => isLegacyFantraxTeamId(t.externalId))
    if (legacy.length === 0) continue

    /*
     * ⚠ THE HASH KEY MUST BE THE WHOLE LEAGUE, NOT JUST THE LEGACY ROWS.
     * Collision probing depends on which ids are already taken, so computing the
     * map over a subset can hand a team a different number from the one the
     * importer would compute over the full set — and then the next import
     * renumbers it back. Every team goes in.
     *
     * ⚠ AND THE SOURCE ID COMES FROM THE SNAPSHOT, so these numbers are FINAL —
     * a later live re-import hashes the same ids and computes the same answer.
     * See the header for why keying on the name instead costs a second renumber.
     */
    const sourceIds = sourceIdsBySnapshot.get(league.platformLeagueId ?? '') ?? new Map()
    const keys = teams.map((t) => {
      const name = t.teamName?.trim() || t.ownerName?.trim() || ''
      return { sourceTeamId: sourceIds.get(normalizeFantraxTeamName(name)) ?? null, teamName: name }
    })
    const assigned = assignFantraxTeamIds(keys)
    const keyedBySource = keys.filter((k) => k.sourceTeamId).length

    const plan: Array<{ row: Row; next: string }> = []
    for (const row of legacy) {
      const label = normalizeFantraxTeamName(row.teamName?.trim() || row.ownerName?.trim() || '')
      const next = label ? assigned.get(label) : undefined
      if (next == null) {
        /* No name to key on. Left alone rather than given an invented number —
           a wrong roster id attributes somebody else's week to this team. */
        skippedNoName++
        continue
      }
      plan.push({ row, next: String(next) })
    }
    if (plan.length === 0) continue

    leaguesTouched++
    rowsPlanned += plan.length
    const claimed = plan.filter((p) => p.row.claimedByUserId).length
    claimsInvolved += claimed

    console.log(
      `\n${league.name ?? '(unnamed)'} ${league.season} — ${plan.length} row(s)` +
        (claimed > 0 ? `, ${claimed} CLAIMED (preserved by UPDATE)` : ''),
    )
    /* Says whether these numbers are final or will be superseded by a re-import. */
    console.log(
      keyedBySource === teams.length
        ? `  keyed on Fantrax team ids (${keyedBySource}/${teams.length}) — final, a re-import computes the same`
        : `  ⚠ keyed on NAME for ${teams.length - keyedBySource} of ${teams.length} team(s) — a live re-import will renumber those`,
    )
    for (const p of plan) {
      console.log(
        `  ${p.row.externalId} -> ${p.next}   ${p.row.teamName ?? p.row.ownerName ?? '?'}` +
          (p.row.claimedByUserId ? '  [claimed]' : ''),
      )
    }

    if (!apply) continue

    /*
     * One transaction per league. `externalId` is unique per league, so a
     * partially applied league could leave two teams sharing an id — which
     * reads downstream as one team playing itself.
     */
    await prisma.$transaction(
      plan.map((p) =>
        prisma.leagueTeam.update({
          where: { id: p.row.id },
          data: { externalId: p.next },
        }),
      ),
    )
  }

  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${rowsPlanned} row(s) across ${leaguesTouched} league(s); ` +
      `${claimsInvolved} claimed row(s) preserved; ${skippedNoName} skipped for having no name to key on.`,
  )
  if (!apply && rowsPlanned > 0) console.log('Re-run with --apply to write.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
