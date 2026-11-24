import { describe, expect, it } from 'vitest'
import { isSportsbookHeadline } from '@/lib/news/sportsbookHeadline'

// Every headline below is a real `player_news` headline from production (Nov 2026).
describe('isSportsbookHeadline', () => {
  it.each([
    'Use DraftKings promo code to get $200 bonus, free NBA League Pass for Pistons-Spurs, Duke-Illinois',
    'FanDuel Promo Code: Get Up to $200 in Bonus Bets for Miami at Notre Dame and CFB Free Picks',
    'NFL and NHL Promos: Claim up to $1,780 in Sportsbook Bonuses for Thursday’s Action',
    '2026 NFL Week 10 Best Bets, Expert Picks: Back Vikings in Kirk Cousins’ Return',
    "Bears vs. Seahawks SGP: 'Monday Night Football' same-game parlay picks, bets, props from SportsLine",
    "'Thursday Night Football' prediction, odds, time: Giants vs. Commanders picks by expert who's on a 3",
    'Week 8 NFL betting odds, lines, totals, spreads for every game, including Bills-Ravens',
    'Commanders-Giants odds, game analysis, betting tips and top prop plays',
    'Early bets for Week 11: Will Broncos keep Raiders down? Will 49ers stay hot?',
    'NFL picks against the spread, Week 10 2026: Expert ATS picks, predictions',
  ])('catches sportsbook content: %s', (h) => expect(isSportsbookHeadline(h)).toBe(true))

  it.each([
    'Rozier co-defendant signals intent to change plea in NBA betting case',
    "76ers' LeBron James sues makers of AI sports-betting app 'Bron'",
    'Jets trade safety Andre Cisco to injury-plagued Lions for draft pick',
    'DeForest Buckner trade: Colts send DT to 49ers in exchange for 2027 fourth-round pick, per report',
    'NFL predictions: 4 keys to a Lions victory over the Vikings in Week 8 - Pride Of Detroit',
    'Cardinals get brutal Jeremiyah Love news as No. 3 overall pick heads to IR',
    "Fantasy notebook: Karabell on Paul George, Tyler Herro, De'Aaron Fox, more",
    'Love (knee) ruled out for Sunday',
  ])('leaves real news alone: %s', (h) => expect(isSportsbookHeadline(h)).toBe(false))

  it('handles empty input', () => {
    expect(isSportsbookHeadline(null)).toBe(false)
    expect(isSportsbookHeadline('')).toBe(false)
  })
})
