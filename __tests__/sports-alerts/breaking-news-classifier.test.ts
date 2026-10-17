// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  breakingStoryKey,
  classifyBreakingHeadline,
  correctedNewsSport,
  isCollegeStoryForProSport,
  teamNickname,
  teamsMentioned,
  trustedOutlet,
} from '@/lib/news/breakingNews'

const NFL = [
  { abbr: 'ARI', name: 'Arizona Cardinals' },
  { abbr: 'HOU', name: 'Houston Texans' },
  { abbr: 'NYJ', name: 'New York Jets' },
  { abbr: 'NYG', name: 'New York Giants' },
]

describe('classifyBreakingHeadline', () => {
  it('flags the Marvin Harrison Jr. trade as a major, sourced trade', () => {
    expect(classifyBreakingHeadline('Sources: Cardinals trade Marvin Harrison Jr. to Texans')).toEqual({
      kind: 'trade',
      tier: 'major',
      confidence: 'report',
    })
    expect(classifyBreakingHeadline('Cardinals trade Marvin Harrison Jr. to Texans for two picks')?.confidence).toBe('confirmed')
  })

  it.each([
    ['Knicks sign Jalen Brunson to 5-year, $269M extension', 'signing', 'major'],
    ['Jets sign veteran long snapper', 'signing', 'notable'],
    ['Giants release backup quarterback', 'release', 'notable'],
    ['Raiders fire head coach after 1-6 start', 'coaching', 'major'],
    ['Rangers name Mike Sullivan head coach', 'coaching', 'major'],
    ['NFL suspends linebacker three games for hit', 'suspension', 'major'],
    ['Ravens WR suffers torn ACL, out for season', 'injury', 'major'],
    ['Legendary goalie announces retirement after 18 seasons', 'retirement', 'major'],
    // Real breaking stories from production news, 2026-10-15:
    ['Phillies hire Don Mattingly to 2-year deal as manager', 'coaching', 'major'],
    ['Celtics to extend guard Payton Pritchard on 2-year, $44.2M deal', 'signing', 'major'],
    ["Rams' Alaric Jackson has suspension cut to 1 game following appeal", 'suspension', 'major'],
    ['Chicago Fire fire head coach after missing playoffs', 'coaching', 'major'],
    // "Release" of a player stays a roster move; release OF something does not (next table).
    ['Browns released veteran tight end on Tuesday', 'release', 'notable'],
    ['Steelers release statement and waive linebacker', 'release', 'notable'],
  ])('%s → %s/%s', (title, kind, tier) => {
    expect(classifyBreakingHeadline(title)).toMatchObject({ kind, tier })
  })

  it.each([
    'Could the Cardinals trade Marvin Harrison Jr.?',
    'Why the Texans traded for Marvin Harrison Jr.',
    'Trade rumors: Five teams eyeing Cardinals receiver',
    'NFL Week 7 power rankings',
    'Best bets and odds for Sunday',
    'Fantasy football: Who to start after the Harrison trade',
    'Cardinals in talks to trade receiver',
    'Texans expected to sign free agent',
    'Celtics to retire No. 34 jersey',
    'Takeaways from the Texans blockbuster trade',
    // Real false positives from production news, 2026-10-15:
    'Chicago Fire FC vs. Philadelphia Union - Game Highlights',
    "Men's NCAA basketball 2026-27 coaching hot seat, retirement guide",
    'McAvoy scores in his 1st game back from a suspension to lead the Bruins past the Sharks 6-3',
    "Terry Bradshaw hints at retirement, says his time as an NFL analyst is 'coming to an end'",
    'Cowboys’ Jerry Jones reportedly still has strong feelings about Micah Parsons trade',
    "Ohio Gov. Mike DeWine signs order letting state's 2022 athletes play in 2026-27",
    'Sources: Alex DeBrincat, Red Wings close in on 7-year extension',
    // Sent as an NFL "Roster move" alert on 2026-10-15: a lawsuit over releasing records, not a player.
    "Packers' Josh Jacobs sues to block release of records, video of altercation",
    'Jaguars release statement on stadium renovation',
    'NFL sets release date for 2027 schedule',
  ])('is not breaking: %s', (title) => {
    expect(classifyBreakingHeadline(title)).toBeNull()
  })
})

describe('trustedOutlet', () => {
  it('trusts ESPN and other newsrooms by host, with credit', () => {
    expect(trustedOutlet('https://www.espn.com/nfl/story/_/id/1')).toEqual({ host: 'espn.com', name: 'ESPN', handle: '@espn' })
    expect(trustedOutlet('https://apnews.com/article/x')?.name).toBe('AP')
    expect(trustedOutlet('https://www.nytimes.com/athletic/123/')?.name).toBe('The Athletic')
  })
  it('does not trust rumour sites, look-alike hosts, the rest of nytimes.com, or a missing link', () => {
    expect(trustedOutlet('https://nfltraderumors.co/x')).toBeNull()
    expect(trustedOutlet('https://espn.com.fake-news.io/x')).toBeNull()
    expect(trustedOutlet('https://www.nytimes.com/2026/10/15/politics/x.html')).toBeNull()
    expect(trustedOutlet(null)).toBeNull()
    expect(trustedOutlet('javascript:alert(1)')).toBeNull()
  })
})

describe('teamsMentioned', () => {
  it('finds teams by nickname, in order, case-sensitively', () => {
    expect(teamsMentioned('Sources: Cardinals trade Marvin Harrison Jr. to Texans', NFL)).toEqual(['ARI', 'HOU'])
    expect(teamsMentioned("Giants' rookie shines", NFL)).toEqual(['NYG'])
    expect(teamsMentioned('giants of the game', NFL)).toEqual([])
  })
  it('keeps two-word nicknames whole', () => {
    expect(teamNickname('Portland Trail Blazers')).toBe('Trail Blazers')
    expect(teamNickname('Boston Red Sox')).toBe('Red Sox')
    expect(teamNickname('Houston Texans')).toBe('Texans')
  })
})

describe('breakingStoryKey', () => {
  it('collapses the same trade from two outlets into one key, whatever the team order', () => {
    const at = new Date('2026-10-15T16:00:00Z')
    const a = breakingStoryKey({ sport: 'NFL', kind: 'trade', teams: ['ARI', 'HOU'], title: 'Sources: Cardinals trade MHJ to Texans', publishedAt: at })
    const b = breakingStoryKey({ sport: 'NFL', kind: 'trade', teams: ['HOU', 'ARI'], title: 'Texans acquire Marvin Harrison Jr.', publishedAt: at })
    expect(a).toBe(b)
  })
})

describe('college stories under a pro sport', () => {
  // Real URLs from production rows, 2026-10-15.
  const ASU_HOCKEY = 'https://www.espn.com/college-sports/story/_/id/50189567/arizona-state-hockey-coach-exits-amid-probe-collapse'
  const LSU_SOCCER =
    'https://sports.yahoo.com/college-sports/article/lsu-soccers-jocelyn-olliverre-jazmin-ferguson-become-first-5th-year-seniors-215400350.html'
  const CFB = [
    'https://sports.yahoo.com/college-football/article/heisman-watch-is-it-already-jeremiah-smiths-award-to-lose-after-just-6-weeks-134531451.html',
    'https://www.cbssports.com/college-football/news/michigan-alex-bauman-jeremiah-earby-transfer-portal/',
    'https://www.foxsports.com/stories/college-football/joel-klatt-show-college-football-playoff-predictions',
    'https://www.sportingnews.com/us/ncaa-football/news/college-football-pressure-bryce-underwood-lincoln-riley-sec/47761a40142b13e5bad05d0b',
    'https://www.thescore.com/ncaaf/news/3584634/oregons-lanning-rips-nfl-players-returning-to-college-unfair-to-the-sport',
  ]

  it('moves college football and basketball to NCAAF / NCAAB', () => {
    for (const url of CFB) expect(correctedNewsSport('NFL', url)).toBe('NCAAF')
    expect(correctedNewsSport('NBA', 'https://www.espn.com/mens-college-basketball/story/_/id/1/x')).toBe('NCAAB')
  })

  it('drops college sports outside the seven', () => {
    expect(correctedNewsSport('NHL', ASU_HOCKEY)).toBeNull()
    expect(correctedNewsSport('NFL', LSU_SOCCER)).toBeNull()
  })

  it('leaves pro stories, college sports and unreadable URLs alone', () => {
    expect(correctedNewsSport('MLB', 'https://www.espn.com/mlb/story/_/id/50181619/phillies-hire-don-mattingly-2-year-deal')).toBe('MLB')
    // A slug is not a section: a pro story whose slug starts with "college-" stays where it is.
    expect(correctedNewsSport('NFL', 'https://www.espn.com/nfl/story/_/id/1/college-teammates-reunite-in-denver')).toBe('NFL')
    expect(correctedNewsSport('NFL', 'https://www.espn.com/nfl/story/_/id/2/college-football-coach-joins-bears-staff')).toBe('NFL')
    expect(correctedNewsSport('NCAAB', 'https://www.espn.com/mens-college-basketball/story/_/id/50182031/florida-todd-golden')).toBe('NCAAB')
    expect(correctedNewsSport('NCAAF', ASU_HOCKEY)).toBe('NCAAF')
    expect(correctedNewsSport('NHL', null)).toBe('NHL')
    expect(correctedNewsSport('NHL', 'not a url')).toBe('NHL')
  })

  it('flags stored rows that readers must skip', () => {
    expect(isCollegeStoryForProSport('NHL', ASU_HOCKEY)).toBe(true)
    expect(isCollegeStoryForProSport('nfl', CFB[0])).toBe(true)
    expect(isCollegeStoryForProSport('NCAAF', CFB[0])).toBe(false)
    expect(isCollegeStoryForProSport('NFL', 'https://www.espn.com/nfl/story/_/id/1/college-teammates-reunite-in-denver')).toBe(false)
  })
})
