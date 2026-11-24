import { describe, expect, it } from 'vitest'
import { isFantasyColumnHeadline } from '@/lib/news/fantasyColumnHeadline'

// Every headline below is a real `player_news` headline from production (Nov 2026).
describe('isFantasyColumnHeadline', () => {
  it.each([
    "Fantasy notebook: Karabell on Paul George, Tyler Herro, De'Aaron Fox, more",
    'Fantasy football rankings for Week 12: Wide receiver',
    "Week 11 TNF Fantasy Football Start 'Em, Sit 'Em: Tank Dell or Xavier Hutchinson?",
    'Why Jonah Coleman is a priority add off the waiver wire',
    'NFL DFS Week 9: Best Picks, Lineup Advice and Value Plays',
    'Why Hunter Henry is a top TE streamer in Week 8',
    "Knockout league pickups: Prioritize running backs while they're available",
    'Fantasy hoops: Using the ESPN Player Rater to uncover 16 roto and category stars',
  ])('catches a fantasy column: %s', (h) => expect(isFantasyColumnHeadline(h)).toBe(true))

  it.each([
    'Terry Rozier co-defendant signals intent to change plea in NBA betting case',
    'NFL Power Rankings: Week 11 Edition',
    '2026 NFL playoff picture: AFC, NFC seed projections, chances to make postseason',
    'Tampa Bay Buccaneers vs. Detroit Lions: How to watch the NFL Week 11 game, channel, streaming info and more',
    "Inside the Jordan Dome, where 'Space Jam' pickup games helped MJ get his game back",
    "Police Say Rex Ryan's Pickup Ran Over Two Pedestrians' Feet on Nashville's Broadway, Then Drove Off.",
    'Ron Slay breaks down SEC contenders, sleepers ahead of tipoff',
    'Love (knee) ruled out for Sunday',
  ])('leaves real news alone: %s', (h) => expect(isFantasyColumnHeadline(h)).toBe(false))

  it('handles empty input', () => {
    expect(isFantasyColumnHeadline(null)).toBe(false)
    expect(isFantasyColumnHeadline('')).toBe(false)
  })
})
