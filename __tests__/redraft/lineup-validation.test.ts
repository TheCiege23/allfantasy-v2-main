import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyRedraftLineupMoves,
  validateRedraftLineup,
  type RedraftLineupPlayer,
} from '@/lib/redraft/lineupValidation'

function player(overrides: Partial<RedraftLineupPlayer> & Pick<RedraftLineupPlayer, 'playerId' | 'position' | 'slotType'>): RedraftLineupPlayer {
  return {
    playerName: overrides.playerId,
    sport: 'NFL',
    injuryStatus: null,
    byeWeek: null,
    isLocked: false,
    ...overrides,
  }
}

function legalNflLineup(overrides: Partial<Record<string, Partial<RedraftLineupPlayer>>> = {}): RedraftLineupPlayer[] {
  const rows = [
    player({ playerId: 'qb-1', playerName: 'QB One', position: 'QB', slotType: 'QB' }),
    player({ playerId: 'rb-1', playerName: 'RB One', position: 'RB', slotType: 'RB' }),
    player({ playerId: 'wr-1', playerName: 'WR One', position: 'WR', slotType: 'WR' }),
    player({ playerId: 'wr-2', playerName: 'WR Two', position: 'WR', slotType: 'WR' }),
    player({ playerId: 'te-1', playerName: 'TE One', position: 'TE', slotType: 'TE' }),
    player({ playerId: 'def-1', playerName: 'Defense One', position: 'DEF', slotType: 'DEF' }),
    player({ playerId: 'bench-1', playerName: 'Bench One', position: 'WR', slotType: 'bench' }),
    player({ playerId: 'bench-rb-2', playerName: 'RB Two', position: 'RB', slotType: 'bench' }),
    player({ playerId: 'bench-k-1', playerName: 'K One', position: 'K', slotType: 'bench' }),
  ]
  return rows.map((row) => ({ ...row, ...(overrides[row.playerId] ?? {}) }))
}

describe('redraft lineup validation', () => {
  it('accepts a legal NFL lineup with required QB/RB/WR starters', () => {
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: legalNflLineup() })

    expect(result.ok).toBe(true)
    expect(result.errorCount).toBe(0)
  })

  it('rejects a lineup missing a required QB starter', () => {
    const rows = legalNflLineup({ 'qb-1': { slotType: 'bench' } })
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('missing_required_position')
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('QB is required')
  })

  it('rejects illegal starter slot eligibility', () => {
    const rows = legalNflLineup({ 'rb-1': { slotType: 'QB' }, 'qb-1': { slotType: 'RB' } })
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('starter_position_ineligible')
  })

  it('blocks moving a locked player', () => {
    const rows = legalNflLineup({ 'bench-1': { isLocked: true } })
    const applied = applyRedraftLineupMoves(rows, [{ playerId: 'bench-1', fromSlot: 'bench', toSlot: 'WR' }])
    const result = validateRedraftLineup({
      sport: 'NFL',
      week: 4,
      players: applied.players,
      previousPlayers: rows,
      extraIssues: applied.issues,
    })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('locked_player_move')
  })

  it('rejects a starter on bye week', () => {
    const rows = legalNflLineup({ 'rb-1': { byeWeek: 4 } })
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('starter_on_bye')
  })

  it('rejects out starters and warns on questionable starters', () => {
    const outResult = validateRedraftLineup({
      sport: 'NFL',
      week: 4,
      players: legalNflLineup({ 'wr-1': { injuryStatus: 'OUT' } }),
    })
    const questionableResult = validateRedraftLineup({
      sport: 'NFL',
      week: 4,
      players: legalNflLineup({ 'wr-1': { injuryStatus: 'Questionable' } }),
    })

    expect(outResult.ok).toBe(false)
    expect(outResult.issues.map((issue) => issue.code)).toContain('starter_ineligible_injury')
    expect(questionableResult.ok).toBe(true)
    expect(questionableResult.warningCount).toBe(1)
    expect(questionableResult.issues[0]?.code).toBe('starter_injury_risk')
  })
})

describe('redraft roster route lineup enforcement contract', () => {
  const routeSource = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/roster/route.ts'), 'utf8')
  const rosterManagerSource = fs.readFileSync(
    path.join(process.cwd(), 'app/league/[leagueId]/tabs/redraft/RosterManager.tsx'),
    'utf8',
  )

  it('validates before persisting lineup PATCH moves', () => {
    expect(routeSource).toContain('applyRedraftLineupMoves')
    expect(routeSource).toContain('validateRedraftLineup')
    expect(routeSource).toContain("error: 'Illegal lineup'")
    expect(routeSource).toContain('{ status: 422 }')
  })

  it('returns automatic lineup validation on roster reads', () => {
    expect(routeSource).toContain('lineupValidation')
    expect(routeSource).toContain('hydrateCurrentInjuryStatuses')
  })

  it('Phase 2H: writes lineup-history after a successful save, wrapped so a history-write failure cannot fail the response', () => {
    expect(routeSource).toContain('recordRedraftRosterMoveHistory')
    // The write call must appear after the persisting transaction and be
    // inside a try/catch (docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md
    // §2c: "existing roster save behavior remains unchanged" if history-writing fails).
    const transactionIdx = routeSource.indexOf('prisma.$transaction(')
    const historyCallIdx = routeSource.indexOf('recordRedraftRosterMoveHistory(')
    const tryIdx = routeSource.lastIndexOf('try {', historyCallIdx)
    const catchIdx = routeSource.indexOf('} catch', historyCallIdx)
    expect(transactionIdx).toBeGreaterThan(-1)
    expect(historyCallIdx).toBeGreaterThan(transactionIdx)
    expect(tryIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(historyCallIdx)
  })

  it('surfaces validation state in the redraft roster UI', () => {
    expect(rosterManagerSource).toContain('Lineup legal')
    expect(rosterManagerSource).toContain('lineup issue')
    expect(rosterManagerSource).toContain('playerIssueMap')
  })
})
