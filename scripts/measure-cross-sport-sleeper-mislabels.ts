/**
 * Rows ALREADY WRITTEN with another sport's player, by the Sleeper-id reads that had no sport.
 * READ-ONLY BY DEFAULT: it measures, prints counts and samples, and prints the SQL a repair would run.
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/measure-cross-sport-sleeper-mislabels.ts
 *   … --only=snapshots,adp,cards      # a subset (default: all three)
 *   … --sample=10                     # samples printed per kind (default 10)
 *   … --sql                           # also print the review SQL for EVERY affected row, not just samples
 *   … --write --endpoint=<id>         # REPAIR. Refuses unless <id> is the database the connection resolves to
 *
 * WHY. Sleeper numbers each sport separately (NFL 1466 Travis Kelce / NBA 1466 JaVale McGee; 4866
 * Saquon Barkley / AJ Dybantsa; 4984 Josh Allen / Cameron Corhen). Before the sport-scope fix three
 * writers stored what an unscoped `sleeperId` read returned:
 *
 *   snapshots  `LeagueTrade.contextSnapshot` (`backfill_rebuilt`) — roster players' `position`/`team`.
 *   adp        `AllFantasyAdpSnapshot` (`draftType = 'imported'`) — boards from imported drafts.
 *   cards      `LeagueChatMessage.metadata.tradeCard` — the league-chat trade card's player names.
 *
 * A stored value is counted only when it disagrees with the right sport's row AND equals another
 * sport's row under the same id (`lib/data-repair/crossSportSleeperMislabels.ts`) — drift is not this bug.
 *
 * REPAIR, per kind, recomputed with the FIXED sport-scoped lookups:
 *   snapshots  only the mislabelled players' position/team are replaced, optimistic on the old JSON.
 *   cards      the card's player name/position/team, and the name in the message text when it occurs
 *              exactly once (otherwise left and reported).
 *   adp        the stale imported rows (keys only the old resolution produced) are deleted, then the
 *              sport's imported board is rebuilt by the existing `recomputeAllFantasyAdp` — never hand-edited.
 *
 * 🛑 `--write` REQUIRES `--endpoint=<id>`, the same positive allowlist as
 * `scripts/recalculate-af-format-markets.ts`: `@prisma/client` loads `.env` on import and `.env` points
 * at production. The dry run prints the endpoint your connection resolves to. Calls no external API.
 */
import { PrismaClient, Prisma } from '@prisma/client'

import { endpointFromDatabaseUrl, endpointMatches } from '../lib/db/databaseEndpoint'
import {
  applyCardCorrections,
  applySnapshotCorrections,
  cardPlayerIds,
  findCardMislabels,
  findSnapshotMislabels,
  snapshotPlayerIds,
  sqlJsonText,
  sqlLiteral,
  staleAdpPlayers,
  writeRefusal,
  type IdReadings,
  type ResolvedPick,
  type SportReading,
} from '../lib/data-repair/crossSportSleeperMislabels'

const prisma = new PrismaClient()
const PAGE = 500

const arg = (name: string) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1] ?? ''
const only = new Set((arg('only') || 'snapshots,adp,cards').split(',').map((s) => s.trim()).filter(Boolean))
const sampleN = Math.max(0, Number(arg('sample') || 10))
const allSql = process.argv.includes('--sql')
const write = process.argv.includes('--write')

/** Every sport's reading of these Sleeper ids from `SportsPlayer`, the Sleeper-sourced row first. */
async function readingsFor(ids: string[], rightSport: string): Promise<Map<string, IdReadings>> {
  const out = new Map<string, IdReadings>()
  const right = rightSport.toUpperCase()
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.sportsPlayer.findMany({
      // Deliberately EVERY sport: the other sports' rows are what a mislabel is recognised by
      // (allowlisted in scripts/check-sleeper-id-sport-scope.mjs for that reason).
      where: { sleeperId: { in: ids.slice(i, i + 1000) } },
      select: { sleeperId: true, sport: true, source: true, name: true, position: true, team: true },
    })
    const bySport = new Map<string, Map<string, (typeof rows)[number]>>()
    for (const r of rows) {
      if (!r.sleeperId) continue
      const sport = String(r.sport).toUpperCase()
      const m = bySport.get(r.sleeperId) ?? new Map()
      const prev = m.get(sport)
      if (!prev || (prev.source !== 'sleeper' && r.source === 'sleeper')) m.set(sport, r)
      bySport.set(r.sleeperId, m)
    }
    for (const [id, m] of bySport) {
      const reading = (r: (typeof rows)[number]): SportReading => ({ sport: String(r.sport).toUpperCase(), name: r.name, position: r.position, team: r.team })
      const rightRow = m.get(right)
      out.set(id, { right: rightRow ? reading(rightRow) : null, others: [...m].filter(([s]) => s !== right).map(([, r]) => reading(r)) })
    }
  }
  return out
}

// ─── snapshots ──────────────────────────────────────────────────────────────────────────────────

async function snapshots() {
  console.log('\n== LeagueTrade.contextSnapshot (backfill_rebuilt) ==')
  let after = ''
  let scanned = 0
  let affectedRows = 0
  let affectedPlayers = 0
  let written = 0
  const byPair = new Map<string, number>()
  const samples: string[] = []
  for (;;) {
    const page = await prisma.$queryRaw<Array<{ id: string; sport: string; snap: unknown }>>`
      SELECT id, sport, "contextSnapshot" AS snap FROM "LeagueTrade"
      WHERE "contextSnapshot"->>'source' = 'backfill_rebuilt' AND NOT ("contextSnapshot" ? 'unavailable') AND id > ${after}
      ORDER BY id LIMIT ${PAGE}`
    if (page.length === 0) break
    after = page[page.length - 1]!.id
    scanned += page.length
    const bySport = new Map<string, typeof page>()
    for (const r of page) bySport.set(String(r.sport || 'nfl').toUpperCase(), [...(bySport.get(String(r.sport || 'nfl').toUpperCase()) ?? []), r])
    for (const [sport, rows] of bySport) {
      const readings = await readingsFor([...new Set(rows.flatMap((r) => snapshotPlayerIds(r.snap)))], sport)
      for (const r of rows) {
        const fixes = findSnapshotMislabels(r.snap, readings)
        if (fixes.length === 0) continue
        affectedRows += 1
        affectedPlayers += fixes.length
        for (const f of fixes) byPair.set(`${sport}<-${f.wrongSport}`, (byPair.get(`${sport}<-${f.wrongSport}`) ?? 0) + 1)
        const sets = fixes.reduce(
          (expr, f) =>
            `jsonb_set(jsonb_set(${expr}, '{sides,${f.side},rosterBefore,${f.index},position}', ${sqlJsonText(f.correct.position)}), ` +
            `'{sides,${f.side},rosterBefore,${f.index},team}', ${sqlJsonText(f.correct.team)})`,
          '"contextSnapshot"',
        )
        const guards = fixes
          .map((f) => `"contextSnapshot" #>> '{sides,${f.side},rosterBefore,${f.index},id}' = ${sqlLiteral(f.playerId)} AND "contextSnapshot" #>> '{sides,${f.side},rosterBefore,${f.index},position}' = ${sqlLiteral(f.stored.position)}`)
          .join(' AND ')
        const sql = `UPDATE "LeagueTrade" SET "contextSnapshot" = ${sets} WHERE id = ${sqlLiteral(r.id)} AND ${guards};`
        if (samples.length < sampleN || allSql) {
          samples.push(`  ${r.id} [${sport}] ` + fixes.map((f) => `${f.playerId}: ${f.stored.position} (${f.wrongSport}) -> ${f.correct.position}`).join(', ') + `\n    ${sql}`)
        }
        if (write) {
          const next = applySnapshotCorrections(r.snap, fixes)
          const res = await prisma.leagueTrade.updateMany({
            where: { id: r.id, contextSnapshot: { equals: r.snap as Prisma.InputJsonValue } },
            data: { contextSnapshot: next as Prisma.InputJsonValue },
          })
          written += res.count
        }
      }
    }
  }
  console.log(`scanned ${scanned} rebuilt snapshots; affected rows ${affectedRows}, players ${affectedPlayers}`)
  for (const [pair, n] of [...byPair].sort((a, b) => b[1] - a[1])) console.log(`  ${pair.padEnd(12)} ${n}`)
  for (const s of samples) console.log(s)
  if (write) console.log(`WROTE ${written} row(s)`)
}

// ─── cards ──────────────────────────────────────────────────────────────────────────────────────

async function cards() {
  console.log('\n== LeagueChatMessage.metadata.tradeCard ==')
  let after = ''
  let scanned = 0
  let affectedRows = 0
  let affectedAssets = 0
  let textUnfixed = 0
  let written = 0
  const samples: string[] = []
  for (;;) {
    const page = await prisma.$queryRaw<Array<{ id: string; sport: string; message: string; metadata: unknown }>>`
      SELECT m.id, l.sport::text AS sport, m.message, m.metadata FROM league_chat_messages m JOIN leagues l ON l.id = m."leagueId"
      WHERE m.metadata ? 'tradeCard' AND m.id > ${after}
      ORDER BY m.id LIMIT ${PAGE}`
    if (page.length === 0) break
    after = page[page.length - 1]!.id
    scanned += page.length
    const bySport = new Map<string, typeof page>()
    for (const r of page) bySport.set(String(r.sport).toUpperCase(), [...(bySport.get(String(r.sport).toUpperCase()) ?? []), r])
    for (const [sport, rows] of bySport) {
      const readings = await readingsFor([...new Set(rows.flatMap((r) => cardPlayerIds(r.metadata)))], sport)
      for (const r of rows) {
        const fixes = findCardMislabels(r.metadata, readings)
        if (fixes.length === 0) continue
        affectedRows += 1
        affectedAssets += fixes.length
        const next = applyCardCorrections(r.metadata, r.message, fixes)
        textUnfixed += next.textUnfixed.length
        const sets = fixes.reduce(
          (expr, f) =>
            ['name', 'position', 'team'].reduce(
              (e, k) => `jsonb_set(${e}, '{tradeCard,${f.list},${f.index},${k}}', ${sqlJsonText((f.correct as Record<string, string | null>)[k])})`,
              expr,
            ),
          'metadata',
        )
        const textSql = next.text !== r.message ? `, message = ${sqlLiteral(next.text)}` : ''
        const sql = `UPDATE league_chat_messages SET metadata = ${sets}${textSql} WHERE id = ${sqlLiteral(r.id)} AND message = ${sqlLiteral(r.message)};`
        if (samples.length < sampleN || allSql) {
          samples.push(`  ${r.id} [${sport}] ` + fixes.map((f) => `${f.playerId}: "${f.stored.name}" (${f.wrongSport}) -> "${f.correct.name}"`).join(', ') + `\n    ${sql}`)
        }
        if (write) {
          const res = await prisma.leagueChatMessage.updateMany({
            where: { id: r.id, message: r.message },
            data: { metadata: next.metadata as Prisma.InputJsonValue, message: next.text },
          })
          written += res.count
        }
      }
    }
  }
  console.log(`scanned ${scanned} trade-card messages; affected messages ${affectedRows}, assets ${affectedAssets}, names left in text ${textUnfixed}`)
  for (const s of samples) console.log(s)
  if (write) console.log(`WROTE ${written} row(s)`)
}

// ─── adp ────────────────────────────────────────────────────────────────────────────────────────

/** The PRE-FIX resolution, reproduced on purpose: identity map and SportsPlayer by `sleeperId` alone. */
async function oldResolve(ids: string[]): Promise<Map<string, ResolvedPick>> {
  const out = new Map<string, ResolvedPick>()
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000)
    // Unscoped ON PURPOSE — it reproduces the pre-fix read to measure what that read wrote (allowlisted).
    const pim = await prisma.playerIdentityMap.findMany({ where: { sleeperId: { in: chunk } }, select: { sleeperId: true, canonicalName: true, position: true } })
    for (const r of pim) if (r.sleeperId && r.canonicalName?.trim() && r.position?.trim()) out.set(r.sleeperId, { name: r.canonicalName.trim(), position: r.position.trim() })
    const missing = chunk.filter((id) => !out.has(id))
    if (missing.length === 0) continue
    const sp = await prisma.sportsPlayer.findMany({ where: { sleeperId: { in: missing } }, select: { sleeperId: true, name: true, position: true } })
    for (const r of sp) if (r.sleeperId && !out.has(r.sleeperId) && r.name?.trim() && r.position?.trim()) out.set(r.sleeperId, { name: r.name.trim(), position: r.position.trim() })
  }
  return out
}

async function adp() {
  console.log('\n== AllFantasyAdpSnapshot (draftType = imported) ==')
  const { resolveDraftFactSleeperPlayers } = await import('../lib/adp/draftFactSamples')
  const { buildPlayerKey, normalizeStoredPlayerKey } = await import('../lib/adp/computeAllFantasyAdp')
  const sports = await prisma.draftFact.findMany({ distinct: ['sport'], select: { sport: true } })
  for (const { sport } of sports) {
    const S = String(sport).toUpperCase()
    // Only facts whose league reads ids as Sleeper ids took the unscoped path.
    const ids = new Set<string>()
    let after: string | undefined
    for (;;) {
      const page = await prisma.draftFact.findMany({
        where: { sport, ...(after ? { draftId: { gt: after } } : {}) },
        orderBy: { draftId: 'asc' },
        select: { draftId: true, playerId: true, leagueId: true },
        take: 5000,
      })
      if (page.length === 0) break
      after = page[page.length - 1]!.draftId
      const leagues = await prisma.league.findMany({ where: { id: { in: [...new Set(page.map((f) => f.leagueId))] } }, select: { id: true, platform: true } })
      const sleeperish = new Set(leagues.filter((l) => !['yahoo', 'espn', 'mfl', 'fleaflicker', 'fantrax'].includes(String(l.platform ?? '').toLowerCase())).map((l) => l.id))
      for (const f of page) if (sleeperish.has(f.leagueId) && f.playerId) ids.add(String(f.playerId))
    }
    if (ids.size === 0) {
      console.log(`  ${S}: no Sleeper-id draft facts`)
      continue
    }
    const list = [...ids]
    const old = await oldResolve(list)
    const fixed = await resolveDraftFactSleeperPlayers(list, S)
    const keyOf = (n: string, p: string) => buildPlayerKey(n, p)
    const { changedIds, staleKeys } = staleAdpPlayers(list, old, fixed, keyOf)
    const present = staleKeys.length
      ? await prisma.allFantasyAdpSnapshot.findMany({ where: { sport: S, draftType: 'imported' }, select: { id: true, playerKey: true, playerName: true } })
      : []
    const stale = new Set(staleKeys)
    const hit = present.filter((r) => stale.has(normalizeStoredPlayerKey(r.playerKey)))
    console.log(`  ${S}: ${ids.size} Sleeper-id players drafted; ${changedIds.length} resolved differently before the fix; ${staleKeys.length} stale keys; ${hit.length} stored imported ADP rows to remove`)
    for (const c of changedIds.slice(0, sampleN)) console.log(`    ${c.id}: was ${c.old.name} (${c.old.position}) -> now ${c.now ? `${c.now.name} (${c.now.position})` : 'unnamed'}`)
    if (hit.length) {
      const keys = hit.map((r) => sqlLiteral(r.playerKey)).join(', ')
      console.log(`    DELETE FROM allfantasy_adp_snapshots WHERE sport = ${sqlLiteral(S)} AND "draftType" = 'imported' AND "playerKey" IN (${allSql ? keys : hit.slice(0, sampleN).map((r) => sqlLiteral(r.playerKey)).join(', ') + (hit.length > sampleN ? ', …' : '')});`)
      console.log(`    -- then: recomputeAllFantasyAdp({ sport: '${S}', draftType: 'imported', draftMode: 'real', apply: true })`)
    }
    if (write && hit.length) {
      const del = await prisma.allFantasyAdpSnapshot.deleteMany({ where: { id: { in: hit.map((r) => r.id) }, sport: S, draftType: 'imported' } })
      const { recomputeAllFantasyAdp } = await import('../lib/adp/recomputeAllFantasyAdp')
      const rep = await recomputeAllFantasyAdp({ sport: S, draftType: 'imported', draftMode: 'real', apply: true })
      console.log(`    DELETED ${del.count}; recompute wrote ${rep.snapshotsWritten}, errors ${rep.errors.length}`)
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  const endpoint = endpointFromDatabaseUrl(url)
  console.log(`  endpoint: ${endpoint ?? '(unresolved)'}`)
  console.log(`  mode:     ${write ? 'WRITE' : 'DRY RUN (no writes)'}`)
  console.log(`  kinds:    ${[...only].join(', ')}`)
  const refusal = writeRefusal(process.argv, url, endpointMatches, endpoint)
  if (refusal) {
    console.error(`\n${refusal}`)
    process.exitCode = 1
    return
  }
  if (only.has('snapshots')) await snapshots()
  if (only.has('cards')) await cards()
  if (only.has('adp')) await adp()
  if (!write) console.log('\nDry-run only — nothing written. Re-run with --write --endpoint=<id> to repair.')
}

main()
  .catch((e) => {
    console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
