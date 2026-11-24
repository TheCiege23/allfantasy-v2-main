/**
 * Is this headline SPORTSBOOK content — a promo code, best bets, a parlay, a picks-and-odds preview —
 * rather than news?
 *
 * Owner's call, 2026-11-24, alongside fantasyColumnHeadline.ts: people who follow a TEAM get that
 * team's news. "Use DraftKings promo code to get $200 bonus bets for Bengals vs. Commanders" is an ad.
 *
 * ⚠ MEASURED against `player_news` headlines (30 days to 2026-11-24), not guessed. The bare words are
 * NOT used, because each one is also real news:
 *   - "picks"      draft picks — "Jets trade Andre Cisco to Lions for draft pick"
 *   - "betting"    "Rozier co-defendant … NBA betting case", "LeBron James sues makers of AI
 *                  sports-betting app"
 *   - "odds"/"prediction"/"spread" alone — awards races, "4 keys to a Lions victory"
 * So odds only counts next to picks/predictions/spreads/lines/props, and betting only as a column
 * ("betting preview", "betting odds", "betting report"). Futures odds ("Super Bowl LXI odds: all 32
 * teams") are deliberately left in as borderline.
 */
const SPORTSBOOK = new RegExp(
  [
    String.raw`\bpromo code\b`, String.raw`\bbonus code\b`, String.raw`\bbonus bets?\b`,
    String.raw`\bsportsbooks?\b`, String.raw`\bbest bets?\b`, String.raw`\bparlays?\b`,
    String.raw`\bplayer props\b`, String.raw`\bprop plays\b`, String.raw`\bsgp\b`,
    String.raw`\b(?:draftkings|fanduel|betmgm|bet365|kalshi|polymarket|sportsline)\b`,
    String.raw`\bexpert picks\b`, String.raw`\bpicks (?:from|by) (?:an )?expert`,
    String.raw`\bodds\b[^.]*\b(?:picks|predictions?|best bets?|spreads?|lines|props)\b`,
    String.raw`\b(?:picks|predictions?)\b[^.]*\bodds\b`,
    String.raw`\bbetting (?:preview|odds|picks|lines|trends|buzz|sites|apps|promos|report|tips)\b`,
    String.raw`\bsports betting:`, String.raw`\bearly bets\b`, String.raw`\bbets to make\b`,
    String.raw`\bagainst the spread\b`, String.raw`\bats picks\b`,
  ].join('|'),
  'i',
)

export function isSportsbookHeadline(headline: string | null | undefined): boolean {
  return typeof headline === 'string' && SPORTSBOOK.test(headline)
}
