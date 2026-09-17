import { describe, expect, it } from 'vitest'

import { parseTradeTargetQuestion, readName } from '@/lib/chimmy/tradeTargetQuestion'

const nameOf = (message: string) => parseTradeTargetQuestion(message)?.playerName ?? null

describe('parseTradeTargetQuestion — asks whether to trade for one player', () => {
  it.each([
    // The user's own words, 2026-09-16.
    ['is it worth me trading for Rashee Rice in this league?', 'Rashee Rice'],
    ['Is it worth trading for Rashee Rice?', 'Rashee Rice'],
    ['should I trade for Rashee Rice', 'Rashee Rice'],
    ['Should I try to trade for Rashee Rice right now?', 'Rashee Rice'],
    ['should i make a move for Rashee Rice', 'Rashee Rice'],
    ['Should I make an offer for Rashee Rice?', 'Rashee Rice'],
    ['should I go after Rashee Rice?', 'Rashee Rice'],
    ['Should I target Rashee Rice in Draft Junkies', 'Rashee Rice'],
    ['should I buy low on Rashee Rice', 'Rashee Rice'],
    ['Is Rashee Rice worth trading for?', 'Rashee Rice'],
    ['is Rashee Rice worth a trade', 'Rashee Rice'],
    ['thinking about dealing for Rashee Rice, good idea?', 'Rashee Rice'],
    // A phone keyboard does not always capitalise.
    ['is it worth trading for rashee rice', 'rashee rice'],
    // Names carry punctuation.
    ['should I trade for Amon-Ra St. Brown in this league?', 'Amon-Ra St. Brown'],
    ["should I trade for Ja'Marr Chase?", "Ja'Marr Chase"],
    ['should I trade for Marvin Harrison Jr.?', 'Marvin Harrison Jr.'],
    ['should I trade for Kenneth Walker III now', 'Kenneth Walker III'],
    // Initials keep their periods (staging probe: "A.J. Brown" was read as "A.J").
    ['is it worth me trading for A.J. Brown in this league?', 'A.J. Brown'],
    ['Is D.K. Metcalf worth trading for?', 'D.K. Metcalf'],
    ['should I trade for C.J. Stroud.', 'C.J. Stroud'],
    // One word is still a name here; the builder decides whether it resolves.
    ['should I trade for Rice?', 'Rice'],
    // A position word after the name ends it.
    ['should I trade for Rashee Rice WR', 'Rashee Rice'],
    // A sentence-ending period ends the name.
    ['Trade for Rashee Rice. Good idea?', 'Rashee Rice'],
  ])('%s → %s', (message, expected) => {
    expect(nameOf(message)).toBe(expected)
  })
})

describe('parseTradeTargetQuestion — leaves every other question alone', () => {
  it.each([
    // A price question is the price shortcut's.
    "What is Jeremiyah Love worth in King Gingerbeards SF 2026!!!?",
    "What's the trade value on Patrick Mahomes?",
    "What is Ja'Marr Chase worth in fantasy football?",
    // Both sides named: the described-trade scenario's.
    'should I trade Bijan Robinson for Rashee Rice',
    'Should I trade Bijan Robinson for Rashee Rice, is it worth it?',
    'Is Bijan Robinson for Rashee Rice a good trade?',
    // Both sides named even though a trigger phrase follows — the splitter catches it.
    'Bijan Robinson for Rashee Rice, is Rashee Rice worth trading for?',
    // The give side named after the target.
    'thinking about dealing for Rashee Rice with Bijan Robinson',
    'should I trade for Rashee Rice by giving up Bijan Robinson',
    'should I go after Rashee Rice and give Jaylen Waddle',
    'should I trade for rashee rice using my 2027 first',
    // Two targets: a comparison.
    'should I trade for Rashee Rice or Jaylen Waddle',
    'should I trade for Rice vs Waddle',
    // Not a named player.
    'should I trade for a RB',
    'should I trade for him',
    'should I trade for depth',
    'should I trade for the WR1',
    'is it worth it',
    // Selling is a different question.
    'should I trade away Rashee Rice',
    'should I sell Rashee Rice',
    // Start/sit and waivers.
    'should I start Rashee Rice or Jaylen Waddle',
    'should I pick up Rashee Rice',
    '',
  ])('%s → null', (message) => {
    expect(parseTradeTargetQuestion(message)).toBeNull()
  })
})

describe('readName', () => {
  it('returns the words after the name', () => {
    expect(readName('Rashee Rice in this league?')).toEqual({ name: 'Rashee Rice', rest: 'in this league' })
  })

  it('caps a name at four words', () => {
    expect(readName('Aaa Bbb Ccc Ddd Eee')?.name).toBe('Aaa Bbb Ccc Ddd')
  })

  it('refuses a tail that starts with a non-name', () => {
    expect(readName('a running back')).toBeNull()
    expect(readName('?')).toBeNull()
  })
})
