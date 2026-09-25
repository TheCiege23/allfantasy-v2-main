/**
 * Grade a batch of ALREADY-IMPORTED trades and show that the answer is league-specific.
 *
 * WHY THIS EXISTS. As of 2026-09-20 the production database holds 25,319 imported trades
 * (`LeagueTrade`, back to Feb 2019) and **not one of them has been analyzed** — `analyzed`
 * is false on every row, `analysisResult` null on every row. Meanwhile 341 of 366 real
 * leagues carry a real starting lineup from the import, and only 93 of those match the
 * QB1/RB2/WR2/TE1 default the valuation engine used before the lineup work landed. So the
 * product's core claim — "this value is specific to YOUR league" — had never been run
 * against the product's own data.
 *
 * This script runs it. For each sampled trade it grades twice:
 *   1. in the trade's OWN league, with that league's real lineup and scoring, and
 *   2. in a CONTRAST league with a deliberately different shape.
 *
 * If the two verdicts differ, the league-specific claim is true on real data. If they come
 * out identical, it is not, and this prints that just as plainly — the point is to find out,
 * not to produce a good-looking table.
 *
 * ── WHAT IT TOUCHES ────────────────────────────────────────────────────────────────────
 * Reads: LeagueTrade, LeagueTradeHistory, leagues, SportsPlayer, plus whatever the engine
 * reads to price assets (FantasyCalc cache, projections).
 *
 * ⚠ NOT STRICTLY READ-ONLY, AND THE DIFFERENCE IS DECLARED RATHER THAN HIDDEN.
 * `runTradeConsoleAnalysis` calls `logTradeOfferEvent`, which appends a row to
 * `TradeOfferEvent` per analysis. That is the engine's own telemetry and is arguably the
 * point — these are real gradings — but it IS a write, so this script will not touch a
 * production database unless `TRADE_BATCH_ALLOW_PROD=1` is set explicitly. It never writes
 * to `LeagueTrade`, never marks a trade analyzed, and never persists a snapshot.
 *
 * ⚠ IT DOES NOT PRODUCE PARITY SAMPLES. `recordTradeSurfaceShadow` lives in the API route,
 * not in the engine, so grading through this script contributes NOTHING to the Phase 3 flip
 * gate. Only real traffic through `/api/trade-value/analyze` does that. Said out loud because
 * assuming otherwise would let a batch run look like progress toward a cutover it cannot move.
 *
 * ── RUNNING ────────────────────────────────────────────────────────────────────────────
 *   npm run trade:grade-batch
 *   npm run trade:grade-batch -- --limit=25 --out=trade-batch.md
 *
 * `--require ./scripts/_audit-preload.cjs` stubs the `server-only` package, which throws
 * outside a Next.js server context; the engine imports it.
 */
import { writeFileSync } from 'node:fs'
import { hasDatabaseUrl } from '../lib/env/database-url'
import { describeDbTarget, identifyDbTarget, resolveDatabaseUrlFromDisk } from './_db-target-identity'

type LineupCounts = { qb: number; rb: number; wr: number; te: number; flex: number; sflex: number }

type LeagueRow = {
  id: string
  name: string
  platformLeagueId: string | null
  leagueSize: number | null
  isDynasty: boolean | null
  starters: string[] | null
}

type SampledTrade = {
  tradeId: string
  leagueId: string
  leagueName: string
  season: number
  giveNames: string[]
  getNames: string[]
}

const NON_STARTING = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES', 'RESERVE', 'NA'])
const FLEX = new Set(['FLEX', 'W/R/T', 'WRRB_FLEX', 'REC_FLEX', 'WR/RB/TE', 'RB/WR/TE'])
const SFLEX = new Set(['SUPER_FLEX', 'SUPERFLEX', 'SFLEX', 'Q/W/R/T', 'OP'])

function countLineup(starters: unknown): LineupCounts {
  const out: LineupCounts = { qb: 0, rb: 0, wr: 0, te: 0, flex: 0, sflex: 0 }
  if (!Array.isArray(starters)) return out
  for (const raw of starters) {
    const slot = String(raw).trim().toUpperCase()
    if (NON_STARTING.has(slot)) continue
    if (SFLEX.has(slot)) out.sflex += 1
    else if (FLEX.has(slot)) out.flex += 1
    else if (slot === 'QB') out.qb += 1
    else if (slot === 'RB') out.rb += 1
    else if (slot === 'WR') out.wr += 1
    else if (slot === 'TE') out.te += 1
  }
  return out
}

const shapeOf = (c: LineupCounts) =>
  `${c.qb}QB/${c.rb}RB/${c.wr}WR/${c.te}TE/${c.flex}FLEX${c.sflex ? `/${c.sflex}SF` : ''}`

/** The default the engine used before the lineup work — the thing we are proving it left behind. */
const isOldDefault = (c: LineupCounts) =>
  c.qb === 1 && c.rb === 2 && c.wr === 2 && c.te === 1 && c.sflex === 0

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('SKIPPED — no DATABASE_URL. Set one and re-run.')
    process.exit(0)
  }

  const url = process.env.DATABASE_URL ?? resolveDatabaseUrlFromDisk()
  const target = identifyDbTarget(url)
  console.log(`DB target: ${describeDbTarget(url)}`)

  if (target.kind === 'production' && process.env.TRADE_BATCH_ALLOW_PROD !== '1') {
    console.log(
      'REFUSED — this is the production database and this script appends TradeOfferEvent rows.\n' +
        'Re-run with TRADE_BATCH_ALLOW_PROD=1 if that is what you want.',
    )
    process.exit(0)
  }

  // Imported after the gate: the prisma singleton throws without a usable DATABASE_URL.
  const { prisma } = await import('../lib/prisma')
  const { runTradeConsoleAnalysis } = await import('../lib/trade-value-console/runTradeConsoleAnalysis')

  const limit = Math.max(1, Number(arg('limit', '20')) || 20)
  const outPath = arg('out', 'trade-grading-batch.md')

  // ── 1. Leagues that carry a real lineup ────────────────────────────────────────────
  const leagues = (await prisma.$queryRawUnsafe(`
    select id, name, "platformLeagueId", "leagueSize", "isDynasty", starters
    from leagues
    where platform = 'sleeper'
      and "platformLeagueId" is not null
      and starters is not null
  `)) as LeagueRow[]

  const withShape = leagues
    .map((l) => ({ league: l, counts: countLineup(l.starters) }))
    .filter((x) => x.counts.qb + x.counts.rb + x.counts.wr + x.counts.te + x.counts.flex + x.counts.sflex > 0)

  if (withShape.length === 0) {
    console.log('No Sleeper leagues with a parsed lineup. Nothing to grade.')
    process.exit(0)
  }

  /*
   * The contrast league is chosen to differ from the trade's own league on the two levers
   * that move value most: superflex and WR slot count. Picking one at random would often
   * pair two leagues with the same shape and prove nothing.
   */
  const superflexDeep = withShape.find((x) => x.counts.sflex > 0 && x.counts.wr >= 3)
  const onePlain = withShape.find((x) => x.counts.sflex === 0 && x.counts.wr <= 2)

  if (!superflexDeep || !onePlain) {
    console.log('Could not find two contrasting league shapes; grading in-league only.')
  }

  // ── 2. Trades from those leagues ───────────────────────────────────────────────────
  const rows = (await prisma.$queryRawUnsafe(
    `
    select t.id as "tradeId",
           l.id as "leagueId",
           l.name as "leagueName",
           t.season,
           t."playersGiven"    as "givenIds",
           t."playersReceived" as "receivedIds"
    from "LeagueTrade" t
    join "LeagueTradeHistory" h on h.id = t."historyId"
    join leagues l on l."platformLeagueId" = h."sleeperLeagueId" and l.platform = 'sleeper'
    where jsonb_array_length(t."playersGiven") between 1 and 4
      and jsonb_array_length(t."playersReceived") between 1 and 4
      and l.starters is not null
    order by t."tradeDate" desc
    limit ${limit * 3}
  `,
  )) as Array<{
    tradeId: string
    leagueId: string
    leagueName: string
    season: number
    givenIds: string[]
    receivedIds: string[]
  }>

  // ── 3. Sleeper ids → names (the trade rows store ids, the engine prices names) ──────
  const allIds = [...new Set(rows.flatMap((r) => [...(r.givenIds ?? []), ...(r.receivedIds ?? [])]))]
  const players = (await prisma.$queryRawUnsafe(
    `select distinct on ("sleeperId") "sleeperId", name, position
     from "SportsPlayer" where "sleeperId" = any($1::text[]) order by "sleeperId"`,
    allIds,
  )) as Array<{ sleeperId: string; name: string; position: string | null }>
  const nameById = new Map(players.map((p) => [p.sleeperId, p.name]))

  const sampled: SampledTrade[] = []
  for (const r of rows) {
    const giveNames = (r.givenIds ?? []).map((id) => nameById.get(String(id))).filter(Boolean) as string[]
    const getNames = (r.receivedIds ?? []).map((id) => nameById.get(String(id))).filter(Boolean) as string[]
    // A trade with an unresolved player would be graded on a partial side and read as lopsided
    // for a reason that has nothing to do with the league. Skip rather than mislead.
    if (giveNames.length !== (r.givenIds ?? []).length) continue
    if (getNames.length !== (r.receivedIds ?? []).length) continue
    if (giveNames.length === 0 || getNames.length === 0) continue
    sampled.push({ ...r, giveNames, getNames })
    if (sampled.length >= limit) break
  }

  console.log(`Grading ${sampled.length} trades…\n`)

  const assetsFor = (names: string[]) => names.map((name) => ({ kind: 'player' as const, name }))

  type Result = {
    trade: SampledTrade
    ownShape: string
    ownVerdict: string
    ownFairness: number | null
    ownBasis: string
    contrastShape: string | null
    contrastVerdict: string | null
    contrastFairness: number | null
    moved: boolean
  }

  const results: Result[] = []

  for (const t of sampled) {
    const own = withShape.find((x) => x.league.id === t.leagueId)
    const contrastPick =
      own && own.counts.sflex > 0 ? onePlain : superflexDeep ?? onePlain

    const grade = async (leagueId: string) =>
      runTradeConsoleAnalysis({
        sportFilter: 'NFL',
        leagueId,
        userId: null,
        strategy: 'neutral',
        teamContext: 'neutral',
        analysisTab: 'raw',
        sideGive: assetsFor(t.giveNames),
        sideGet: assetsFor(t.getNames),
        // Deterministic only: no LLM call, no token spend, and the narrative is not what is
        // being measured here — the number is.
        skipAi: true,
      } as never)

    try {
      const ownOut = (await grade(t.leagueId)) as Record<string, unknown>
      if (!(ownOut as { ok?: boolean }).ok) {
        console.log(`  · ${t.tradeId} — engine declined (${String((ownOut as { code?: string }).code)})`)
        continue
      }

      const labels = ownOut.labels as { sideAdvantage: string }
      const basis = ownOut.valuationBasis as { hasAssumptions?: boolean; assumed?: string[] } | undefined

      let contrastVerdict: string | null = null
      let contrastFairness: number | null = null
      let contrastShape: string | null = null

      if (contrastPick && contrastPick.league.id !== t.leagueId) {
        const other = (await grade(contrastPick.league.id)) as Record<string, unknown>
        if ((other as { ok?: boolean }).ok) {
          contrastVerdict = (other.labels as { sideAdvantage: string }).sideAdvantage
          contrastFairness = other.fairnessScore as number
          contrastShape = shapeOf(contrastPick.counts)
        }
      }

      const ownFairness = ownOut.fairnessScore as number
      results.push({
        trade: t,
        ownShape: own ? shapeOf(own.counts) + (isOldDefault(own.counts) ? ' (was default)' : '') : '—',
        ownVerdict: labels.sideAdvantage,
        ownFairness,
        ownBasis: basis?.hasAssumptions ? `assumed: ${(basis.assumed ?? []).join(', ')}` : 'all from league',
        contrastShape,
        contrastVerdict,
        contrastFairness,
        moved:
          contrastFairness != null &&
          (Math.abs(contrastFairness - ownFairness) >= 1 || contrastVerdict !== labels.sideAdvantage),
      })
      process.stdout.write('.')
    } catch (e) {
      console.log(`\n  · ${t.tradeId} — threw: ${(e as Error).message}`)
    }
  }

  // ── 4. Report ──────────────────────────────────────────────────────────────────────
  const movedCount = results.filter((r) => r.moved).length
  const compared = results.filter((r) => r.contrastFairness != null).length

  const lines: string[] = []
  lines.push('# Trade grading batch — real imported trades\n')
  lines.push(`Graded **${results.length}** trades. Compared across two league shapes: **${compared}**.`)
  lines.push(
    `Verdict or fairness changed with the league shape on **${movedCount} of ${compared}** ` +
      `(${compared ? Math.round((movedCount / compared) * 100) : 0}%).\n`,
  )
  lines.push('| Trade | League (shape) | Verdict | Fair | Contrast shape | Verdict | Fair | Moved | Basis |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    lines.push(
      `| ${r.trade.giveNames.join(' + ')} → ${r.trade.getNames.join(' + ')} ` +
        `| ${r.trade.leagueName} — ${r.ownShape} | ${r.ownVerdict} | ${r.ownFairness ?? '—'} ` +
        `| ${r.contrastShape ?? '—'} | ${r.contrastVerdict ?? '—'} | ${r.contrastFairness ?? '—'} ` +
        `| ${r.moved ? '**yes**' : 'no'} | ${r.ownBasis} |`,
    )
  }

  const report = lines.join('\n') + '\n'
  writeFileSync(outPath, report, 'utf8')

  console.log(`\n\n${report}`)
  console.log(`Written to ${outPath}`)

  if (compared > 0 && movedCount === 0) {
    console.log(
      '\n⚠ NOT ONE trade changed with the league shape. That is the league-specific claim ' +
        'failing on real data — investigate before shipping it as a feature.',
    )
  }

  await prisma.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
