/**
 * Pure copy + art selection for Survivor share cards. One function turns a stored moment into
 * everything the renderer and the share UI show, so the PNG, the moment page and the modal can
 * never disagree. No I/O; safe on the client.
 */
import type { ShareCardFormat, ShareMomentPayload, ShareMomentType } from './types'

export type ShareMood = 'day' | 'dusk' | 'night' | 'exile'

export interface ShareCardTheme {
  accent: string
  head: string
  glow: string
}

export interface ShareCardContent {
  kicker: string
  headline: string
  sub: string
  stats: Array<{ value: string; label: string }>
  heroPath: string
  backgroundPath: string
  mood: ShareMood
  theme: ShareCardTheme
  leagueName: string
  crestPath: string | null
  footerSport: string
}

/** Moods and accents from share.css (`.shc-m-*`). Immunity uses the base gold. */
const THEMES: Record<ShareMomentType, ShareCardTheme> = {
  immunity: { accent: '#f2c94c', head: '#f1d58a', glow: 'rgba(242,201,76,.45)' },
  out: { accent: '#ff9a3c', head: '#f3ead6', glow: 'rgba(255,122,42,.35)' },
  idol: { accent: '#7fe0c0', head: '#f1d58a', glow: 'rgba(127,224,192,.4)' },
  exile: { accent: '#f2c94c', head: '#f1d58a', glow: 'rgba(242,201,76,.5)' },
  champ: { accent: '#f2c94c', head: '#ffe7a3', glow: 'rgba(255,214,107,.6)' },
  recap: { accent: '#ffb35c', head: '#f3ead6', glow: 'rgba(255,170,80,.4)' },
}

const MOODS: Record<ShareMomentType, ShareMood> = { immunity: 'dusk', out: 'night', idol: 'night', exile: 'exile', champ: 'day', recap: 'dusk' }

const HERO: Record<Exclude<ShareMomentType, 'idol'>, string> = {
  immunity: '/survivor/weekly/immunity-necklace.svg',
  out: '/survivor/weekly/torch-out.svg',
  exile: '/survivor/exile/token-coin-earned.svg',
  champ: '/survivor/late/champion-trophy.svg',
  recap: '/survivor/weekly/torch-lit.svg',
}

const ICON: Record<Exclude<ShareMomentType, 'idol'>, string> = {
  immunity: '/survivor/weekly/immunity-necklace-icon.svg',
  out: '/survivor/weekly/torch-out-icon.svg',
  exile: '/survivor/exile/token-icon.svg',
  champ: '/survivor/late/champion-icon.svg',
  recap: '/survivor/weekly/torch-lit-icon.svg',
}

const DEFAULT_IDOL_ID = 'immunity'
const SAFE_ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Catalog ids become file names; anything that is not a plain slug falls back to the default idol. */
export function safeIdolId(id: string | null | undefined): string {
  return id && SAFE_ASSET_ID.test(id) ? id : DEFAULT_IDOL_ID
}

const SPORT_SCENE: Record<string, string> = {
  NFL: 'football', NCAAF: 'football', NBA: 'basketball', NCAAB: 'basketball', WNBA: 'basketball',
  NHL: 'hockey', MLB: 'baseball', SOCCER: 'soccer',
}

/** `/survivor/backgrounds/{mood}-{sport}.svg` — the README's `survivor/bg/` lives here in this repo. */
export function shareBackgroundPath(mood: ShareMood, sport: string | null | undefined): string {
  const scene = SPORT_SCENE[String(sport ?? '').toUpperCase()] ?? 'football'
  return `/survivor/backgrounds/${mood}-${scene}.svg`
}

export function shareSportLabel(sport: string | null | undefined): string {
  const code = String(sport ?? '').toUpperCase()
  if (code === 'SOCCER') return 'Soccer'
  return code || 'NFL'
}

export function shareHeroPath(type: ShareMomentType, payload: Pick<ShareMomentPayload, 'idolId'>): string {
  return type === 'idol' ? `/survivor/idols/${safeIdolId(payload.idolId)}.svg` : HERO[type]
}

export function shareIconPath(type: ShareMomentType, payload: Pick<ShareMomentPayload, 'idolId'>): string {
  return type === 'idol' ? `/survivor/idols/${safeIdolId(payload.idolId)}-icon.svg` : ICON[type]
}

export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n))
  const tens = v % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : v % 10 === 1 ? 'st' : v % 10 === 2 ? 'nd' : v % 10 === 3 ? 'rd' : 'th'
  return `${v}${suffix}`
}

export function formatPoints(points: number): string {
  return points.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** "Vela" → "Tribe Vela"; a name that already says Tribe is left alone. */
export function tribeLabel(name: string | null | undefined): string | null {
  const clean = (name ?? '').trim()
  if (!clean) return null
  return /^tribe\b/i.test(clean) ? clean : `Tribe ${clean}`
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export const SHARE_MOMENT_TITLES: Record<ShareMomentType, string> = {
  immunity: 'Immunity win',
  out: 'Voted out',
  idol: 'Idol played',
  exile: 'Back from Exile',
  champ: 'Season champion',
  recap: 'Week recap',
}

export const SHARE_MOMENT_OFFERED: Record<ShareMomentType, string> = {
  immunity: 'To the immunity winner, right after scores go final.',
  out: 'To the manager who was voted out, after the torch-out plays. Optional: they choose whether to share.',
  idol: 'To the manager who played an idol, once the scroll reveal shows it.',
  exile: 'To a manager who returns from Exile Island with enough tokens.',
  champ: 'To the champion after the final jury vote, and to the whole league as a recap.',
  recap: 'To the whole league after each Tribal Council read. Names no manager, only the tribe and the counts.',
}

/** Copy for the phone sheet heading, e.g. "Share your immunity win". */
export function shareSheetHeading(type: ShareMomentType, isSubject: boolean): string {
  if (type === 'champ' && !isSubject) return 'Share the season recap'
  if (type === 'recap') return 'Share this week’s recap'
  return {
    immunity: 'Share your immunity win',
    out: 'Share your exit',
    idol: 'Share your idol play',
    exile: 'Share your return',
    champ: 'Share your championship',
    recap: 'Share this week’s recap',
  }[type]
}

export function buildShareCardContent(type: ShareMomentType, week: number, payload: ShareMomentPayload): ShareCardContent {
  const name = payload.displayName.trim() || 'A manager'
  const tribe = tribeLabel(payload.tribeName)
  const stats: Array<{ value: string; label: string }> = []
  let kicker = ''
  let headline = ''
  let sub = ''

  switch (type) {
    case 'immunity': {
      kicker = `Immunity · Week ${week}`
      headline = `${name} is safe`
      sub = payload.rankScope === 'tribe' && tribe
        ? `Top score in ${tribe}. Can’t receive votes this week.`
        : 'Top score on the island. Can’t receive votes this week.'
      if (finite(payload.points)) stats.push({ value: formatPoints(payload.points), label: 'Points' })
      if (finite(payload.rank)) stats.push({ value: ordinal(payload.rank), label: payload.rankScope === 'tribe' ? 'In tribe' : 'On island' })
      if (finite(payload.immunityWins)) stats.push({ value: String(payload.immunityWins), label: payload.immunityWins === 1 ? 'Win' : 'Wins' })
      break
    }
    case 'out': {
      kicker = `Voted out · Week ${week}`
      headline = `${possessive(name)} torch is out`
      const next = payload.next === 'exile' ? ' Heading to Exile Island.' : payload.next === 'jury' ? ' Takes a seat on the jury.' : ''
      sub = payload.tally ? `Voted out ${payload.tally} at Tribal Council.${next}` : `Voted out at Tribal Council.${next}`
      if (payload.tally) stats.push({ value: payload.tally, label: 'Vote' })
      if (finite(payload.weeks)) stats.push({ value: String(payload.weeks), label: payload.weeks === 1 ? 'Week' : 'Weeks' })
      if (finite(payload.points)) stats.push({ value: formatPoints(payload.points), label: 'Points' })
      break
    }
    case 'idol': {
      kicker = `Idol played · Week ${week}`
      headline = `${name} played an idol`
      const idolName = (payload.idolName ?? '').trim() || 'a hidden idol'
      if (payload.idolProtective && finite(payload.votesCancelled) && payload.votesCancelled > 0) {
        sub = 'Every vote against them was cancelled. The tribe never saw it coming.'
        stats.push({ value: String(payload.votesCancelled), label: payload.votesCancelled === 1 ? 'Vote cancelled' : 'Votes cancelled' })
        stats.push({ value: String(payload.votesCounted ?? 0), label: 'Counted' })
      } else {
        sub = `Played ${idolName} at Tribal Council and lived to tell it.`
        stats.push({ value: idolName.length <= 14 ? idolName : 'Idol', label: 'Advantage' })
        stats.push({ value: String(week), label: 'Week' })
      }
      break
    }
    case 'exile': {
      kicker = 'Back in the game'
      headline = `${name} returns from Exile`
      const tokens = finite(payload.tokens) ? payload.tokens : null
      const where = tribe ? `Rejoins ${tribe}` : 'Rejoins the island'
      const when = finite(payload.rejoinWeek) ? ` in week ${payload.rejoinWeek}` : ''
      sub = tokens != null
        ? `${tokens === 1 ? 'One token' : `${tokens} tokens`} earned on Exile Island. ${where}${when}.`
        : `${where}${when}.`
      if (tokens != null) stats.push({ value: String(tokens), label: tokens === 1 ? 'Token' : 'Tokens' })
      if (finite(payload.exileWeeks)) stats.push({ value: String(payload.exileWeeks), label: payload.exileWeeks === 1 ? 'Week on Exile' : 'Weeks on Exile' })
      break
    }
    case 'champ': {
      kicker = 'Season champion'
      headline = `${name} is the last one standing`
      const after = finite(payload.weeks) ? ` after ${payload.weeks} weeks` : ''
      sub = payload.tally ? `Won the jury vote ${payload.tally}${after}.` : `Won the final jury vote${after}.`
      if (payload.tally) stats.push({ value: payload.tally, label: 'Jury' })
      if (finite(payload.immunityWins)) stats.push({ value: String(payload.immunityWins), label: 'Immunity' })
      if (finite(payload.points)) stats.push({ value: formatPoints(payload.points), label: 'Points' })
      break
    }
    case 'recap': {
      kicker = `Week ${week} · Tribal Council`
      const remaining = finite(payload.remaining) ? payload.remaining : null
      headline = remaining != null
        ? `${remaining} ${remaining === 1 ? 'castaway remains' : 'castaways remain'}`
        : 'One more torch goes out'
      const who = payload.merged ? 'The merged tribe' : tribe ?? 'A tribe'
      const exile = finite(payload.onExile) && payload.onExile > 0
        ? ` ${payload.onExile === 1 ? 'One castaway is' : `${payload.onExile} are`} on Exile Island.`
        : ''
      sub = `${who} went to Tribal Council, and one more torch went out.${exile}`
      if (remaining != null) stats.push({ value: String(remaining), label: 'Remaining' })
      if (finite(payload.onExile)) stats.push({ value: String(payload.onExile), label: 'On Exile' })
      stats.push({ value: String(week), label: 'Week' })
      break
    }
  }

  const mood = MOODS[type]
  return {
    kicker,
    headline,
    sub,
    stats: stats.slice(0, 3),
    heroPath: shareHeroPath(type, payload),
    backgroundPath: shareBackgroundPath(mood, payload.sport),
    mood,
    theme: THEMES[type],
    leagueName: payload.leagueName.trim() || 'Survivor League',
    crestPath: payload.crestPath,
    footerSport: `${shareSportLabel(payload.sport)} ${payload.season}`,
  }
}

/** Link shows at most two stat tiles (README card anatomy, item 6). */
export function statsForFormat(content: ShareCardContent, format: ShareCardFormat) {
  return format === 'link' ? content.stats.slice(0, 2) : content.stats
}

/**
 * Cinzel sizes from the README: 84 post, 100 story, 54 link. A long headline drops to the next
 * size down so it stays within two lines.
 */
export function headlineFontSize(format: ShareCardFormat, headline: string): number {
  const steps: Record<ShareCardFormat, [number, number, number]> = { post: [84, 70, 60], story: [100, 84, 72], link: [54, 46, 40] }
  // Rough line capacity per size, measured against the reference renders at each export width.
  // Story allows three lines, so it holds more characters at its larger size.
  const capacity: Record<ShareCardFormat, [number, number]> = { post: [38, 46], story: [42, 52], link: [38, 46] }
  const len = headline.length
  const [big, mid, small] = steps[format]
  if (len <= capacity[format][0]) return big
  if (len <= capacity[format][1]) return mid
  return small
}
