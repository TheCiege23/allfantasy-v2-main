/**
 * Pairs a TheSportsDB highlight video with the ESPN game on the live slate.
 *
 * Pure, so the rule can be tested without a database and imported anywhere; the
 * DB read lives in `gameHighlights.ts`.
 *
 * ⚠ THE VIDEO IS ALREADY OURS. TheSportsDB's event record carries `strVideo`, a
 * YouTube link to the game's highlight package, and `fetchTheSportsDbGames`
 * stores the whole record in `SportsGame.raw`. Measured on production
 * 2026-09-30: NFL 2026 97 of 97 finals carry one, NFL 2025 334 of 334. Showing
 * it costs no provider call — only this join.
 *
 * ⚠ GAME-LEVEL ONLY. `contracts/thesportsdb/GAPS.md` records that there is no
 * per-play clip endpoint, so nothing here should be captioned as a touchdown
 * clip. It is the game's highlights, and only once the game is over.
 *
 * ── THE JOIN ──────────────────────────────────────────────────────────────────
 *
 * The two feeds share no id, so the join is team names plus kickoff. They do not
 * spell teams alike: ESPN uses the display name ("Temple Owls"), TheSportsDB the
 * school for college ("Temple") and the full name for the NFL ("Kansas City
 * Chiefs"). So a TheSportsDB name matches when its words are a leading run of
 * ESPN's — the rest being the mascot.
 *
 * Measured against production before this was written, NFL 2026: 96 of 97
 * videos pair with exactly one ESPN game and none with two; the miss is a
 * preseason game ESPN never stored.
 *
 * ⚠ A PREFIX RULE CAN PAIR THE WRONG GAME, AND THE LONGEST MATCH IS THE GUARD.
 * "Texas" is a leading run of "Texas State Bobcats" as well as "Texas
 * Longhorns". BOTH teams must match inside the kickoff window, which on its own
 * makes a collision need two prefix-related schools playing two prefix-related
 * opponents the same day — but that can happen ("Texas / Georgia" and "Texas
 * State / Georgia Southern"), so each slate game takes the candidate that
 * matches the MOST words, and a video is used at most once.
 */

/** How far apart two feeds' kickoffs may be and still be the same game. TheSportsDB
 *  often dates an NFL game with no time ("00:00:00"), which can sit most of a day
 *  from the real kickoff. */
export const HIGHLIGHT_KICKOFF_WINDOW_MS = 36 * 60 * 60 * 1000

/** YouTube ids are exactly 11 characters from this alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The YouTube video id in a link, or null.
 *
 * ⚠ NEVER RENDER THE STORED URL ITSELF. It is vendor data; only an id that
 * passes the pattern is embedded, inside a URL we build. Anything else — an
 * empty string, a non-YouTube host, a playlist — is no highlight.
 */
export function youtubeIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v')
    else {
      const [, kind, value] = parsed.pathname.split('/')
      if (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') id = value ?? null
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

/**
 * Where the feeds genuinely disagree on a school's name, not merely its mascot.
 * Keyed and valued in `normalizeTeamName` form. Measured misses only — a guessed
 * alias is how two schools get merged.
 */
const TEAM_ALIASES: Record<string, string> = {
  'miami fl': 'miami',
  'louisiana monroe': 'ul monroe',
}

/** Lowercase words: accents, apostrophes and punctuation gone, `&` spelled out. */
export function normalizeTeamName(name: string | null | undefined): string {
  const words = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // "Hawai'i" must meet "Hawaii", not "hawai i".
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return TEAM_ALIASES[words] ?? words
}

/**
 * How many words of `tsdb` lead `espn`, or 0 when it is not a leading run.
 * Whole words only, so "Iowa" does not lead "Iowa State Cyclones" by accident of
 * spelling — it does lead it by words, which is why the caller also needs the
 * opponent and prefers the longest match.
 */
function leadingWords(tsdb: string, espn: string): number {
  if (!tsdb || !espn) return 0
  if (espn === tsdb || espn.startsWith(`${tsdb} `)) return tsdb.split(' ').length
  return 0
}

export type SlateGameForHighlight = {
  /** Whatever the caller keys its games by — the ESPN game id on the slate. */
  key: string
  homeName: string
  awayName: string
  /** ISO kickoff. */
  startTime: string | null
}

export type HighlightCandidate = {
  homeTeam: string
  awayTeam: string
  startTime: Date | string | null
  videoUrl: unknown
}

/** Slate game key -> YouTube id, for the games a highlight could be paired with. */
export function matchGameHighlights(
  games: readonly SlateGameForHighlight[],
  candidates: readonly HighlightCandidate[],
): Map<string, string> {
  const prepared = candidates
    .map((c) => ({
      home: normalizeTeamName(c.homeTeam),
      away: normalizeTeamName(c.awayTeam),
      at: c.startTime == null ? NaN : new Date(c.startTime).getTime(),
      youtubeId: youtubeIdFromUrl(c.videoUrl),
    }))
    .filter((c) => c.youtubeId != null && Number.isFinite(c.at) && c.home && c.away)

  type Pairing = { key: string; candidate: number; words: number; gap: number }
  const pairings: Pairing[] = []
  for (const game of games) {
    const at = game.startTime ? new Date(game.startTime).getTime() : NaN
    if (!Number.isFinite(at)) continue
    const home = normalizeTeamName(game.homeName)
    const away = normalizeTeamName(game.awayName)
    prepared.forEach((c, candidate) => {
      const gap = Math.abs(c.at - at)
      if (gap > HIGHLIGHT_KICKOFF_WINDOW_MS) return
      // Either orientation: a neutral-site game can be listed home/away either way.
      const straight = Math.min(leadingWords(c.home, home), leadingWords(c.away, away))
      const swapped = Math.min(leadingWords(c.home, away), leadingWords(c.away, home))
      const words = straight > 0 ? leadingWords(c.home, home) + leadingWords(c.away, away)
        : swapped > 0 ? leadingWords(c.home, away) + leadingWords(c.away, home)
          : 0
      if (words > 0) pairings.push({ key: game.key, candidate, words, gap })
    })
  }

  // Best evidence first: most words matched, then nearest kickoff. Each game and
  // each video is used once.
  pairings.sort((a, b) => b.words - a.words || a.gap - b.gap)
  const out = new Map<string, string>()
  const used = new Set<number>()
  for (const p of pairings) {
    if (out.has(p.key) || used.has(p.candidate)) continue
    out.set(p.key, prepared[p.candidate]!.youtubeId!)
    used.add(p.candidate)
  }
  return out
}
