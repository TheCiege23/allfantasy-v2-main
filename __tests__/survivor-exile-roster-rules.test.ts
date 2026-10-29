import { describe, expect, it } from 'vitest'
import { addExilePlayer, dropExilePlayer, emptyExileRoster, isExileAnchor, readExileRoster } from '@/lib/survivor/exileRosterRules'

const qb = { id: 'qb', name: 'Quarterback', position: 'QB', team: 'BUF' }
const receiver = { id: 'wr', name: 'Receiver', position: 'WR', team: 'BUF' }

describe('Exile team rights', () => {
  it('uses the user-approved anchors for each sport, including multi-position guards', () => {
    expect(isExileAnchor('NFL', 'QB')).toBe(true)
    expect(isExileAnchor('NBA', 'PG/SG')).toBe(true)
    expect(isExileAnchor('NBA', 'C')).toBe(false)
    expect(isExileAnchor('NHL', 'G')).toBe(true)
    // MLB pitchers are stored as plain P; a feed that labels the role still anchors.
    expect(isExileAnchor('MLB', 'P')).toBe(true)
    expect(isExileAnchor('MLB', 'SP')).toBe(true)
    expect(isExileAnchor('MLB', 'RP')).toBe(true)
    expect(isExileAnchor('MLB', 'C')).toBe(false)
    expect(isExileAnchor('MLB', 'SS')).toBe(false)
    expect(() => addExilePlayer(emptyExileRoster(), { id: 'c', name: 'Catcher', position: 'C', team: 'NYY' }, 'MLB', {}, [])).toThrow('Pitcher first')
  })
  it('requires the anchor, awards only that player, then allows individual teammates', () => {
    expect(() => addExilePlayer(emptyExileRoster(), receiver, 'NFL', {}, [])).toThrow('Quarterback first')
    const roster = addExilePlayer(emptyExileRoster(), qb, 'NFL', {}, [])
    expect(roster.players.map(p => p.id)).toEqual(['qb'])
    expect(addExilePlayer(roster, receiver, 'NFL', {}, []).players).toHaveLength(2)
  })
  it('never takes a reserved team or allows mixing teams', () => {
    expect(() => addExilePlayer(emptyExileRoster(), qb, 'NFL', {}, ['BUF'])).toThrow('reserved')
    const roster = addExilePlayer(emptyExileRoster(), qb, 'NFL', {}, [])
    expect(() => addExilePlayer(roster, { ...receiver, team: 'KC' }, 'NFL', {}, [])).toThrow('different team')
  })
  it('releases teammates with the anchor and then allows a different team', () => {
    const roster = addExilePlayer(addExilePlayer(emptyExileRoster(), qb, 'NFL', {}, []), receiver, 'NFL', {}, [])
    expect(dropExilePlayer(roster, receiver.id).players.map(p => p.id)).toEqual(['qb'])
    const released = dropExilePlayer(roster, qb.id)
    expect(released).toEqual(emptyExileRoster())
    expect(addExilePlayer(released, { ...qb, id: 'new', team: 'KC' }, 'NFL', {}, []).team).toBe('KC')
  })
  it('enforces commissioned slot capacity, player eligibility, duplicates, and closed weeks', () => {
    const settings = { starter_slots: { QB: 1, WR: 1, BN: 1 } }
    const roster = addExilePlayer(addExilePlayer(emptyExileRoster(), qb, 'NFL', settings, []), receiver, 'NFL', settings, [])
    expect(() => addExilePlayer(roster, receiver, 'NFL', settings, [])).toThrow('already')
    expect(() => addExilePlayer(roster, { ...receiver, id: 'wr2' }, 'NFL', settings, [], 'QB')).toThrow('eligible')
    const full = addExilePlayer(roster, { ...receiver, id: 'wr2' }, 'NFL', settings, [])
    expect(full.players.at(-1)?.slot).toBe('BENCH')
    expect(() => addExilePlayer(full, { ...receiver, id: 'wr3' }, 'NFL', settings, [])).toThrow('space')
    expect(() => dropExilePlayer({ ...roster, closedAt: '2026-10-20T04:00:00Z' }, 'qb')).toThrow('ended')
    expect(readExileRoster({ playerIds: ['forged'] })).toBeNull()
  })
})
