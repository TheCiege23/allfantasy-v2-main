/**
 * Breaking-news classification — pure, no I/O, shared by the breaking-news alert sender
 * (lib/news/breakingNewsAlerts.ts) and the admin social newsroom (lib/social-newsroom).
 *
 * WHAT COUNTS AS BREAKING. A thing that HAPPENED to a player, coach or team: a trade, a signing,
 * a release, a firing or hiring, a suspension, a season-ending injury, a retirement. Not analysis
 * ("takeaways", "grades", "why the Texans…"), not speculation ("could", "trade talks", "rumors"),
 * not betting or fantasy advice. The headline is the whole signal — ESPN's news feed writes the
 * fact into it ("Sources: Cardinals trade Marvin Harrison Jr. to Texans").
 *
 * ⚠ A WRONG "BREAKING" PUSH COSTS MORE THAN A MISSED ONE. A person buzzed for an opinion column
 * learns to switch the category off, and then the real trade never reaches them. So every rule
 * here errs toward "not breaking", and anything phrased as a question or a possibility is out.
 *
 * ⚠ ONLY TRUSTED OUTLETS. `trustedSource` is an allowlist of newsrooms, never a blocklist: a story
 * from an outlet nobody has vetted is not sent, however breaking it sounds. Reports attributed to
 * sources ("Sources:", "per sources", "reportedly") are kept — that is how almost every trade first
 * breaks — but carry `confidence: 'report'` so the copy can say so.
 */

export type BreakingKind =
  | 'trade'
  | 'signing'
  | 'release'
  | 'coaching'
  | 'suspension'
  | 'injury'
  | 'retirement'

export type BreakingClassification = {
  kind: BreakingKind
  /** `major` reaches everyone who plays the sport; `notable` only followers of the team. */
  tier: 'major' | 'notable'
  /** `report` when the headline attributes the news to sources rather than an announcement. */
  confidence: 'confirmed' | 'report'
}

/** Analysis, opinion, betting, fantasy and speculation — never breaking, whatever verb they contain. */
const NOT_NEWS =
  /\b(takeaways?|rankings?|mock|fantasy|grades?|graded|predictions?|(expert|staff|our|my|best) picks|pick'?em|odds|bets?|betting|parlays?|props?|what we learned|things to know|winners and losers|overreactions?|debate|hot takes?|should|could|would|might|may|why|how|what|who|which|whether|if|listen|watch|podcast|quiz|stock (up|down)|preview|recap|film study|mailbag|power poll|buzz|rumou?rs?|rumou?red|speculation|interest(ed)?|targets?|candidates?|eyeing|linked to|in talks|talks|exploring|consider(s|ing)?|monitor(s|ing)?|wants?|hopes?|expects?|expected|likely|possible|potential|plans? to|open to|best|worst|top \d+|guide|hot seat|highlights|vs\.?|hints?|hinted|feelings|still|back from|returns? from|game back|reflects?|recalls?|looks? back|anniversary|years? ago|close in on|closing in|nears?|nearing|signs (an )?(order|bill|law|petition))\b/i

/**
 * Team names that read as a breaking verb. "Chicago Fire FC vs. Philadelphia Union - Game
 * Highlights" was classified a coaching change (measured on production news 2026-10-15) because
 * "Fire" matched "fires". Stripped before the verb tests, never before NOT_NEWS.
 */
const VERB_LIKE_TEAM_NAMES = /\b(Chicago Fire( FC)?|Fire FC)\b/g

/** A completed trade, not the market around one. */
const TRADE = /\b(trades?|traded|acquires?|acquired|deal sends|ships|shipped|dealt)\b/i

const SIGNING = /\b(signs?|signed|re-signs?|re-signed|agrees? to|agreed to|extension|extend(s|ed)?|lands? .+ deal|inks?|inked)\b/i
const RELEASE = /\b(releases?|released|waives?|waived|cuts?|designated for assignment|DFA'?d|parts? ways|parted ways)\b/i
/**
 * "Release" as a noun or of a THING, not of a player. "Packers' Josh Jacobs sues to block release of
 * records, video of altercation" went out as an NFL "Roster move" alert on 2026-10-15.
 */
const RELEASE_NOT_ROSTER =
  /\b(release of|press release|release date|(releases?|released) (a |an |the |his |her |their |its )?(statement|video|footage|records?|documents?|details|names?|schedule|report|findings|album|song|book|film|trailer|data|audio|photos?|images?))\b/gi
const COACHING =
  /\b(fires?|fired|dismiss(es|ed)?|hires?|hired|names? .{0,40}(coach|manager|coordinator|general manager|GM|president)|steps? down|stepped down|resigns?|resigned|out as)\b/i
const SUSPENSION = /\b(suspend(s|ed)?|suspension|banned)\b/i
const MAJOR_INJURY =
  /\b((torn|tears?|ruptured?|ruptures?) (his |an? )?(ACL|Achilles|MCL|labrum|pec(toral)?|UCL)|out for (the )?season|season-ending|career-ending|Tommy John)\b/i
const RETIREMENT = /\b(retires?|retired|retirement|announces retirement)\b/i
/** Retiring a NUMBER is a ceremony, not news about a player leaving. */
const JERSEY_RETIREMENT = /\b(jersey|number|No\. ?\d+)\b/i

const REPORT = /^(sources?|report|reports)\b|\b(sources? (say|said|tell)|per sources?|reportedly|according to)\b/i

/** Big money or a long deal: what makes a signing reach beyond the team's own followers. */
const BIG_SIGNING = /\$\s?\d{2,}(\.\d+)?\s?(M|million|B|billion)\b|\b\d{2,}\s?million\b|\b([4-9]|1[0-5])-year\b/i

export function classifyBreakingHeadline(title: string, description?: string | null): BreakingClassification | null {
  const t = String(title ?? '').trim()
  if (t.length < 12) return null
  // A question is never a fact.
  if (/\?\s*$/.test(t)) return null
  if (NOT_NEWS.test(t)) return null

  const confidence: BreakingClassification['confidence'] = REPORT.test(t) ? 'report' : 'confirmed'
  // The verb tests read the headline with verb-like team names removed.
  const v = t.replace(VERB_LIKE_TEAM_NAMES, ' ')
  const text = `${v} ${description ?? ''}`

  if (MAJOR_INJURY.test(v)) return { kind: 'injury', tier: 'major', confidence }
  if (TRADE.test(v)) return { kind: 'trade', tier: 'major', confidence }
  if (SUSPENSION.test(v)) return { kind: 'suspension', tier: 'major', confidence }
  if (COACHING.test(v)) return { kind: 'coaching', tier: 'major', confidence }
  if (RETIREMENT.test(v) && !JERSEY_RETIREMENT.test(v)) return { kind: 'retirement', tier: 'major', confidence }
  if (SIGNING.test(v)) return { kind: 'signing', tier: BIG_SIGNING.test(text) ? 'major' : 'notable', confidence }
  // Strip the non-roster phrases, then look again: "release statement and waive linebacker" is still a roster move.
  if (RELEASE.test(v.replace(RELEASE_NOT_ROSTER, ' '))) return { kind: 'release', tier: 'notable', confidence }
  return null
}

/**
 * Newsrooms whose reporting is trusted for a push or a social post. Matched on the article URL's
 * host (suffix match), because NewsAPI rows name an outlet in free text but always carry its URL.
 *
 * ⚠ AN ALLOWLIST, ON PURPOSE. Rumour aggregators (e.g. nfltraderumors.co, which `syncNewsToDb`
 * searches) and fantasy sites are deliberately absent.
 */
export const TRUSTED_NEWS_HOSTS = [
  'espn.com',
  'apnews.com',
  'reuters.com',
  'nfl.com',
  'nba.com',
  'mlb.com',
  'nhl.com',
  'mlssoccer.com',
  'ncaa.com',
  'cbssports.com',
  'foxsports.com',
  'nbcsports.com',
  'theathletic.com',
  'nytimes.com',
  'si.com',
  'sports.yahoo.com',
  'bleacherreport.com',
  'usatoday.com',
  'sportingnews.com',
  'washingtonpost.com',
] as const

/** Display name and X handle for an outlet, for attribution in alerts and social copy. */
export const OUTLETS: Record<string, { name: string; handle: string | null }> = {
  'espn.com': { name: 'ESPN', handle: '@espn' },
  'apnews.com': { name: 'AP', handle: '@AP' },
  'reuters.com': { name: 'Reuters', handle: '@Reuters' },
  'nfl.com': { name: 'NFL.com', handle: '@NFL' },
  'nba.com': { name: 'NBA.com', handle: '@NBA' },
  'mlb.com': { name: 'MLB.com', handle: '@MLB' },
  'nhl.com': { name: 'NHL.com', handle: '@NHL' },
  'mlssoccer.com': { name: 'MLSsoccer.com', handle: '@MLS' },
  'ncaa.com': { name: 'NCAA.com', handle: '@NCAA' },
  'cbssports.com': { name: 'CBS Sports', handle: '@CBSSports' },
  'foxsports.com': { name: 'FOX Sports', handle: '@FOXSports' },
  'nbcsports.com': { name: 'NBC Sports', handle: '@NBCSports' },
  'theathletic.com': { name: 'The Athletic', handle: '@TheAthletic' },
  'nytimes.com': { name: 'The Athletic', handle: '@TheAthletic' },
  'si.com': { name: 'Sports Illustrated', handle: '@SInow' },
  'sports.yahoo.com': { name: 'Yahoo Sports', handle: '@YahooSports' },
  'bleacherreport.com': { name: 'Bleacher Report', handle: '@BleacherReport' },
  'usatoday.com': { name: 'USA TODAY Sports', handle: '@usatodaysports' },
  'sportingnews.com': { name: 'Sporting News', handle: '@sportingnews' },
  'washingtonpost.com': { name: 'The Washington Post', handle: '@washingtonpost' },
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** The trusted outlet an article URL belongs to, or null. A story without a link is never trusted. */
export function trustedOutlet(sourceUrl: string | null | undefined): { host: string; name: string; handle: string | null } | null {
  const host = hostOf(sourceUrl)
  if (!host) return null
  const match = TRUSTED_NEWS_HOSTS.find((h) => host === h || host.endsWith(`.${h}`))
  if (!match) return null
  // The Athletic lives under nytimes.com/athletic; the rest of nytimes.com is not a sports desk.
  if (match === 'nytimes.com' && !/\/athletic\//.test(String(sourceUrl))) return null
  return { host: match, ...OUTLETS[match] }
}

const PRO_SPORTS = new Set(['NFL', 'NBA', 'NHL', 'MLB', 'SOCCER'])
/**
 * College SECTIONS of outlets' sites, matched as a whole path segment. A slug is never a section:
 * Sporting News files "college-football-pressure-bryce-underwood-..." under /ncaa-football/, and a
 * prefix match on the slug would misread any pro story whose slug starts with "college-".
 */
const COLLEGE_SECTIONS: Record<string, 'NCAAF' | 'NCAAB' | 'OTHER'> = {
  'college-football': 'NCAAF',
  'ncaa-football': 'NCAAF',
  ncaaf: 'NCAAF',
  'college-basketball': 'NCAAB',
  'mens-college-basketball': 'NCAAB',
  'ncaa-basketball': 'NCAAB',
  ncaab: 'NCAAB',
  // College sports outside the seven: no right label, so the story is not stored at all.
  'college-sports': 'OTHER',
  'womens-college-basketball': 'OTHER',
  'college-baseball': 'OTHER',
  'college-hockey': 'OTHER',
  'college-soccer': 'OTHER',
  ncaaw: 'OTHER',
}

/** The college sport an article's URL section names, 'OTHER' for a college sport outside the seven, or null. */
export function collegeSectionSport(sourceUrl: string | null | undefined): 'NCAAF' | 'NCAAB' | 'OTHER' | null {
  if (!sourceUrl) return null
  let segments: string[]
  try {
    segments = new URL(sourceUrl).pathname.toLowerCase().split('/')
  } catch {
    return null
  }
  for (const seg of segments) {
    const hit = COLLEGE_SECTIONS[seg]
    if (hit) return hit
  }
  return null
}

/**
 * The sport to store a news article under. Pro feeds and defaults mislabel college stories: ESPN's NHL
 * feed carries college hockey, and the NewsAPI path files everything it cannot place under NFL, which
 * put 460 college football stories under NFL on production (2026-10-15). A college football or
 * basketball story moves to NCAAF / NCAAB; any other college story returns null (do not store it).
 * A sport that is already college, or a URL with no college section, is left as it is.
 */
export function correctedNewsSport(sport: string, sourceUrl: string | null | undefined): string | null {
  if (!PRO_SPORTS.has(String(sport ?? '').toUpperCase())) return sport
  const college = collegeSectionSport(sourceUrl)
  if (!college) return sport
  return college === 'OTHER' ? null : college
}

/**
 * True for a college story stored under a PRO sport. Readers skip such rows: they would be posted with
 * the pro league's hashtags and pushed to everyone who plays it (an Arizona State hockey coaching
 * change went out as an "NHL Coaching change" alert on 2026-10-15). NCAAF and NCAAB are never flagged.
 */
export function isCollegeStoryForProSport(sport: string | null | undefined, sourceUrl: string | null | undefined): boolean {
  return PRO_SPORTS.has(String(sport ?? '').toUpperCase()) && collegeSectionSport(sourceUrl) !== null
}

export type TeamNameEntry = { abbr: string; name: string }

/** Nicknames that are two words; everything else is the last word of "<City> <Nickname>". */
const TWO_WORD_NICKNAMES = [
  'Trail Blazers',
  'Red Sox',
  'White Sox',
  'Blue Jays',
  'Maple Leafs',
  'Blue Jackets',
  'Golden Knights',
  'Red Wings',
  'Hockey Club',
]

/** The nickname a headline uses for a pro team ("Arizona Cardinals" → "Cardinals"). */
export function teamNickname(fullName: string): string {
  const name = fullName.trim()
  const two = TWO_WORD_NICKNAMES.find((n) => name.endsWith(` ${n}`) || name === n)
  if (two) return two
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] ?? name
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Pro teams named in a headline, by full name or nickname, case-SENSITIVE (a headline capitalises a
 * team; "the jets of water" does not). Returns abbreviations in order of first mention.
 *
 * ⚠ PRO SPORTS ONLY. College headlines name schools in too many forms ("Bama", "the Tide", "UGA")
 * for a nickname scan; the caller resolves college teams from the article's own team field instead.
 */
export function teamsMentioned(text: string, teams: readonly TeamNameEntry[]): string[] {
  const hits: Array<{ abbr: string; at: number }> = []
  for (const t of teams) {
    const forms = [t.name, teamNickname(t.name)].filter((f, i, a) => f && a.indexOf(f) === i)
    let first = -1
    for (const form of forms) {
      const re = new RegExp(`(^|[^A-Za-z])${escapeRegex(form)}('s)?(?![A-Za-z])`)
      const m = re.exec(text)
      if (m && (first === -1 || m.index < first)) first = m.index
    }
    if (first >= 0) hits.push({ abbr: t.abbr, at: first })
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.abbr).filter((a, i, arr) => arr.indexOf(a) === i)
}

/** A normalised headline, for collapsing the same story from two outlets when no team is known. */
export function normalizedHeadline(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(sources?|report|breaking)\s*:\s*/i, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * One key per real-world event, so ESPN and NewsAPI reporting the same trade send ONE alert.
 * Keyed on (sport, kind, the teams involved, Eastern date) when teams are known — two trades between
 * the same two teams on the same day are rare enough that merging them is the better failure —
 * otherwise on the normalised headline.
 */
export function breakingStoryKey(input: {
  sport: string
  kind: BreakingKind
  teams: readonly string[]
  title: string
  publishedAt: Date
}): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.publishedAt)
  const who = input.teams.length > 0 ? [...input.teams].sort().join('-') : normalizedHeadline(input.title).slice(0, 80)
  return `breaking-news:${input.sport}:${input.kind}:${day}:${who}`
}

/** Push/email title for a breaking story. */
export function breakingAlertTitle(sport: string, c: BreakingClassification): string {
  const label: Record<BreakingKind, string> = {
    trade: 'Trade',
    signing: 'Signing',
    release: 'Roster move',
    coaching: 'Coaching change',
    suspension: 'Suspension',
    injury: 'Injury',
    retirement: 'Retirement',
  }
  return `🚨 ${sport} ${label[c.kind]}${c.confidence === 'report' ? ' (report)' : ''}`
}
