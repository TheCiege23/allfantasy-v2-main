/**
 * Is this headline a FANTASY COLUMN — rankings, start/sit, waiver adds, DFS — rather than news?
 *
 * Owner's call, 2026-11-24: people who follow a TEAM get that team's news, not fantasy advice. A
 * Celtics fan who does not play fantasy basketball was sent "Fantasy notebook: Karabell on Paul
 * George, Tyler Herro, De'Aaron Fox, more" because the story bound to a Celtics player. Rostering
 * managers and player followers still get these; only team followers are filtered.
 *
 * ⚠ THE WORD LIST WAS MEASURED, NOT GUESSED, against 35,253 `player_news` headlines (30 days to
 * 2026-11-24). Left out on purpose, each for real news it would have dropped:
 *   - "rankings"    NFL Power Rankings, QB rankings, Mel Kiper's Big Board
 *   - "projections" playoff and bowl projections
 *   - "betting"     "Terry Rozier co-defendant … in NBA betting case"
 *   - "streaming"   "How to watch … streaming info"
 *   - "pickup"      "'Space Jam' pickup games", "Rex Ryan's pickup ran over …" (plural "pickups" kept)
 *   - "sleepers"    "SEC contenders, sleepers ahead of tipoff"
 * The fantasy columns those words would have caught nearly all say "fantasy" anyway.
 */
const FANTASY_COLUMN = new RegExp(
  [
    String.raw`\bfantasy\b`,
    String.raw`\bstart\s*['’]?em\b.*\bsit\s*['’]?em\b`,
    String.raw`\bstart[/ -]+(?:or[ -]+)?sit\b`,
    String.raw`\bwaiver[ -]wire\b`,
    String.raw`\bdfs\b`,
    String.raw`\bbuy[ -]low\b`,
    String.raw`\bsell[ -]high\b`,
    String.raw`\bstreamers?\b`,
    String.raw`\bpickups\b`,
    String.raw`\bplayer rater\b`,
  ].join('|'),
  'i',
)

export function isFantasyColumnHeadline(headline: string | null | undefined): boolean {
  return typeof headline === 'string' && FANTASY_COLUMN.test(headline)
}
