/**
 * Compare AF's weekly projection readers and list evidence-backed gaps across the seven sports.
 * node --require ./scripts/_audit-preload.cjs --import tsx scripts/report-projection-coverage.ts [--json] [--sport NFL] [--league-id ID]
 */
import { prisma } from '@/lib/prisma'
import { isSupportedSport } from '@/lib/sport-scope'
import { buildProjectionCoverageReport } from '@/lib/production-health/projectionCoverageReport'

import { formatProjectionCoverage } from '@/lib/production-health/formatProjectionCoverage'

async function main() {
  const argv = process.argv.slice(2)
  const option = (name: string) => {
    const index = argv.indexOf(name)
    if (index === -1) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(name + ' requires a value')
    return value
  }
  const sport = option('--sport')?.toUpperCase()
  const leagueId = option('--league-id')
  if (sport != null && !isSupportedSport(sport)) throw new Error('Unknown sport ' + sport)
  if (leagueId && !sport) throw new Error('--league-id requires --sport')
  const report = await buildProjectionCoverageReport({ sport, leagueId })
  const output = argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatProjectionCoverage(report)
  const file = option('--out')
  if (file) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, output, 'utf8')
  } else {
    process.stdout.write(output)
  }
  if (report.sports.some(s => s.state === 'read_failed')) process.exitCode = 1
}

main().catch(err => { console.error(err.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
