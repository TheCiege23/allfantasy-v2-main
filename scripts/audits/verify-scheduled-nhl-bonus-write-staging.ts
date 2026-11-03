/** Reversible staging write probe: remove one verified bonus, reconcile it, restore original JSON. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enrichOfficialNhlGameWinningGoals } from '@/lib/nhl-scoring/officialGameWinningGoalsIngest'
import targetGuard from '../db-target-identity.cjs'

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const correction = process.argv.includes('--correction-probe')
  const date = '2026-10-19'
  const boxes = await prisma.playerGameStat.findMany({ where: { sportType: 'NHL',
    source: 'rolling_insights_live', gameDate: new Date(`${date}T00:00:00Z`),
    gameId: { endsWith: ':skaters' } },
  select: { id: true, updatedAt: true, normalizedStatMap: true } })
  const selected = boxes.find((box) => {
    const outer = record(box.normalizedStatMap)
    return record(outer?.officialGameWinningGoals)?.source === 'nhl_stats_rest_game_summary_v1' &&
      typeof record(outer?.stats)?.game_winning_goals === 'number' &&
      (!correction || (record(outer?.stats)?.goals as number) >= 1)
  })
  assert.ok(selected, 'NO_VERIFIED_STAGING_NHL_BOX')
  const original = record(selected.normalizedStatMap)!
  const stats = record(original.stats)!
  const marker = randomUUID()
  const { game_winning_goals: _removed, ...withoutBonus } = stats
  const { officialGameWinningGoals: _proof, ...withoutProof } = original
  const perturbed = correction ? { ...original,
    stats: { ...stats, game_winning_goals: stats.game_winning_goals === 1 ? 0 : 1 } } :
    { ...withoutProof, stats: withoutBonus }
  const cleared = await prisma.playerGameStat.updateMany({
    where: { id: selected.id, updatedAt: selected.updatedAt },
    data: { normalizedStatMap: { ...perturbed,
      qaNhlBonusRepairProbe: marker } as Prisma.InputJsonValue },
  })
  assert.equal(cleared.count, 1, 'STAGING_BOX_CHANGED_BEFORE_PROBE')
  let restored = false
  try {
    const result = await enrichOfficialNhlGameWinningGoals({ dates: [date] })
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
    assert.equal(result.written, 1, JSON.stringify(result))
    if (correction) assert.equal(result.corrected, 1, JSON.stringify(result))
    const current = await prisma.playerGameStat.findUniqueOrThrow({ where: { id: selected.id },
      select: { normalizedStatMap: true } })
    const currentOuter = record(current.normalizedStatMap)
    assert.equal(record(currentOuter?.stats)?.game_winning_goals, stats.game_winning_goals)
    assert.equal(record(currentOuter?.officialGameWinningGoals)?.source,
      'nhl_stats_rest_game_summary_v1')
    restored = true
    console.log(JSON.stringify({ date, mode: correction ? 'correction' : 'missing_value',
      restoredByScheduledIngest: restored, corrected: result.corrected,
      cacheHits: result.cacheHits, fetchedDates: result.fetchedDates,
      written: result.written, matched: result.matched }, null, 2))
  } finally {
    const current = await prisma.playerGameStat.findUnique({ where: { id: selected.id },
      select: { normalizedStatMap: true, updatedAt: true } })
    if (current && record(current.normalizedStatMap)?.qaNhlBonusRepairProbe === marker) {
      const result = await prisma.playerGameStat.updateMany({ where: {
        id: selected.id, updatedAt: current.updatedAt },
      data: { normalizedStatMap: original as Prisma.InputJsonValue } })
      assert.equal(result.count, 1, 'STAGING_PROBE_CLEANUP_RACED')
    }
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
