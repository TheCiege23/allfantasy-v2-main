/**
 * Seed-matrix runner for AllFantasy AI ADP.
 *
 * Runs the existing `seed-test-adp-drafts` + `recompute-allfantasy-adp` chain
 * across the full (sport × leagueType × draftType) matrix so the AI ADP cron
 * has at least one snapshot per resolver context shape.
 *
 * Default matrix (24 combinations):
 *   sports:      NFL, NBA, MLB, NHL, NCAAF, NCAAB   (SOCCER deferred — see memory)
 *   leagueType:  redraft, dynasty
 *   draftType:   snake, linear
 *
 * USAGE
 *   npm run seed:adp-matrix                              # dry-run summary
 *   npm run seed:adp-matrix -- --apply                   # write the matrix
 *   npm run seed:adp-matrix -- --apply --drafts=5        # smaller per-cell sample
 *   npm run seed:adp-matrix -- --apply --season=2026
 *   npm run seed:adp-matrix -- --apply --sports=NFL,NBA  # subset of sports
 *   npm run seed:adp-matrix -- --cleanup --apply         # remove all seeded leagues
 *
 * Each cell is seeded with `--mode=real` so the resolver picks them up. League
 * names + the `allfantasy_test_adp_seed` platform marker make cleanup easy.
 */

import { spawn } from 'node:child_process'

const DEFAULT_SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'] as const
const LEAGUE_TYPES = ['redraft', 'dynasty'] as const
const DRAFT_TYPES = ['snake', 'linear'] as const

interface CliOpts {
  apply: boolean
  cleanup: boolean
  drafts: number
  season: string
  sports: string[]
}

function parseCli(argv: string[]): CliOpts {
  const out: CliOpts = {
    apply: false,
    cleanup: false,
    drafts: 10,
    season: '2026',
    sports: [...DEFAULT_SPORTS],
  }
  for (const raw of argv) {
    if (raw === '--apply') out.apply = true
    else if (raw === '--cleanup') out.cleanup = true
    else if (raw.startsWith('--drafts=')) {
      const n = Number(raw.slice('--drafts='.length))
      if (Number.isFinite(n) && n > 0) out.drafts = n
    } else if (raw.startsWith('--season=')) {
      out.season = raw.slice('--season='.length)
    } else if (raw.startsWith('--sports=')) {
      out.sports = raw.slice('--sports='.length).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    }
  }
  return out
}

function runScript(scriptPath: string, args: string[]): Promise<{ code: number; stdout: string }> {
  // Children inherit our process.env (the parent was launched with `--env-file=.env`),
  // so we don't pass `--env-file` again — that flag expects a file in the child's CWD,
  // which may differ when this runner is invoked from a worktree.
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--require', './scripts/_audit-preload.cjs', '--import', 'tsx', scriptPath, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`exit ${code}: ${stderr || stdout}`))
        return
      }
      resolve({ code: code ?? 0, stdout })
    })
  })
}

function pluck(json: string, key: string): string | null {
  const m = json.match(new RegExp(`"${key}"\\s*:\\s*([^,\\n}]+)`))
  return m ? m[1].trim().replace(/[",]/g, '') : null
}

async function main() {
  const opts = parseCli(process.argv.slice(2))

  console.log('───────────────────────────────────────────────')
  console.log(' ADP seed matrix runner')
  console.log('───────────────────────────────────────────────')
  console.log(` Mode:       ${opts.cleanup ? 'cleanup' : opts.apply ? 'apply' : 'dry-run'}`)
  console.log(` Sports:     ${opts.sports.join(', ')}`)
  console.log(` Season:     ${opts.season}`)
  console.log(` Per-cell:   ${opts.drafts} drafts`)
  console.log(` Cells:      ${opts.sports.length} × ${LEAGUE_TYPES.length} × ${DRAFT_TYPES.length} = ${opts.sports.length * LEAGUE_TYPES.length * DRAFT_TYPES.length}`)
  console.log('───────────────────────────────────────────────')

  if (opts.cleanup) {
    if (!opts.apply) {
      console.log('Pass --apply to actually delete seeded leagues.')
      process.exit(0)
    }
    const out = await runScript('scripts/seed-test-adp-drafts.ts', ['--cleanup', '--apply', '--json'])
    const deleted = pluck(out.stdout, 'cleanupLeaguesDeleted') ?? '?'
    console.log(`Cleanup: deleted ${deleted} seeded leagues.`)
    return
  }

  const summary: Array<{ sport: string; leagueType: string; draftType: string; drafts: number; picks: number; written: number }> = []

  for (const sport of opts.sports) {
    for (const leagueType of LEAGUE_TYPES) {
      for (const draftType of DRAFT_TYPES) {
        const label = `${sport}/${leagueType}/${draftType}`
        const seedArgs = [
          `--sport=${sport}`,
          `--season=${opts.season}`,
          `--league-type=${leagueType}`,
          `--draft-type=${draftType}`,
          `--players-source=db`,
          `--mode=real`,
          `--drafts=${opts.drafts}`,
          `--json`,
        ]
        if (opts.apply) seedArgs.unshift('--apply')

        process.stdout.write(`[seed] ${label.padEnd(20)} ... `)
        const seed = await runScript('scripts/seed-test-adp-drafts.ts', seedArgs)
        const draftsCreated = Number(pluck(seed.stdout, 'draftsCreated') ?? '0')
        const picksCreated = Number(pluck(seed.stdout, 'picksCreated') ?? '0')
        process.stdout.write(`${draftsCreated} drafts / ${picksCreated} picks\n`)

        summary.push({ sport, leagueType, draftType, drafts: draftsCreated, picks: picksCreated, written: 0 })
      }
    }
  }

  if (opts.apply) {
    // One recompute per sport — aggregateAdp groups by (player, context, draftMode)
    // internally, so a single sport-level recompute produces snapshots for every
    // (leagueType × draftType) cell we just seeded.
    for (const sport of opts.sports) {
      process.stdout.write(`[recompute] ${sport.padEnd(8)} ... `)
      const rec = await runScript('scripts/recompute-allfantasy-adp.ts', [
        `--sport=${sport}`,
        `--season=${opts.season}`,
        `--draft-mode=real`,
        `--apply`,
        `--json`,
      ])
      const written = Number(pluck(rec.stdout, 'snapshotsWritten') ?? '0')
      process.stdout.write(`${written} snapshots\n`)
      // Distribute the writes back across the cells for that sport in the summary.
      for (const row of summary) if (row.sport === sport) row.written = Math.round(written / (LEAGUE_TYPES.length * DRAFT_TYPES.length))
    }
  }

  console.log('───────────────────────────────────────────────')
  console.log(' Matrix summary')
  console.log('───────────────────────────────────────────────')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error('[seed-adp-matrix] failed:', err)
  process.exit(1)
})
