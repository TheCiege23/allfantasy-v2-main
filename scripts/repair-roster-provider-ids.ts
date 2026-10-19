/**
 * Repair provider ids already written onto redraft rosters.
 *
 * 🛑 THE ENGINE FIX DOES NOT REACH ROWS THAT ARE ALREADY THERE. `getResolvedDraftPoolForLeague`
 * now assigns only an id the evidence can confirm is that player's, but a roster row keeps
 * whatever the draft wrote — for the life of the league. Measured 2026-09-23 on a 1,929-entry
 * board, 443 of the 1,713 numeric ids resolved to a DIFFERENT man, and every league drafted
 * before that fix is still carrying them.
 *
 * Two shapes of damage, and they fail differently:
 *   - `name:<Name>:<POS>:<TEAM>` — no feed answers, so the player scores zero, visibly.
 *   - a Rolling Insights number — the NFL scoring path reads it as a SLEEPER id and finds
 *     somebody else, so the roster slot is scored from another man's week, silently.
 *
 * The evidence is `SportsPlayer`: a Sleeper id is attributed only when every row carrying it
 * agrees on the player, and a replacement is proposed only when the name and position resolve
 * to exactly ONE Sleeper id. Anything else is reported and left alone — a wrong repair is
 * worse than the row it replaces.
 *
 * Read-only by default.
 *
 *   npx tsx scripts/repair-roster-provider-ids.ts
 *   npx tsx scripts/repair-roster-provider-ids.ts --league=<leagueId>
 *   npx tsx scripts/repair-roster-provider-ids.ts --apply --confirm-host=<endpoint-prefix>
 *
 * ⚠ `--apply` REQUIRES `--confirm-host` TO MATCH THE CONNECTED DATABASE. Importing
 * `@prisma/client` populates `process.env` from `.env`, which in this repo is PRODUCTION —
 * so "I did not pass a connection string" is not a safety property. Naming the host you
 * believe you are on is the gate, and it is checked against the one actually connected.
 */
import { writeFile } from 'node:fs/promises'

import { PrismaClient } from '@prisma/client'

import {
  canonicalPosition,
  providerIdIsUsableForPlayer,
  suffixlessCanonicalName,
} from '../lib/draft-room/player-canonical-identity'
import { proposeRosterIdPropagation, rewriteRosterPlayerIds } from '../lib/league-runtime/rosterPlayerIdRewrite'
import { resolveWriteAuthority } from '../lib/league/write-authority'

const prisma = new PrismaClient()

type Args = {
  apply: boolean
  confirmHost: string | null
  leagueId: string | null
  platform: string | null
  sport: string
  limitSamples: number
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : null
  }
  return {
    apply: argv.includes('--apply'),
    confirmHost: get('confirm-host'),
    leagueId: get('league'),
    platform: get('platform'),
    sport: (get('sport') ?? 'NFL').toUpperCase(),
    limitSamples: Number(get('samples') ?? 15),
  }
}

function connectedHost(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) return '(no DATABASE_URL)'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

/**
 * The `nfl:def:<ABBR>` id for a team defense whose current id is a SYNTHETIC one.
 *
 * 🛑 A BARE TEAM ABBREVIATION IS NOT BROKEN — IT IS SLEEPER'S OWN ID FOR A DEFENCE, AND
 * REWRITING IT WOULD BREAK THE 37 IMPORTED LEAGUES THAT SCORE TODAY. An earlier cut of this
 * function normalised any DEF row to `nfl:def:<ABBR>`, which proposed 447 changes across
 * sleeper-platform leagues where `playerId` already reads `DEN`, `HOU`, `LAR`. That is the
 * id their own feed uses; the repair would have been the regression.
 *
 * So only the AllFantasy synthetic form is converted — `name:Denver Defense:DEF:DEN`, which
 * no feed answers for and which `teamAbbrevFromDefPlayerId` cannot parse.
 */
function teamDefenseIdFor(row: { playerId: string; position: string; team: string | null }): string | null {
  const pos = canonicalPosition(row.position)
  if (pos !== 'DEF' && pos !== 'DST') return null
  if (!row.playerId.startsWith('name:')) return null
  const fromId = row.playerId.split(':').pop()?.trim().toUpperCase() ?? ''
  const abbr = /^[A-Z]{2,4}$/.test(fromId) ? fromId : String(row.team ?? '').trim().toUpperCase()
  return /^[A-Z]{2,4}$/.test(abbr) ? `nfl:def:${abbr}` : null
}

type Verdict =
  | { kind: 'ok' }
  | { kind: 'repair'; to: string; why: 'synthetic' | 'wrong_id_space' | 'team_defense' }
  | { kind: 'unrepairable'; why: 'no_evidence' | 'ambiguous' | 'collision' }
  | { kind: 'skipped'; why: 'season_has_a_sealed_week' }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const host = connectedHost()
  console.log(`host=${host} sport=${args.sport} league=${args.leagueId ?? '(all)'} mode=${args.apply ? 'APPLY' : 'dry-run'}`)

  if (args.apply) {
    // Gate the write on proof, not on intent: the operator must name the host, and it must
    // be the one actually connected.
    if (!args.confirmHost || !host.startsWith(args.confirmHost)) {
      console.error(
        `REFUSING to apply: --confirm-host=${args.confirmHost ?? '(missing)'} does not prefix the connected host ${host}`,
      )
      process.exitCode = 1
      return
    }
    /*
     * 🛑 AN UNSCOPED APPLY IS THE DANGEROUS ONE, BECAUSE MOST OF THIS TABLE IS NOT OURS TO
     * REWRITE. Production holds 101,686 NFL redraft roster rows and 100,047 of them belong to
     * IMPORTED sleeper leagues, whose ids are already Sleeper's. The rows this finds outside
     * that are mostly ESPN leagues carrying ESPN player ids — correct for ESPN, wrong only if
     * something reads them as Sleeper ids, which is a question about that platform's sync and
     * not one this script can answer. So naming a scope is mandatory for a write.
     */
    if (!args.leagueId && !args.platform) {
      console.error('REFUSING to apply without a scope: pass --league=<id> or --platform=<name>.')
      process.exitCode = 1
      return
    }
  }

  // ── evidence ──────────────────────────────────────────────────────────────
  const players = await prisma.sportsPlayer.findMany({
    where: { sport: args.sport },
    select: { name: true, position: true, sleeperId: true },
  })

  /** sleeperId -> the base name that owns it, dropped entirely when its rows disagree. */
  const baseNameBySleeperId = new Map<string, string>()
  const contested = new Set<string>()
  for (const p of players) {
    const id = String(p.sleeperId ?? '').trim()
    if (!id) continue
    const base = suffixlessCanonicalName(p.name)
    if (!base) continue
    const seen = baseNameBySleeperId.get(id)
    if (seen === undefined) baseNameBySleeperId.set(id, base)
    else if (seen !== base) contested.add(id)
  }
  for (const id of contested) baseNameBySleeperId.delete(id)

  /** `base|position` -> every Sleeper id claiming it. A repair needs exactly one. */
  const sleeperIdsByPerson = new Map<string, Set<string>>()
  for (const p of players) {
    const id = String(p.sleeperId ?? '').trim()
    if (!id || contested.has(id)) continue
    const key = `${suffixlessCanonicalName(p.name)}|${canonicalPosition(p.position)}`
    const set = sleeperIdsByPerson.get(key) ?? new Set<string>()
    set.add(id)
    sleeperIdsByPerson.set(key, set)
  }
  console.log(
    `evidence: ${players.length} ${args.sport} SportsPlayer rows, ` +
      `${baseNameBySleeperId.size} attributable sleeper ids (${contested.size} contested and therefore ignored), ` +
      `${sleeperIdsByPerson.size} name+position keys`,
  )

  // ── the rows to judge ─────────────────────────────────────────────────────
  const rows = await prisma.redraftRosterPlayer.findMany({
    where: {
      sport: args.sport,
      droppedAt: null,
      ...(args.leagueId || args.platform
        ? {
            roster: {
              season: {
                ...(args.leagueId ? { leagueId: args.leagueId } : {}),
                ...(args.platform ? { league: { platform: args.platform } } : {}),
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      rosterId: true,
      playerId: true,
      playerName: true,
      position: true,
      team: true,
      roster: {
        select: { seasonId: true, season: { select: { leagueId: true, league: { select: { platform: true } } } } },
      },
    },
  })

  /**
   * 🛑 A SEALED WEEK MUST NOT BE REPAIRED UNDERNEATH ITS OWN SCORES — IT SILENTLY UNSEALS IT.
   *
   * `PlayerWeeklyScore` is keyed by playerId, and `finalizeRedraftWeek` short-circuits on
   * `alreadyFinal`. So moving a roster row to a new id points it at a DIFFERENT, unfinalized
   * score row while the matchup keeps the total computed from the old one. Measured on the
   * test database: a week reading `starters=26 scoreRows=26 isFinalized=26` became
   * `scoreRows=25 isFinalized=3` with its final scores unchanged and now wrong.
   *
   * Repairing such a week means recomputing a result managers have already seen, which is a
   * decision, not a cleanup — so it is refused here and reported instead. Production has no
   * finalized native week at all (the whole point of the finalizer work), so in practice this
   * restricts nothing there.
   */
  const sealedSeasonIds = new Set(
    (
      await prisma.redraftMatchup.findMany({
        where: { status: 'final', ...(args.leagueId ? { season: { leagueId: args.leagueId } } : {}) },
        select: { seasonId: true },
        distinct: ['seasonId'],
      })
    ).map((m) => m.seasonId),
  )

  /** Every id already live on a roster, so a repair cannot put one player on it twice. */
  const idsByRoster = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = idsByRoster.get(r.rosterId) ?? new Set<string>()
    set.add(r.playerId)
    idsByRoster.set(r.rosterId, set)
  }

  const judge = (r: (typeof rows)[number]): Verdict => {
    if (sealedSeasonIds.has(r.roster.seasonId)) {
      // Judge it anyway below only to report; a sealed season is never written.
      const wouldRepair = judgeIdentity(r)
      return wouldRepair.kind === 'repair' ? { kind: 'skipped', why: 'season_has_a_sealed_week' } : wouldRepair
    }
    return judgeIdentity(r)
  }

  const judgeIdentity = (r: (typeof rows)[number]): Verdict => {
    const defId = teamDefenseIdFor(r)
    if (defId) {
      if (r.playerId === defId) return { kind: 'ok' }
      if (idsByRoster.get(r.rosterId)?.has(defId)) return { kind: 'unrepairable', why: 'collision' }
      return { kind: 'repair', to: defId, why: 'team_defense' }
    }

    const usable = providerIdIsUsableForPlayer({
      id: r.playerId,
      playerName: r.playerName,
      sport: args.sport,
      baseNameBySleeperId,
    })
    // A `name:` id is shaped like a legitimate non-numeric id, so the usability test passes it.
    // It is still unscoreable, and it is the whole reason this script exists.
    const isSynthetic = r.playerId.startsWith('name:')
    if (usable && !isSynthetic) return { kind: 'ok' }

    const key = `${suffixlessCanonicalName(r.playerName)}|${canonicalPosition(r.position)}`
    const candidates = sleeperIdsByPerson.get(key)
    if (!candidates || candidates.size === 0) return { kind: 'unrepairable', why: 'no_evidence' }
    if (candidates.size > 1) return { kind: 'unrepairable', why: 'ambiguous' }
    const to = [...candidates][0]!
    if (to === r.playerId) return { kind: 'ok' }
    if (idsByRoster.get(r.rosterId)?.has(to)) return { kind: 'unrepairable', why: 'collision' }
    return { kind: 'repair', to, why: isSynthetic ? 'synthetic' : 'wrong_id_space' }
  }

  const counts = new Map<string, number>()
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)
  const repairs: Array<{ id: string; from: string; to: string; name: string; why: string; leagueId: string; platform: string }> = []
  const samples: string[] = []

  for (const r of rows) {
    const v = judge(r)
    bump(v.kind === 'ok' ? 'ok' : `${v.kind}:${v.why}`)
    if (v.kind !== 'repair') continue
    repairs.push({
      id: r.id,
      from: r.playerId,
      to: v.to,
      name: r.playerName,
      why: v.why,
      leagueId: r.roster.season.leagueId,
      platform: String(r.roster.season.league?.platform ?? 'unknown'),
    })
    // Claim the id so a second row on the same roster sees the collision.
    idsByRoster.get(r.rosterId)?.add(v.to)
    if (samples.length < args.limitSamples) {
      samples.push(`   ${r.playerName.padEnd(24)} ${String(r.position).padEnd(4)} ${v.why.padEnd(14)} ${r.playerId}  ->  ${v.to}`)
    }
  }

  console.log(`\nroster rows judged: ${rows.length}`)
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(26)} ${n}`)
  if (samples.length) {
    console.log('\nsample repairs:')
    for (const s of samples) console.log(s)
  }

  const leaguesTouched = new Set(repairs.map((r) => r.leagueId))
  console.log(`\n${repairs.length} row(s) would change across ${leaguesTouched.size} league(s)`)
  const byPlatform = new Map<string, { rows: number; leagues: Set<string> }>()
  for (const r of repairs) {
    const e = byPlatform.get(r.platform) ?? { rows: 0, leagues: new Set<string>() }
    e.rows += 1
    e.leagues.add(r.leagueId)
    byPlatform.set(r.platform, e)
  }
  for (const [pf, e] of [...byPlatform.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`   platform ${pf.padEnd(14)} ${String(e.rows).padStart(5)} row(s) in ${e.leagues.size} league(s)`)
  }

  /*
   * 🛑 THE ROSTER BLOB MUST MOVE WITH ITS SCORING ROWS. Each repair above changes
   * `RedraftRosterPlayer.playerId`; the linked NATIVE `Roster.playerData` (lineup, picker, every move
   * path) still names the old id, so a bench or a drop no longer reaches the row that scores. Leagues
   * repaired by an earlier run of this script are already in exactly that state — so the blob is
   * also reconciled against rows that are ALREADY right (`proposeRosterIdPropagation`).
   *
   * Native only: on an imported league the platform owns `playerData` and the collector rewrites it.
   */
  const rosterRewrites = await planRosterBlobRewrites(repairs, rows)
  console.log(`\n${rosterRewrites.length} native roster blob(s) would change:`)
  for (const rw of rosterRewrites.slice(0, args.limitSamples)) {
    console.log(`   roster ${rw.rosterId}  ${[...rw.mapping].map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
  }

  if (!args.apply) {
    console.log('\ndry run — nothing written. Re-run with --apply --confirm-host=<prefix> to write.')
    return
  }

  /*
   * Write the undo BEFORE the change, not after. A repair is reversible only if the old ids
   * survive somewhere, and after the update they exist nowhere at all.
   */
  const undoPath = `roster-id-repair-undo-${host.split('.')[0]}-${Date.now()}.json`
  await writeFile(
    undoPath,
    JSON.stringify(
      {
        host,
        sport: args.sport,
        at: new Date().toISOString(),
        changes: repairs,
        // The whole previous blob, so a rewrite is undone by writing it back.
        rosterBlobs: rosterRewrites.map((rw) => ({ rosterId: rw.rosterId, previousPlayerData: rw.before })),
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`\nundo written to ${undoPath} (${repairs.length} row(s), each with its previous id)`)

  let written = 0
  const CHUNK = 50
  for (let i = 0; i < repairs.length; i += CHUNK) {
    const batch = repairs.slice(i, i + CHUNK)
    await prisma.$transaction(
      batch.map((r) => prisma.redraftRosterPlayer.update({ where: { id: r.id }, data: { playerId: r.to } })),
    )
    written += batch.length
    console.log(`   wrote ${written}/${repairs.length}`)
  }
  console.log(`\nAPPLIED: ${written} roster row(s) updated on ${host}`)

  for (const rw of rosterRewrites) {
    await prisma.roster.update({ where: { id: rw.rosterId }, data: { playerData: rw.after as never } })
  }
  console.log(`APPLIED: ${rosterRewrites.length} native roster blob(s) updated on ${host}`)
}

type RosterRewrite = { rosterId: string; mapping: Map<string, string>; before: unknown; after: unknown }

async function planRosterBlobRewrites(
  repairs: ReadonlyArray<{ id: string; from: string; to: string }>,
  rows: ReadonlyArray<{ id: string; rosterId: string; playerId: string; playerName: string }>,
): Promise<RosterRewrite[]> {
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const redraftRosterIds = [...new Set(rows.map((r) => r.rosterId))]
  const generic = await prisma.roster.findMany({
    where: { redraftRosterId: { in: redraftRosterIds } },
    select: { id: true, redraftRosterId: true, playerData: true, league: { select: { platform: true } } },
  })
  const out: RosterRewrite[] = []
  for (const g of generic) {
    if (!g.redraftRosterId || resolveWriteAuthority(g.league?.platform) !== 'NATIVE') continue
    const rid = g.redraftRosterId
    // The scoring rows as they will stand after this run's repairs.
    const after = new Map(repairs.map((r) => [r.id, r.to]))
    const liveRows = rows
      .filter((r) => r.rosterId === rid)
      .map((r) => ({ playerId: after.get(r.id) ?? r.playerId, playerName: r.playerName }))
    const mapping = new Map<string, string>()
    for (const r of repairs) if (rowById.get(r.id)?.rosterId === rid) mapping.set(r.from, r.to)
    for (const [from, to] of proposeRosterIdPropagation(rewriteRosterPlayerIds(g.playerData, mapping), liveRows)) {
      mapping.set(from, to)
    }
    if (mapping.size === 0) continue
    out.push({ rosterId: g.id, mapping, before: g.playerData, after: rewriteRosterPlayerIds(g.playerData, mapping) })
  }
  return out
}

main()
  .catch((e) => {
    console.error('FATAL', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
