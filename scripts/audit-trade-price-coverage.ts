/**
 * Trade price coverage audit — what the ONE trade grader can actually price, per league and asset.
 *
 * For each sampled league: every rostered player, future picks by round, and FAAB go through the
 * REAL pricer (`resolveAssets` on the league's own chart) and the REAL grader (a one-asset deal
 * against $1 FAAB, which always prices). One JSON line per asset: position group, whether it priced,
 * the value source, the value, the unpriced reason, and the grader's final verdict.
 *
 * 🛑 NEVER POINT THIS AT PRODUCTION. Some fallbacks write caches on a miss. Run it against a Neon
 * BRANCH copy: `AUDIT_DATABASE_URL` must be set, and the run refuses the production endpoint
 * (`ep-curly-block`, see CLAUDE.md). `DATABASE_URL`/`DIRECT_URL` are set from it BEFORE Prisma is
 * imported, so no `.env` can redirect it. IDP and kicker values read Sleeper's public roster API,
 * exactly as the app does on a page load.
 *
 *   AUDIT_DATABASE_URL=<branch url> AUDIT_LEAGUES=<afId,afId,...> AUDIT_OUT=<file.jsonl> \
 *     node --require ./scripts/_audit-preload.cjs ./node_modules/tsx/dist/cli.mjs scripts/audit-trade-price-coverage.ts
 */
import { appendFileSync, writeFileSync } from 'node:fs'

const url = process.env.AUDIT_DATABASE_URL ?? ''
const host = (() => { try { return new URL(url).host } catch { return '' } })()
if (!host) throw new Error('AUDIT_DATABASE_URL is required (a Neon BRANCH connection string).')
if (host.includes('ep-curly-block')) throw new Error(`Refusing: ${host} is the PRODUCTION endpoint.`)
process.env.DATABASE_URL = url
process.env.DIRECT_URL = url
process.env.VITEST_NO_DATABASE = '0'

const leagueIds = (process.env.AUDIT_LEAGUES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const out = process.env.AUDIT_OUT ?? 'price-coverage.jsonl'
if (leagueIds.length === 0) throw new Error('AUDIT_LEAGUES is required.')

const IDP = new Set(['LB', 'ILB', 'OLB', 'MLB', 'DL', 'DE', 'DT', 'EDGE', 'NT', 'DB', 'CB', 'S', 'SS', 'FS'])
const group = (pos: string | null | undefined, id: string) => {
  const p = String(pos ?? '').toUpperCase()
  if (/^[A-Z]{2,3}$/.test(id)) return 'DEF'
  if (['QB', 'RB', 'WR', 'TE'].includes(p)) return p
  if (p === 'K' || p === 'PK') return 'K'
  if (IDP.has(p)) return 'IDP'
  return p || 'UNKNOWN'
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const [{ serverHost }] = await prisma.$queryRawUnsafe<Array<{ serverHost: string }>>(`SELECT current_database() || '@' || coalesce(inet_server_addr()::text, '?') AS "serverHost"`)
  console.log(`[audit] connected: ${serverHost} via ${host}`)
  const { createLeagueTradeGrader } = await import('@/lib/decision-os/trade/leagueTradeGrader')
  const { resolveAssets } = await import('@/lib/trade-value-console/leagueTradePricing')
  const { normalizeToSupportedSport } = await import('@/lib/sport-scope')
  type Item = import('@/lib/trade-value-console/types').TradeAssetInput

  writeFileSync(out, '')
  for (const leagueId of leagueIds) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, name: true, leagueType: true, sport: true, settings: true } })
    if (!league) { console.log(`[audit] ${leagueId}: no league row`); continue }
    const grader = await createLeagueTradeGrader({ leagueId }).catch((e) => { console.log(`[audit] grader failed: ${e}`); return null })
    if (!grader) continue
    const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })
    const ids = [...new Set(rosters.flatMap((r) => {
      const pd = r.playerData as { players?: unknown } | null
      return Array.isArray(pd?.players) ? pd!.players.map(String) : []
    }))]
    const rows = await prisma.$queryRawUnsafe<Array<{ sid: string; name: string | null; position: string | null }>>(
      `SELECT s.sid, coalesce(sp.name, p.name) AS name, coalesce(sp.position, p.position) AS position
         FROM unnest($1::text[]) AS s(sid)
         LEFT JOIN sports_players sp ON sp.id = 'NFL:' || s.sid
         LEFT JOIN LATERAL (SELECT name, position FROM "SportsPlayer" WHERE "sleeperId" = s.sid LIMIT 1) p ON true`, ids)
    const idpLineup = JSON.stringify((league.settings as { roster_positions?: unknown } | null)?.roster_positions ?? []).match(/"(LB|DL|DB|IDP_FLEX|DE|DT|CB|S)"/) != null
    const base = { leagueId, league: league.name, leagueType: league.leagueType ?? '?', idpLineup }
    const opts = {
      effectiveSport: normalizeToSupportedSport(league.sport),
      nflCtx: grader.chart.nflCtx, waiverBudget: grader.chart.waiverBudget, dataGaps: [] as string[],
      fcPlayers: grader.chart.fcPlayers, resolveEnrichmentIds: false,
    }
    const probe = async (item: Item, meta: Record<string, unknown>) => {
      const started = Date.now()
      const r = await resolveAssets([item], { ...opts, dataGaps: [] }).catch((e) => ({ error: String(e) }) as const)
      const verdict = await grader.grade({ give: [item], get: [{ kind: 'faab', amount: 1 }], viewerSide: false }).catch((e) => ({ graded: false, reason: `THREW ${e}` }))
      const priced = 'priced' in r ? r.priced[0] : undefined
      const line = 'lines' in r ? r.lines[0] : undefined
      appendFileSync(out, JSON.stringify({
        ...base, ...meta,
        resolved: 'unresolved' in r ? r.unresolved.length === 0 : false,
        error: 'error' in r ? r.error : null,
        source: priced?.source ?? null,
        value: priced?.value ?? null,
        unpriced: priced?.unpriced === true,
        unpricedReason: priced?.unpricedReason ? (priced.unpricedReason as { code?: string; label?: string }).code ?? (priced.unpricedReason as { label?: string }).label ?? String(priced.unpricedReason) : null,
        lineDataSource: (line as { dataSource?: string } | undefined)?.dataSource ?? null,
        projectionScope: (line as { projectionScope?: unknown } | undefined)?.projectionScope ?? null,
        graded: verdict.graded === true,
        withheld: verdict.graded ? null : (verdict as { reason: string }).reason,
        ms: Date.now() - started,
      }) + '\n')
    }
    const players = rows.map((p) => ({ ...p, grp: group(p.position, p.sid) }))
    let i = 0
    const next = async (): Promise<void> => {
      while (i < players.length) {
        const p = players[i++]!
        await probe(
          { kind: 'player', name: p.name ?? `Player ${p.sid}`, providerIdentity: { provider: 'sleeper', id: p.sid, ...(p.position ? { position: p.position } : {}) } },
          { asset: 'player', sid: p.sid, name: p.name, position: p.position, grp: p.grp },
        )
      }
    }
    await Promise.all([next(), next(), next(), next()])
    for (const year of [2026, 2027, 2028]) for (const round of [1, 2, 3, 4, 5, 6]) {
      await probe({ kind: 'pick', year, round }, { asset: 'pick', grp: `PICK ${year}`, round })
    }
    await probe({ kind: 'faab', amount: 10 }, { asset: 'faab', grp: 'FAAB' })
    console.log(`[audit] ${league.name} (${league.leagueType}, idp=${idpLineup}): ${players.length} players done`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error('[audit] FAILED', e); process.exit(1) })
