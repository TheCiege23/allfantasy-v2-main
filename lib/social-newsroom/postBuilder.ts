/**
 * Copy-and-paste social posts for real sports stories — pure, no I/O.
 *
 * THE RULES THE COPY KEEPS, because the account's credibility is the whole asset:
 *   1. THE FACT IS THE OUTLET'S HEADLINE, VERBATIM. Our words are only the flavour line around it
 *      ("New city, who dis? 📦"), which carries no facts of its own. Nothing here can invent a
 *      contract figure, a quote or a stat.
 *   2. EVERY POST NAMES ITS SOURCE — "via @espn" on X, "Source: ESPN" elsewhere — and carries the
 *      article link, so nobody can say we lifted the report.
 *   3. BAD NEWS IS NOT A JOKE. An injury, a suspension or a death gets a straight post; the quirky
 *      lines are for trades, signings, wild finishes and the like.
 *   4. VIDEO IS SHARED AS A LINK, NEVER RE-UPLOADED. League footage belongs to the league; posting
 *      the YouTube link lets X, Threads and Facebook play the official clip inline.
 */

import type { BreakingClassification, BreakingKind } from '@/lib/news/breakingNews'

export type SocialPlatform = 'x' | 'threads' | 'instagram' | 'facebook' | 'tiktok'

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: 'X',
  threads: 'Threads',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok caption',
}

export const SOCIAL_CHAR_LIMITS: Record<SocialPlatform, number> = {
  x: 280,
  threads: 500,
  instagram: 2200,
  facebook: 5000,
  tiktok: 2200,
}

/** X counts every link as 23 characters, whatever its length. */
const X_LINK_WEIGHT = 23

export type StoryInput = {
  sport: string
  title: string
  description?: string | null
  url: string
  outletName: string
  outletHandle: string | null
  /** null for a story that is real news but not "breaking" (a recap, a milestone, a feature). */
  classification: BreakingClassification | null
  /** Display names of the teams the story names, e.g. ["Arizona Cardinals", "Houston Texans"]. */
  teamNames: readonly string[]
}

export type SocialPost = {
  platform: SocialPlatform
  /** `viral` = an engagement post: a poll, a prediction, a "wrong answers only". */
  tone: 'straight' | 'fun' | 'viral'
  text: string
  /** Characters as the platform counts them (X weights links at 23). */
  charCount: number
  withinLimit: boolean
}

/** Flavour lines per kind. Generic on purpose — they state no fact. */
const FUN_LEADS: Record<BreakingKind | 'news', readonly string[]> = {
  trade: ['New city, who dis? 📦', 'Pack your bags 🧳', 'The group chat is about to explode 💥', 'Blockbuster alert 🎬'],
  signing: ['Pen meets paper ✍️', 'Locked in 🔒', 'Contract szn 💰', 'Ink is dry ✒️'],
  release: ['Roster shake-up 🔄', 'Moves are being made 👀', 'Plot twist incoming 🌀'],
  coaching: ['Headset shuffle 🎧', 'New voice in the building 🗣️', 'Sideline shake-up 📋'],
  retirement: ['End of an era 🫡', 'Hanging them up 👟', 'Tip of the cap 🎩'],
  // Straight-faced kinds: never joked about (see rule 3).
  suspension: [],
  injury: [],
  news: ['Here is what everyone is talking about 👀', 'Did not have this on the bingo card 🎯', 'Sports never sleeps 🌙', 'File this under: wow 🗂️'],
}

const STRAIGHT_LEADS: Record<BreakingKind | 'news', string> = {
  trade: '🚨 TRADE',
  signing: '✍️ SIGNING',
  release: '🔄 ROSTER MOVE',
  coaching: '📋 COACHING CHANGE',
  retirement: '🫡 RETIREMENT',
  suspension: '⛔ SUSPENSION',
  injury: '🏥 INJURY UPDATE',
  news: '📰',
}

/** Topics that are never given a fun line, whatever the classifier said. */
const SOMBRE = /\b(dies|died|death|dead|passed away|killed|arrest(ed)?|charged|shooting|assault|domestic|crash|hospitali[sz]ed|cancer|tragic|mourn|memorial)\b/i

export function isSombre(title: string): boolean {
  return SOMBRE.test(title)
}

/** A stable pick from a list, so the same story always gets the same flavour line. */
function pick<T>(list: readonly T[], seed: string): T | null {
  if (list.length === 0) return null
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return list[Math.abs(h) % list.length]
}

/** "Houston Texans" → "#Texans"; "Portland Trail Blazers" → "#TrailBlazers". */
export function hashtagForTeam(name: string): string {
  const words = name.trim().split(/\s+/)
  const two = ['Trail Blazers', 'Red Sox', 'White Sox', 'Blue Jays', 'Maple Leafs', 'Blue Jackets', 'Golden Knights', 'Red Wings']
  const nick = two.find((n) => name.endsWith(n)) ?? words[words.length - 1] ?? name
  return `#${nick.replace(/[^A-Za-z0-9]/g, '')}`
}

const SPORT_TAGS: Record<string, string> = {
  NFL: '#NFL',
  NBA: '#NBA',
  MLB: '#MLB',
  NHL: '#NHL',
  NCAAF: '#CFB',
  NCAAB: '#CBB',
  SOCCER: '#MLS',
}

export function hashtagsFor(sport: string, teamNames: readonly string[]): string[] {
  const tags = [SPORT_TAGS[sport.toUpperCase()] ?? `#${sport.toUpperCase()}`, ...teamNames.slice(0, 3).map(hashtagForTeam)]
  return tags.filter((t, i) => t.length > 1 && tags.indexOf(t) === i)
}

/** Characters as X counts them. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(X_LINK_WEIGHT)).length
}

function lengthFor(platform: SocialPlatform, text: string): number {
  return platform === 'x' ? xLength(text) : text.length
}

function finish(platform: SocialPlatform, tone: SocialPost['tone'], text: string): SocialPost {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim()
  const charCount = lengthFor(platform, clean)
  return { platform, tone, text: clean, charCount, withinLimit: charCount <= SOCIAL_CHAR_LIMITS[platform] }
}

/** Trim a headline so an X post fits, keeping the source line and the link intact. */
function fitX(lead: string, headline: string, tail: string): string {
  const build = (h: string) => [lead, h, tail].filter(Boolean).join('\n\n')
  if (xLength(build(headline)) <= SOCIAL_CHAR_LIMITS.x) return build(headline)
  // Measured with a one-character placeholder, so the separators around the headline are counted.
  const room = SOCIAL_CHAR_LIMITS.x - (xLength(build('x')) - 1)
  return build(`${headline.slice(0, Math.max(20, room - 1)).trimEnd()}…`)
}

export function buildStoryPosts(story: StoryInput): SocialPost[] {
  const kind: BreakingKind | 'news' = story.classification?.kind ?? 'news'
  const report = story.classification?.confidence === 'report'
  const sombre = isSombre(story.title) || kind === 'injury' || kind === 'suspension'
  const tags = hashtagsFor(story.sport, story.teamNames)
  const via = story.outletHandle ? `via ${story.outletHandle}` : `via ${story.outletName}`
  const headline = story.title.trim()
  const reportNote = report ? ' (report)' : ''
  const desc = story.description?.trim() && story.description.trim() !== headline ? story.description.trim() : ''

  const straightLead = `${STRAIGHT_LEADS[kind]}${reportNote}`.trim()
  const funLead = sombre ? null : pick(FUN_LEADS[kind], headline)

  const posts: SocialPost[] = []

  // X — short, link last so the card renders.
  posts.push(finish('x', 'straight', fitX(straightLead, headline, `${via}\n${story.url}\n${tags.slice(0, 3).join(' ')}`)))
  if (funLead) posts.push(finish('x', 'fun', fitX(funLead, headline, `${via}\n${story.url}\n${tags.slice(0, 3).join(' ')}`)))

  // Threads — a little more room for the description.
  const threadsBody = [funLead ?? straightLead, headline, desc, `${via} 🔗 ${story.url}`, tags.join(' ')].filter(Boolean).join('\n\n')
  posts.push(finish('threads', funLead ? 'fun' : 'straight', threadsBody.length > SOCIAL_CHAR_LIMITS.threads ? [funLead ?? straightLead, headline, `${via} 🔗 ${story.url}`, tags.join(' ')].join('\n\n') : threadsBody))

  // Instagram — links do not click in captions, so the source is named and the link goes in bio/story.
  posts.push(
    finish(
      'instagram',
      funLead ? 'fun' : 'straight',
      [
        funLead ?? straightLead,
        headline,
        desc,
        `📰 Source: ${story.outletName}${report ? ' (report)' : ''} — full story linked in bio.`,
        sombre ? '' : 'Drop your take in the comments 👇',
        [...tags, '#AllFantasy', '#FantasySports'].join(' '),
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
  )

  // Facebook — link preview card does the visual work.
  posts.push(finish('facebook', funLead ? 'fun' : 'straight', [funLead ?? straightLead, headline, desc, `Source: ${story.outletName}`, story.url].filter(Boolean).join('\n\n')))

  // TikTok — a caption for a reaction/talking-head video, never a re-upload of their footage.
  posts.push(
    finish(
      'tiktok',
      funLead ? 'fun' : 'straight',
      [`${funLead ?? straightLead} ${headline}`, `Source: ${story.outletName}`, [...tags, '#sportstok', '#AllFantasy'].join(' ')].join('\n\n'),
    ),
  )

  // X — an engagement prompt. Opinions are asked for, never given: the post states no fact beyond
  // the outlet's headline, so the prompt is where the personality goes.
  const prompt = sombre ? null : pick(VIRAL_STORY_PROMPTS[kind], `${headline}|viral`)
  if (prompt) posts.push(finish('x', 'viral', fitX(prompt, headline, `${via}\n${story.url}\n${tags.slice(0, 2).join(' ')}`)))
  return posts
}

/** Engagement prompts per kind. Questions to the audience — never claims. */
const VIRAL_STORY_PROMPTS: Record<BreakingKind | 'news', readonly string[]> = {
  trade: ['Who won this trade? 👇', 'Grade this trade A–F 👇', 'Winners and losers? Go 👇'],
  signing: ['Grade this deal A–F 👇', 'Worth it? 👍 or 👎', 'Bargain or overpay? 👇'],
  release: ['Where do they land next? 👇', 'Right call? 👍 or 👎'],
  coaching: ['Grade the hire A–F 👇', 'Right call? 👍 or 👎', 'Who should they have gone after? 👇'],
  retirement: ['Favorite career moment? 👇', 'Hall of Fame? 👍 or 👎'],
  suspension: [],
  injury: [],
  news: ['Your reaction in one emoji 👇', 'Hot take time 🔥 Go 👇', 'Thoughts? 👇'],
}

export type HighlightInput = {
  sport: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  videoUrl: string
  postseason?: boolean
}

/** Posts for a game's official highlight video — the YouTube link, never a re-upload. */
export function buildHighlightPosts(h: HighlightInput): SocialPost[] {
  const score =
    h.homeScore != null && h.awayScore != null ? `${h.awayTeam} ${h.awayScore}, ${h.homeTeam} ${h.homeScore}` : `${h.awayTeam} vs. ${h.homeTeam}`
  const tags = hashtagsFor(h.sport, [h.awayTeam, h.homeTeam])
  const lead = pick(['🎥 Highlights', '📺 Catch up in 60 seconds', '🍿 The best of it', '▶️ Replay time'], `${h.homeTeam}${h.awayTeam}`) ?? '🎥 Highlights'
  return [
    finish('x', 'fun', `${lead}: ${score}\n\n▶️ ${h.videoUrl}\n🎬 Video via YouTube\n${tags.join(' ')}`),
    finish('threads', 'fun', `${lead}: ${score}\n\nWho was your player of the game? 👇\n\n▶️ ${h.videoUrl}\n🎬 Video via YouTube\n${tags.join(' ')}`),
    finish('facebook', 'fun', `${lead}: ${score}\n\n${h.videoUrl}`),
  ]
}


/* ── Tonight's games ─────────────────────────────────────────────────────────────────────────── */

export type GameInput = {
  sport: string
  homeTeam: string
  awayTeam: string
  /** ISO kickoff. Rendered in US Eastern, the clock most of this audience reads. */
  startTime: string
  venue?: string | null
  homeScore?: number | null
  awayScore?: number | null
  /** The game is over and both scores are known. */
  final?: boolean
  /** It went past regulation (overtime, extra innings, a shootout). */
  overtime?: boolean
  /** Decided by a shootout / penalties (TheSportsDB `AP`). */
  shootout?: boolean
}

const SPORT_EMOJI: Record<string, string> = {
  NFL: '🏈',
  NCAAF: '🏈',
  NBA: '🏀',
  NCAAB: '🏀',
  NHL: '🏒',
  MLB: '⚾',
  SOCCER: '⚽',
}

/** "One score" per sport, for calling a final close. */
const CLOSE_MARGIN: Record<string, number> = { NFL: 8, NCAAF: 8, NBA: 5, NCAAB: 5, NHL: 1, MLB: 1, SOCCER: 1 }

/** "Toronto Raptors" -> "Raptors"; a school stays whole ("Old Dominion"). */
function nick(name: string, sport: string): string {
  const S = sport.toUpperCase()
  if (S === 'NCAAF' || S === 'NCAAB' || S === 'SOCCER') return name
  return hashtagForTeam(name).slice(1).replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** "7:30 PM ET". */
export function easternTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d)} ET`
}

const PREVIEW_LEADS = [
  'Game night 🔥',
  'Lights. Camera. Action. 🎬',
  'Clear your schedule 📅',
  'Snacks ready? 🍿',
  'Main character energy tonight ⭐',
]

/** Posts for one of today's games: a straight listing and viral engagement prompts. */
export function buildGamePreviewPosts(g: GameInput): SocialPost[] {
  const S = g.sport.toUpperCase()
  const emoji = SPORT_EMOJI[S] ?? '🏟️'
  const away = nick(g.awayTeam, S)
  const home = nick(g.homeTeam, S)
  const when = easternTime(g.startTime)
  const line = `${g.awayTeam} at ${g.homeTeam}${when ? ` · ${when}` : ''}${g.venue ? ` · ${g.venue}` : ''}`
  const tags = hashtagsFor(S, [g.awayTeam, g.homeTeam]).join(' ')
  const seed = `${g.awayTeam}|${g.homeTeam}|${g.startTime}`

  const posts: SocialPost[] = [
    finish('x', 'straight', `${emoji} ${line}\n\n${tags}`),
    finish('x', 'fun', `${pick(PREVIEW_LEADS, seed)}\n\n${line}\n\n${tags}`),
    // The repost-or-like poll: the single most shareable format on X.
    finish('x', 'viral', `${away} or ${home}? ${emoji}\n\n🔁 Repost for ${away}\n❤️ Like for ${home}\n\n${when ? `${startWord(S)}: ${when}\n` : ''}${tags}`),
    finish('x', 'viral', `Predict the final score 👇\n\n${g.awayTeam} at ${g.homeTeam}${when ? ` · ${when}` : ''}\n\nClosest guess gets bragging rights 🏆\n${tags}`),
    finish('x', 'viral', `${pick(['Name one player who goes off tonight 🔥👇', `Tag the ${away} fan in your life 😤`, `Tag the ${home} fan in your life 😤`, 'Confidence level in your team tonight: 1–10 👇'], `${seed}|v3`)}\n\n${emoji} ${line}\n${tags}`),
    finish(
      'instagram',
      'viral',
      [`${emoji} ${away} vs ${home}`, line, `Who you got? Drop your score prediction in the comments 👇`, `${tags} #GameDay #AllFantasy`].join('\n\n'),
    ),
  ]
  return posts
}

function startWord(S: string): string {
  if (S === 'MLB') return 'First pitch'
  if (S === 'NHL') return 'Puck drop'
  if (S === 'NBA' || S === 'NCAAB') return 'Tip-off'
  return 'Kickoff'
}

/** Posts for a finished game. The score is the fact; everything else is a question. */
export function buildGameFinalPosts(g: GameInput): SocialPost[] {
  if (g.homeScore == null || g.awayScore == null) return []
  const S = g.sport.toUpperCase()
  const emoji = SPORT_EMOJI[S] ?? '🏟️'
  const away = nick(g.awayTeam, S)
  const home = nick(g.homeTeam, S)
  const a = g.awayScore
  const h = g.homeScore
  const tags = hashtagsFor(S, [g.awayTeam, g.homeTeam]).join(' ')
  const score = `${g.awayTeam} ${a}, ${g.homeTeam} ${h}`
  const margin = Math.abs(a - h)
  const close = margin <= (CLOSE_MARGIN[S] ?? 1)
  const winner = a === h ? null : a > h ? away : home
  const loser = a === h ? null : a > h ? home : away
  const seed = `${score}|final`

  const posts: SocialPost[] = [finish('x', 'straight', `FINAL ${emoji}\n\n${score}\n\n${tags}`)]
  if (g.overtime) {
    const bonus = S === 'MLB' ? 'FREE BASEBALL' : S === 'NHL' ? 'BONUS HOCKEY' : S === 'SOCCER' ? 'EXTRA TIME' : 'OVERTIME'
    const label =
      S === 'MLB'
        ? 'FINAL (extra innings)'
        : S === 'SOCCER'
          ? g.shootout
            ? 'FINAL (penalties)'
            : 'FINAL (extra time)'
          : g.shootout
            ? 'FINAL/SO'
            : 'FINAL/OT'
    posts.push(finish('x', 'fun', `WE NEEDED ${bonus} 😤${emoji}\n\n${label}: ${score}\n\n${tags}`))
  } else if (close) {
    posts.push(finish('x', 'fun', `${pick(['WHAT A FINISH 😱', 'Heart rate: 📈📈📈', 'They really made us sweat that one out 😮‍💨', 'Instant classic alert 🚨'], seed)}\n\nFINAL: ${score}\n\n${tags}`))
  } else if (winner) {
    posts.push(finish('x', 'fun', `${pick([`${winner} handled business ✅`, `Comfortable night for the ${winner} 😌`, `${winner} said "not tonight" 🙅`], seed)}\n\nFINAL: ${score}\n\n${tags}`))
  }
  if (winner && loser) {
    posts.push(finish('x', 'viral', `${winner} fans, how we feeling? 😎\n${loser} fans, we'll get 'em next time 🫡\n\nFINAL: ${score}\n${tags}`))
  }
  posts.push(finish('x', 'viral', `${pick(['Describe this game in one emoji 👇', 'Player of the game? Wrong answers only 😂👇', 'Rate this game 1–10 👇'], `${seed}|v2`)}\n\nFINAL: ${score}\n${tags}`))
  return posts
}
