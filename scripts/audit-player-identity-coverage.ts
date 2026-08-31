/**
 * Phase 0.2 — player-identity coverage, measured rather than assumed.
 *
 * Answers the question that gates the whole unified-value contract (D13):
 * if Decision OS keys every value on `PlayerIdentityMap.id`, how many players
 * actually resolve — and, far more importantly, how many players that REAL
 * ROSTERS REFERENCE resolve?
 *
 * ⚠ THOSE TWO NUMBERS ARE NOT THE SAME AND THE SECOND IS THE ONE THAT MATTERS.
 * A registry that is 95% complete across all rows can still fail every roster
 * in a college league if the missing 5% is exactly the population those
 * rosters draw from. `lib/devy/devyValueBoard.ts` records the precedent:
 * `DevyPlayer.devyValue` is zero for 1,455 of 1,718 players, and the board
 * looked fine in aggregate while showing 85% of managers a confident zero.
 *
 * 🛑 READ-ONLY. Counts, groupBys and bounded selects. No create/update/delete,
 * no $executeRaw, no schema access.
 *
 * 🛑 IT WILL NOT RUN OFF `.env`, AND THAT IS DELIBERATE. Importing
 * `@prisma/client` populates `process.env.DATABASE_URL` from `.env` on import
 * — in this repo that is the PRODUCTION endpoint, and two sessions have
 * already reached it by accident (see CLAUDE.md). So the client here is
 * constructed with an EXPLICIT `datasourceUrl` from `AF_IDENTITY_AUDIT_DB`,
 * and refuses to start without it. Naming the database IS the opt-in, the
 * same reason `vitest.setup.db-guard.ts` pins the unset case rather than
 * sniffing a hostname.
 *
 *   PowerShell (primary shell here):
 *     $env:AF_IDENTITY_AUDIT_USE_ENV = "1"; npx tsx scripts/audit-player-identity-coverage.ts
 *   bash:
 *     AF_IDENTITY_AUDIT_USE_ENV=1 npx tsx scripts/audit-player-identity-coverage.ts
 *
 * Run with no opt-in to print the full usage, including the explicit-URL form.
 *
 * Output is a table per sport. Credentials are never printed — host only.
 */
import { PrismaClient } from '@prisma/client'
// The registry's OWN normalizer. Pure, no imports of its own, so it is safe in a
// script — and using it rather than a local lowercase is what keeps this audit's
// notion of "same name" identical to the writer's.
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * TWO ways to name a target, and NEITHER is a default. The guard exists to stop
 * an ACCIDENTAL run, not to keep a secret — so both forms are equally explicit
 * and the script still refuses when neither is present.
 *
 *   AF_IDENTITY_AUDIT_DB="postgresql://…"   an explicit URL you supply
 *   AF_IDENTITY_AUDIT_USE_ENV=1             use whatever .env resolves to
 *
 * ⚠ PREFER THE SECOND WHEN THE TARGET IS THE APP'S OWN DATABASE. The first form
 * requires someone (or some agent) to lift a live credential into a shell
 * variable and a process argument, where it lands in shell history and process
 * listings. The second lets prisma read `.env` itself and keeps the credential
 * out of every intermediate surface. Same deliberateness, strictly less
 * exposure.
 */
const EXPLICIT_URL = process.env.AF_IDENTITY_AUDIT_DB?.trim()
const USE_ENV = process.env.AF_IDENTITY_AUDIT_USE_ENV?.trim() === '1'

if (!EXPLICIT_URL && !USE_ENV) {
  console.error(
    [
      '',
      'REFUSED: no target named.',
      '',
      'This script will not silently fall back to DATABASE_URL, because in this repo',
      'that resolves to the production endpoint via .env on prisma import — twice now,',
      'sessions have reached production believing they were local (see CLAUDE.md).',
      'Naming the database IS the opt-in. Pick one:',
      '',
      '  A) use whatever .env / .env.local resolves to — prisma reads it itself, so no',
      '     credential passes through your shell:',
      '',
      '       PowerShell   $env:AF_IDENTITY_AUDIT_USE_ENV = "1"; npx tsx scripts/audit-player-identity-coverage.ts',
      '       bash/sh      AF_IDENTITY_AUDIT_USE_ENV=1 npx tsx scripts/audit-player-identity-coverage.ts',
      '',
      '  B) an explicit target, for a database .env does not point at:',
      '',
      '       PowerShell   $env:AF_IDENTITY_AUDIT_DB = "postgresql://…"; npx tsx scripts/audit-player-identity-coverage.ts',
      '       bash/sh      AF_IDENTITY_AUDIT_DB="postgresql://…" npx tsx scripts/audit-player-identity-coverage.ts',
      '',
      '⚠ PowerShell has NO inline env-var prefix. `VAR=1 cmd` is parsed as a command',
      '  named "VAR=1" and fails with CommandNotFoundException. Use the $env: form.',
      '',
    ].join('\n'),
  )
  process.exit(2)
}

/** Host only — never the credential. */
function safeHost(url: string | undefined): string {
  if (!url) return '<from .env, not read by this script>'
  try {
    return new URL(url).host
  } catch {
    return '<unparseable url>'
  }
}

// With USE_ENV the client is constructed with no datasource override, so prisma
// loads `.env` itself and the URL never enters this process's own variables.
const prisma = EXPLICIT_URL ? new PrismaClient({ datasourceUrl: EXPLICIT_URL }) : new PrismaClient()

/** The id spaces `PlayerIdentityMap` carries, in the order they were added. */
const ID_SPACES = [
  'sleeperId',
  'fantasyCalcId',
  'rollingInsightsId',
  'apiSportsId',
  'mflId',
  'espnId',
  'fleaflickerId',
  'clearSportsId',
  'cfbdId',
  'fantraxId',
] as const

function pct(n: number, d: number): string {
  if (d === 0) return '   n/a'
  return `${((n / d) * 100).toFixed(1).padStart(5)}%`
}

async function registryCoverage() {
  console.log('\n=== A. REGISTRY COVERAGE — PlayerIdentityMap rows, by sport and id space ===\n')

  const bySport = await prisma.playerIdentityMap.groupBy({
    by: ['sport'],
    _count: { _all: true },
  })
  bySport.sort((a, b) => b._count._all - a._count._all)

  const header = [
    'sport'.padEnd(9),
    'rows'.padStart(8),
    ...ID_SPACES.map((s) => s.replace(/Id$/, '').padStart(9)),
    'name+team'.padStart(10),
    'NO ROUTE'.padStart(10),
  ]
  console.log(header.join(' '))
  console.log('-'.repeat(header.join(' ').length))

  for (const row of bySport) {
    const sport = row.sport ?? '(null)'
    const total = row._count._all
    const cells: string[] = []
    for (const space of ID_SPACES) {
      const n = await prisma.playerIdentityMap.count({
        where: { sport: row.sport, [space]: { not: null } } as never,
      })
      cells.push(pct(n, total).padStart(9))
    }

    /**
     * 🛑 THE TWO COLUMNS THAT STOP THIS AUDIT LYING ABOUT A HEALTHY REGISTRY.
     *
     * The ten id columns above are not the only way to reach a row.
     * `lib/sports-data/ncaafIdentityWidening` (7beaa8811) deliberately inserts
     * rows carrying ONLY canonicalName / normalizedName / currentTeam /
     * position / sport, because its whole design is resolution by
     * **(name, team)** — and it is insert-only precisely so it never
     * overwrites provider ids it knows nothing about.
     *
     * Measured 2026-08-31, that backfill added ~4,234 NCAAF rows between two
     * runs of THIS script, and the id-space columns reported every one of them
     * as unreachable. The measurement was right; the conclusion a reader would
     * draw from it — "the widening produced tens of thousands of junk rows" —
     * was false. An audit that is correct about its numbers and wrong about the
     * world is harder to dismiss than a broken one, because nobody has cause to
     * doubt it.
     *
     * So `name+team` is reported as a first-class route, and `NO ROUTE` is the
     * only column that should ever raise an alarm: no id in any space AND no
     * usable (name, team) pair. That is genuinely unreachable.
     */
    const nameTeam = await prisma.playerIdentityMap.count({
      where: { sport: row.sport, currentTeam: { not: null }, normalizedName: { not: '' } } as never,
    })
    const noRoute = await prisma.playerIdentityMap.count({
      where: {
        sport: row.sport,
        ...Object.fromEntries(ID_SPACES.map((s) => [s, null])),
        OR: [{ currentTeam: null }, { normalizedName: '' }],
      } as never,
    })

    console.log(
      [
        sport.padEnd(9),
        String(total).padStart(8),
        ...cells,
        pct(nameTeam, total).padStart(10),
        (noRoute === 0 ? '     none' : pct(noRoute, total)).padStart(10),
      ].join(' '),
    )
  }

  console.log(
    [
      '',
      'name+team = reachable by the (name, team) path even with zero external ids.',
      'NO ROUTE  = no id in ANY space AND no usable (name, team) pair. This is the',
      '            only column that means a row is genuinely unreachable. A low id',
      '            percentage beside a high name+team percentage is a registry doing',
      '            its job, not a broken one.',
    ].join('\n'),
  )
}

/**
 * The number that actually gates D13: of the player ids sitting in real
 * `Roster.playerData` blobs, how many reach a `PlayerIdentityMap` row?
 *
 * ⚠ `Roster.playerData` IS JSON, NOT A RELATION. There is no join from a
 * roster to a player anywhere in the schema, and the id space inside the blob
 * differs by the league's provider. So this samples rather than aggregates,
 * and reports the sample size next to every figure — a coverage number
 * without its n is not a measurement.
 */
async function rosterCoverage(sampleLeagues: number) {
  console.log(`\n=== B. ROSTER-REFERENCED COVERAGE — sample of ${sampleLeagues} leagues per sport ===\n`)

  const sports = await prisma.league.groupBy({ by: ['sport'], _count: { _all: true } })

  for (const s of sports) {
    const leagues = await prisma.league.findMany({
      where: { sport: s.sport },
      select: { id: true, sport: true, platform: true },
      take: sampleLeagues,
      orderBy: { updatedAt: 'desc' },
    })
    // ⚠ Report the empty case rather than `continue`-ing past it. The first run
    // silently dropped MLB, NHL and NCAAB from this table entirely, which reads
    // as "not measured" and is indistinguishable from "measured and fine".
    if (leagues.length === 0) {
      console.log(`${String(s.sport).padEnd(8)} NO LEAGUES — nothing to sample`)
      continue
    }

    const rosters = await prisma.roster.findMany({
      where: { leagueId: { in: leagues.map((l) => l.id) } },
      select: { leagueId: true, playerData: true },
      take: 400,
    })

    /** Pull every plausible player id out of an unknown JSON shape. */
    const ids = new Set<string>()
    for (const r of rosters) {
      const walk = (v: unknown, depth: number): void => {
        if (depth > 4 || v == null) return
        if (typeof v === 'string' || typeof v === 'number') {
          const t = String(v).trim()
          if (t && t.length <= 32) ids.add(t)
          return
        }
        if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
        if (typeof v === 'object') {
          for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            // Only descend into keys that plausibly hold an id or a player list.
            if (/id$|ids$|player|starter|bench|taxi|ir$|roster/i.test(k)) walk(x, depth + 1)
          }
        }
      }
      walk(r.playerData, 0)
    }

    const sample = [...ids].slice(0, 3000)
    if (sample.length === 0) {
      console.log(`${String(s.sport).padEnd(8)} leagues=${leagues.length}  rosters=${rosters.length}  NO IDS EXTRACTED`)
      continue
    }

    /**
     * How many of those ids land on a registry row in each id space?
     *
     * 🛑 COUNT THE SAMPLE SIDE, NEVER THE ROW SIDE. The first version of this
     * used `count({ where: { [space]: { in: sample } } })`, which counts
     * REGISTRY ROWS, and only `sleeperId` is unique — so one id matching three
     * rows counted three times. Measured against production 2026-08-31 it
     * reported 2,975 resolved out of 1,456 candidates: **204.3%**, a coverage
     * rate above 100%.
     *
     * That absurdity is the only reason it was caught. Had the duplication
     * been milder the number would have looked entirely plausible and gone
     * into the plan as fact. Selecting the matched VALUES and de-duplicating
     * them makes the ratio structurally incapable of exceeding 1.
     */
    const hits: Record<string, number> = {}
    for (const space of ID_SPACES) {
      const rows = await prisma.playerIdentityMap.findMany({
        where: { [space]: { in: sample } } as never,
        select: { [space]: true } as never,
      })
      const distinct = new Set<string>()
      for (const r of rows as unknown as Record<string, string | null>[]) {
        const v = r[space]
        if (typeof v === 'string' && v) distinct.add(v)
      }
      hits[space] = distinct.size
    }
    const best = Object.entries(hits).sort((a, b) => b[1] - a[1])
    const resolvedAny = best[0]?.[1] ?? 0
    if (resolvedAny > sample.length) {
      console.log(`         🛑 INVALID: resolved (${resolvedAny}) exceeds sample (${sample.length}). Do not use this row.`)
    }

    /**
     * The (name, team) route, measured on the roster side.
     *
     * Uses the registry's OWN `normalizePlayerName` rather than a local
     * lowercase — a normalizer that differs from the one the writer used
     * would report a mismatch that does not exist in the product, which is a
     * subtler version of the same false alarm this column exists to prevent.
     *
     * ⚠ NAME ALONE, NOT (name, team), AND THE GAP IS DELIBERATE. A roster blob
     * carries a player's name but rarely their school in a field this walker
     * can identify. Resolving on name alone therefore OVER-counts — 7beaa8811
     * measured 4,925 of 7,248 colliding NCAAF names (67.9%) as different people
     * at different schools. So this is an UPPER BOUND on the name route, and is
     * printed as one. It answers "could the name route reach anything here",
     * never "how many resolve correctly".
     */
    const names = new Set<string>()
    for (const r of rosters) {
      const walkNames = (v: unknown, depth: number): void => {
        if (depth > 4 || v == null) return
        if (Array.isArray(v)) return v.forEach((x) => walkNames(x, depth + 1))
        if (typeof v === 'object') {
          for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            if (typeof x === 'string' && /name/i.test(k) && !/team|school|league|owner/i.test(k)) {
              const n = normalizePlayerName(x)
              if (n && n.includes(' ')) names.add(n)
            } else if (typeof x === 'object') walkNames(x, depth + 1)
          }
        }
      }
      walkNames(r.playerData, 0)
    }

    if (names.size > 0) {
      const nameSample = [...names].slice(0, 3000)
      const matched = await prisma.playerIdentityMap.findMany({
        where: { sport: s.sport, normalizedName: { in: nameSample } } as never,
        select: { normalizedName: true },
      })
      const distinctNames = new Set(matched.map((m) => m.normalizedName))
      console.log(
        `         name route: ${String(distinctNames.size).padStart(5)} of ${String(nameSample.length).padStart(5)} names ` +
          `(${pct(distinctNames.size, nameSample.length)}) — UPPER BOUND, name alone`,
      )
    } else {
      console.log(`         name route: no names extracted from these blobs`)
    }

    console.log(
      `${String(s.sport).padEnd(8)} leagues=${String(leagues.length).padStart(3)} rosters=${String(rosters.length).padStart(4)} ` +
        `candidate-ids=${String(sample.length).padStart(5)}  best-space=${(best[0]?.[0] ?? '-').padEnd(18)} ` +
        `resolved=${String(resolvedAny).padStart(5)} (${pct(resolvedAny, sample.length)})`,
    )
    const runnersUp = best.slice(1, 4).filter(([, n]) => n > 0)
    if (runnersUp.length) {
      console.log(`         also: ${runnersUp.map(([k, n]) => `${k}=${n}`).join('  ')}`)
    }
  }

  console.log(
    [
      '',
      '⚠ Candidate-ids is an UPPER BOUND on real player ids — the walker cannot know',
      '  which JSON keys are ids, so it over-collects. A low resolved% therefore means',
      '  "not proven to resolve", not "proven broken". Treat B as a screen that tells',
      '  you which sport to investigate properly, never as the published figure.',
    ].join('\n'),
  )
}

async function main() {
  console.log(`\nPlayer identity coverage audit`)
  console.log(`target: ${EXPLICIT_URL ? safeHost(EXPLICIT_URL) : 'resolved by prisma from .env (AF_IDENTITY_AUDIT_USE_ENV=1)'}`)
  console.log(`mode: READ-ONLY (count / groupBy / bounded select)`)

  await registryCoverage()
  await rosterCoverage(25)

  console.log('\nDone. Record these figures with their date and sample in the plan file,')
  console.log('the way lib/values/publishedValueEvidence.ts records its own.\n')
}

main()
  .catch((e) => {
    console.error('\nAudit failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
