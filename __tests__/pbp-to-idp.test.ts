import { describe, it, expect } from 'vitest'
import { idpLinesFromGame } from '@/lib/idp/pbpToIdp'
import type { PbpGame, PbpPlay, PbpPlayer } from '@/lib/live/rollingInsightsPlayByPlay'

const player = (over: Partial<PbpPlayer> = {}): PbpPlayer => ({
  id: 101, name: 'Micah Parsons', role: 'defender', action: 'tackle',
  position: 'LB', teamAbbr: 'DAL', ...over,
})

const play = (over: Partial<PbpPlay> = {}): PbpPlay => ({
  sequence: 1, quarter: 1, gameClock: '14:00 - 1st', event: 'run',
  yardsGained: 3, yardLine: 'DAL 25', possession: 'Philadelphia Eagles',
  isTouchdown: false, isScoringPlay: false, isReturned: false, isReversed: false,
  description: '', players: [player()], pointsAfterType: null, ...over,
})

const game = (plays: PbpPlay[]): PbpGame => ({
  gameId: '20260920-1-26', awayTeamName: 'Philadelphia Eagles',
  homeTeamName: 'Dallas Cowboys', plays,
})

const statsFor = (g: PbpGame, id = '101') =>
  idpLinesFromGame(g).find((l) => l.playerId === id)?.stats ?? {}

describe('tackles', () => {
  it('credits a solo tackle when one defender made it', () => {
    expect(statsFor(game([play()]))).toEqual({ idp_solo_tackle: 1 })
  })

  it('splits a shared tackle into assists rather than paying both a solo', () => {
    // Crediting every tackle as solo would overstate every linebacker on the
    // stat IDP scoring weighs most heavily.
    const shared = play({ players: [player(), player({ id: 202, name: 'DaRon Bland' })] })
    const lines = idpLinesFromGame(game([shared]))
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(l.stats).toEqual({ idp_assist_tackle: 1 })
  })

  it('accumulates across plays', () => {
    expect(statsFor(game([play(), play({ sequence: 2 })]))).toEqual({ idp_solo_tackle: 2 })
  })
})

describe('sacks', () => {
  it('pays the sack, the tackle for loss, and the yardage', () => {
    const s = statsFor(game([play({ event: 'sack', yardsGained: -7, players: [player({ action: 'sack' })] })]))
    expect(s.idp_sack).toBe(1)
    expect(s.idp_tackle_for_loss).toBe(1)
    expect(s.idp_sack_yardage).toBe(7) // absolute, not negative
  })

  it('does not invent yardage when the play gained none', () => {
    const s = statsFor(game([play({ event: 'sack', yardsGained: null, players: [player({ action: 'sack' })] })]))
    expect(s.idp_sack_yardage).toBeUndefined()
  })
})

describe('turnovers', () => {
  it('credits an interception', () => {
    const s = statsFor(game([play({ event: 'interception', players: [player({ role: 'interceptor', action: 'intercepted' })] })]))
    expect(s.idp_interception).toBe(1)
  })

  it('credits a fumble recovery', () => {
    const s = statsFor(game([play({ event: 'fumble', players: [player({ role: 'recoverer', action: 'fumble_recovery' })] })]))
    expect(s.idp_fumble_recovery).toBe(1)
  })

  it('pays a defensive touchdown only to the defender who took it back', () => {
    const pick6 = play({
      event: 'interception', isTouchdown: true, isScoringPlay: true,
      players: [player({ role: 'interceptor', action: 'intercepted' })],
    })
    expect(statsFor(game([pick6])).idp_defensive_touchdown).toBe(1)
  })

  it('does NOT pay a defensive touchdown on an offensive score', () => {
    // A rushing TD still carries a tackler. Keying on isTouchdown alone would
    // hand the defense six points for being scored on.
    const rushTd = play({ event: 'run', isTouchdown: true, isScoringPlay: true })
    expect(statsFor(game([rushTd])).idp_defensive_touchdown).toBeUndefined()
  })
})

describe('what is deliberately NOT credited', () => {
  it('ignores role "fumbler" — the contract says it may mean who fumbled', () => {
    // GAPS N-06. Crediting this would give defensive points to the offense
    // that lost the ball.
    const s = statsFor(game([play({ event: 'fumble', players: [player({ role: 'fumbler', action: 'fumble' })] })]))
    expect(s.idp_forced_fumble).toBeUndefined()
    expect(s).toEqual({})
  })

  it('ignores "pressure" rather than counting a hurry as a QB hit', () => {
    const s = statsFor(game([play({ players: [player({ action: 'pressure' })] })]))
    expect(s.idp_qb_hit).toBeUndefined()
  })
})

describe('correctness guards', () => {
  it('drops reversed plays entirely', () => {
    // An overturned play did not happen, and nothing later removes its stats.
    expect(idpLinesFromGame(game([play({ isReversed: true })]))).toEqual([])
  })

  it('never returns a defender with an empty line', () => {
    const offenseOnly = play({ players: [player({ role: 'rusher', action: 'rush' })] })
    expect(idpLinesFromGame(game([offenseOnly]))).toEqual([])
  })

  it('keeps unidentified defenders separate instead of merging them', () => {
    const g = game([play({ players: [player({ id: null, name: 'A. Player' })] }),
                    play({ sequence: 2, players: [player({ id: null, name: 'B. Player' })] })])
    const lines = idpLinesFromGame(g)
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.playerId).sort()).toEqual(['name:A. Player', 'name:B. Player'])
  })

  it('carries identity through for the join', () => {
    const [line] = idpLinesFromGame(game([play()]))
    expect(line.playerName).toBe('Micah Parsons')
    expect(line.teamAbbr).toBe('DAL')
    expect(line.position).toBe('LB')
  })
})
