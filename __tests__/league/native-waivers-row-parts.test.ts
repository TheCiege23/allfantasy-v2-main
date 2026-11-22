/**
 * The Players list row: a season figure under its own label, and the week's game beside the name.
 */
import { describe, expect, it } from 'vitest'
import { splitStatLine, wireGameLine } from '@/components/league/native/screens/NativeWaiversScreen'

describe('splitStatLine', () => {
  it('splits a figure from its label at the last space', () => {
    expect(splitStatLine('RUSH YDS 766')).toEqual({ label: 'RUSH YDS', value: '766' })
    expect(splitStatLine('TD 7')).toEqual({ label: 'TD', value: '7' })
    expect(splitStatLine('REC YDS -9')).toEqual({ label: 'REC YDS', value: '-9' })
    expect(splitStatLine(' PTS/G 26 ')).toEqual({ label: 'PTS/G', value: '26' })
  })

  it('shows a line with no label as the figure alone', () => {
    expect(splitStatLine('766')).toEqual({ label: '', value: '766' })
  })
})

describe('wireGameLine', () => {
  it('says home or away, and when', () => {
    const iso = '2026-11-26T21:30:00.000Z'
    const when = new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    expect(wireGameLine('DAL', 'away', iso)).toBe(`@ DAL · ${when}`)
    expect(wireGameLine('DAL', 'home', iso)).toBe(`vs DAL · ${when}`)
  })

  it('names the opponent alone when the kickoff is not on file or unreadable', () => {
    expect(wireGameLine('DAL', 'away', null)).toBe('@ DAL')
    expect(wireGameLine('DAL', null, 'not a date')).toBe('vs DAL')
  })

  it('says a bye week, and nothing when no game is on file', () => {
    expect(wireGameLine('BYE', null, null)).toBe('Bye week')
    expect(wireGameLine(null, 'home', '2026-11-26T21:30:00.000Z')).toBeNull()
  })
})
