/**
 * Survivor season story (survivor-core handoff §3, SeasonTimeline). Pure: turns already-public
 * league facts into timeline nodes, a trophy case and league records. No I/O; safe on the client.
 *
 * Privacy is decided by WHICH facts reach this module, and every input type below is narrow on
 * purpose. There is no field for a voter, a ballot, an unplayed idol or an unrevealed swap:
 *
 *  - Weekly moments come from `SurvivorShareMoment` rows, which the capture hooks only write once a
 *    Tribal Council read is complete, scores are final, an Exile return is resolved or the jury has
 *    crowned a winner (lib/survivor/shareCards/momentCapture.ts). Non-final rows are dropped here.
 *  - An idol play names its holder only when the holder published the card themselves. Otherwise
 *    the node says an idol was played that week and nothing more, because a non-protective power
 *    (vote steal, extra vote) does not reveal its player on the scroll.
 *  - Swaps count only once revealed; sealed draws (revealedAt null or in the future) are dropped.
 *  - Jurors and the merge are public the moment they happen.
 */

export type SeasonStoryMomentType = 'immunity' | 'out' | 'idol' | 'exile' | 'champ'

export interface SeasonStoryMoment {
  id: string
  type: SeasonStoryMomentType
  week: number
  final: boolean
  published: boolean
  /** Published facts only (see ShareMomentPayload). */
  displayName: string
  season: number | null
  tribeName: string | null
  tally?: string | null
  weeks?: number | null
  exileWeeks?: number | null
  immunityWins?: number | null
  idolName?: string | null
}

export interface SeasonStorySwap { week: number; revealedAt: Date | string | null }
export interface SeasonStoryJuror { votedOutWeek: number; displayName: string }

export interface SeasonStoryInput {
  season: number
  currentSeason: number
  /** First and last league week of the season (full-season plan window, else 1–13). */
  firstWeek: number
  lastWeek: number
  draftComplete: boolean
  moments: SeasonStoryMoment[]
  swaps: SeasonStorySwap[]
  jurors: SeasonStoryJuror[]
  /** Week the tribes merged; null until a merged tribe exists. */
  mergeWeek: number | null
  mergedTribeName: string | null
  mergedCount: number | null
  now?: Date
}

export type SeasonNodeKind = 'draft' | 'voted_out' | 'idol' | 'swap' | 'exile_return' | 'merge' | 'juror' | 'champion' | 'quiet' | 'upcoming'

export interface SeasonTimelineNode {
  key: string
  /** 0 for the draft node. */
  week: number
  kind: SeasonNodeKind
  /** Short caption under the dot, e.g. "O3 out", "Swap", "Juror 2". */
  label: string
  icon: string
  card: SeasonEventCard | null
}

export interface SeasonEventCard {
  kicker: string
  headline: string
  sub: string
  chips: string[]
  heroPath: string
  mood: 'day' | 'dusk' | 'night' | 'exile'
}

/** Highest first: a week shows its biggest event on the node. */
const PRIORITY: SeasonNodeKind[] = ['champion', 'merge', 'swap', 'exile_return', 'idol', 'juror', 'voted_out']

const ICON: Record<SeasonNodeKind, string> = {
  draft: '/survivor/idols/immunity-icon.svg',
  voted_out: '/survivor/weekly/torch-out-icon.svg',
  idol: '/survivor/idols/immunity-icon.svg',
  swap: '/survivor/late/buff-vela.svg',
  exile_return: '/survivor/exile/token-icon.svg',
  merge: '/survivor/late/buff-merge.svg',
  juror: '/survivor/late/jury-icon.svg',
  champion: '/survivor/late/champion-icon.svg',
  quiet: '/survivor/weekly/torch-lit-icon.svg',
  upcoming: '/survivor/weekly/torch-lit-icon.svg',
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** "Open Team 8" → "O8"; "TheCiege26" → "TheCiege26" trimmed to fit under a node. */
export function shortName(name: string): string {
  const clean = name.trim() || 'A manager'
  const team = /^open team\s+(\d+)$/i.exec(clean)
  if (team) return `O${team[1]}`
  return clean.length > 12 ? `${clean.slice(0, 11)}…` : clean
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

function tribeWord(name: string | null | undefined): string | null {
  const clean = (name ?? '').trim()
  if (!clean) return null
  return /^tribe\s/i.test(clean) ? clean : `Tribe ${clean}`
}

type WeekEvent = { kind: SeasonNodeKind; label: string; card: SeasonEventCard }

function momentEvent(moment: SeasonStoryMoment): WeekEvent | null {
  const name = moment.displayName.trim() || 'A manager'
  const tribe = tribeWord(moment.tribeName)
  switch (moment.type) {
    case 'out':
      return {
        kind: 'voted_out',
        label: `${shortName(name)} out`,
        card: {
          kicker: `Week ${moment.week} · Tribal Council`,
          headline: `${possessive(name)} torch is out`,
          sub: moment.tally ? `Voted out ${moment.tally}${tribe ? ` from ${tribe}` : ''}.` : `Voted out at Tribal Council${tribe ? ` from ${tribe}` : ''}.`,
          chips: [moment.tally ? `${moment.tally} vote` : null, moment.weeks ? `${moment.weeks} ${moment.weeks === 1 ? 'week' : 'weeks'} played` : null].filter((c): c is string => Boolean(c)),
          heroPath: '/survivor/weekly/torch-out.svg',
          mood: 'night',
        },
      }
    case 'idol':
      // The holder is named only if they shared the card themselves.
      return {
        kind: 'idol',
        label: 'Idol!',
        card: moment.published
          ? { kicker: `Week ${moment.week} · Idol played`, headline: `${name} played an idol`, sub: `${moment.idolName?.trim() || 'A hidden idol'} came out at Tribal Council.`, chips: ['Idol played'], heroPath: '/survivor/idols/immunity.svg', mood: 'night' }
          : { kicker: `Week ${moment.week} · Idol played`, headline: 'An idol was played', sub: 'Someone pulled an idol at Tribal Council. Who played it stays with them.', chips: ['Idol played'], heroPath: '/survivor/idols/immunity.svg', mood: 'night' },
      }
    case 'exile':
      return {
        kind: 'exile_return',
        label: 'Return',
        card: {
          kicker: `Week ${moment.week} · Exile Island`,
          headline: `${name} is back in the game`,
          sub: `Earned the way back from Exile Island${moment.exileWeeks ? ` after ${moment.exileWeeks} ${moment.exileWeeks === 1 ? 'week' : 'weeks'}` : ''}.`,
          chips: ['Exile return'],
          heroPath: '/survivor/exile/token-coin-earned.svg',
          mood: 'exile',
        },
      }
    case 'champ':
      return {
        kind: 'champion',
        label: 'Champion',
        card: {
          kicker: `Week ${moment.week} · Final Tribal Council`,
          headline: `${name} is the last one standing`,
          sub: moment.tally ? `Won the jury vote ${moment.tally}.` : 'Won the final jury vote.',
          chips: [moment.tally ? `Jury ${moment.tally}` : null, moment.immunityWins ? `${moment.immunityWins} immunity ${moment.immunityWins === 1 ? 'win' : 'wins'}` : null].filter((c): c is string => Boolean(c)),
          heroPath: '/survivor/late/champion-trophy.svg',
          mood: 'day',
        },
      }
    default:
      return null
  }
}

/**
 * One node for the draft plus one per week. A week with several events shows the highest-priority
 * one on its node (champion > merge > swap > Exile return > idol > juror > voted out).
 */
export function buildSeasonTimeline(input: SeasonStoryInput): SeasonTimelineNode[] {
  const now = (input.now ?? new Date()).getTime()
  const isCurrent = input.season === input.currentSeason
  const byWeek = new Map<number, WeekEvent[]>()
  const push = (week: number, event: WeekEvent) => {
    if (!Number.isInteger(week) || week < 1) return
    const list = byWeek.get(week) ?? []
    list.push(event)
    byWeek.set(week, list)
  }

  for (const moment of input.moments) {
    if (!moment.final) continue
    if (moment.season != null && moment.season !== input.season) continue
    if (moment.season == null && !isCurrent) continue
    const event = momentEvent(moment)
    if (event) push(moment.week, event)
  }

  if (isCurrent) {
    for (const swap of input.swaps) {
      const revealed = toMs(swap.revealedAt)
      if (revealed == null || revealed > now) continue
      push(swap.week, { kind: 'swap', label: 'Swap', card: { kicker: `Week ${swap.week} · Tribe swap`, headline: 'New tribes', sub: 'The buffs came off and the tribes were redrawn.', chips: ['Tribe swap'], heroPath: '/survivor/late/buff-vela.svg', mood: 'day' } })
    }
    if (input.mergeWeek != null) {
      const name = input.mergedTribeName?.trim()
      push(input.mergeWeek, {
        kind: 'merge',
        label: 'Merge',
        card: {
          kicker: `Week ${input.mergeWeek} · The merge`,
          headline: name ? `Welcome to ${name}` : 'The tribes merge',
          sub: `The tribes became one${input.mergedCount ? ` tribe of ${input.mergedCount}` : ''}. From here on, everyone voted out joins the jury.`,
          chips: [input.mergedCount ? `${input.mergedCount} managers` : null, 'Jury begins'].filter((c): c is string => Boolean(c)),
          heroPath: '/survivor/late/merge-banner.svg',
          mood: 'dusk',
        },
      })
    }
    const jurors = [...input.jurors].sort((a, b) => a.votedOutWeek - b.votedOutWeek)
    jurors.forEach((juror, index) => {
      push(juror.votedOutWeek, {
        kind: 'juror',
        label: `Juror ${index + 1}`,
        card: { kicker: `Week ${juror.votedOutWeek} · The jury`, headline: `${juror.displayName.trim() || 'A manager'} takes a jury seat`, sub: `Juror ${index + 1} will help pick the champion at Final Tribal Council.`, chips: [`Juror ${index + 1}`], heroPath: '/survivor/late/jury-bench.svg', mood: 'dusk' },
      })
    })
  }

  const lastEventWeek = Math.max(0, ...byWeek.keys())
  const firstWeek = Math.max(1, Math.min(input.firstWeek, ...byWeek.keys()))
  const lastWeek = Math.max(input.lastWeek, lastEventWeek)
  const nodes: SeasonTimelineNode[] = [{
    key: 'draft',
    week: 0,
    kind: 'draft',
    label: input.draftComplete ? 'Idols hidden' : 'Draft',
    icon: ICON.draft,
    card: input.draftComplete
      ? { kicker: 'The draft', headline: 'The idols are hidden', sub: 'Rosters are set, tribes are drawn and the idols are out there somewhere.', chips: ['Draft complete'], heroPath: '/survivor/idols/immunity.svg', mood: 'day' }
      : null,
  }]
  for (let week = firstWeek; week <= lastWeek; week++) {
    const events = byWeek.get(week) ?? []
    const top = [...events].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0]
    if (top) {
      nodes.push({ key: `w${week}`, week, kind: top.kind, label: top.label, icon: ICON[top.kind], card: top.card })
    } else {
      const kind: SeasonNodeKind = week <= lastEventWeek ? 'quiet' : 'upcoming'
      nodes.push({ key: `w${week}`, week, kind, label: kind === 'quiet' ? 'Safe week' : '—', icon: ICON[kind], card: null })
    }
  }
  return nodes
}

export interface TrophyRecord {
  season: number
  championName: string
  sport: string | null
  /** e.g. "Jury 3–1–1 · 5 immunity wins" */
  line: string
}

export interface ChampionshipRow { season: number; teamName: string | null; playoffRecord: string | null }

/** One shelf per finished season, newest first. Display names only. */
export function buildTrophyCase(championships: ChampionshipRow[], champMoments: SeasonStoryMoment[], sport: string | null): TrophyRecord[] {
  const champBySeason = new Map<number, SeasonStoryMoment>()
  for (const moment of champMoments) {
    if (moment.type === 'champ' && moment.final && moment.season != null) champBySeason.set(moment.season, moment)
  }
  return [...championships]
    .filter(row => Number.isInteger(row.season))
    .sort((a, b) => b.season - a.season)
    .map(row => {
      const moment = champBySeason.get(row.season)
      const parts = [
        moment?.tally ? `Jury ${moment.tally}` : row.playoffRecord?.trim() || null,
        moment?.immunityWins ? `${moment.immunityWins} immunity ${moment.immunityWins === 1 ? 'win' : 'wins'}` : null,
      ].filter((p): p is string => Boolean(p))
      return { season: row.season, championName: row.teamName?.trim() || moment?.displayName || 'Champion', sport, line: parts.join(' · ') }
    })
}

export interface LeagueRecord {
  key: string
  title: string
  holder: string
  value: string
  icon: string
}

function juryMargin(tally: string | null | undefined): number | null {
  if (!tally) return null
  const parts = tally.split(/[–-]/).map(n => Number(n.trim())).filter(n => Number.isFinite(n))
  if (parts.length < 2) return null
  return parts[0] - parts[1]
}

/**
 * Records across every season this league has data for. Each record reads only final moments and
 * championship rows. Idol records count published idol cards only, for the reason given above.
 */
export function buildLeagueRecords(moments: SeasonStoryMoment[], championships: ChampionshipRow[]): LeagueRecord[] {
  const finals = moments.filter(m => m.final)
  const records: LeagueRecord[] = []

  const immunity = new Map<string, { name: string; season: number | null; count: number }>()
  for (const m of finals.filter(m => m.type === 'immunity')) {
    const key = `${m.season ?? ''}:${m.displayName}`
    const row = immunity.get(key) ?? { name: m.displayName, season: m.season, count: 0 }
    row.count++
    immunity.set(key, row)
  }
  const topImmunity = [...immunity.values()].sort((a, b) => b.count - a.count)[0]
  if (topImmunity) records.push({ key: 'immunity', title: 'Most immunity wins, one season', holder: topImmunity.season ? `${topImmunity.name} · ${topImmunity.season}` : topImmunity.name, value: String(topImmunity.count), icon: '/survivor/weekly/immunity-necklace-icon.svg' })

  const idols = new Map<string, number>()
  for (const m of finals.filter(m => m.type === 'idol' && m.published)) idols.set(m.displayName, (idols.get(m.displayName) ?? 0) + 1)
  const topIdol = [...idols.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topIdol) records.push({ key: 'idols', title: 'Most idols played, career', holder: topIdol[0], value: String(topIdol[1]), icon: '/survivor/idols/immunity-icon.svg' })

  const titles = new Map<string, number>()
  for (const row of championships) {
    const name = row.teamName?.trim()
    if (name) titles.set(name, (titles.get(name) ?? 0) + 1)
  }
  if (titles.size) {
    const sorted = [...titles.entries()].sort((a, b) => b[1] - a[1])
    const best = sorted[0][1]
    const holders = sorted.filter(([, n]) => n === best)
    records.push({ key: 'titles', title: 'Most titles', holder: holders.length === 1 ? holders[0][0] : `${best === 1 ? 'One each' : `${best} each`} · ${holders.length} champions`, value: String(best), icon: '/survivor/late/champion-icon.svg' })
  }

  const exile = finals.filter(m => m.type === 'exile' && typeof m.exileWeeks === 'number' && m.exileWeeks > 0).sort((a, b) => (b.exileWeeks ?? 0) - (a.exileWeeks ?? 0))[0]
  if (exile) records.push({ key: 'exile', title: 'Longest stay on Exile Island', holder: exile.season ? `${exile.displayName} · ${exile.season}` : exile.displayName, value: `${exile.exileWeeks} wks`, icon: '/survivor/exile/token-icon.svg' })

  const run = finals.filter(m => m.type === 'out' && typeof m.weeks === 'number' && m.weeks > 0).sort((a, b) => (b.weeks ?? 0) - (a.weeks ?? 0))[0]
  if (run) records.push({ key: 'run', title: 'Longest run before the torch went out', holder: run.season ? `${run.displayName} · ${run.season}` : run.displayName, value: `${run.weeks} wks`, icon: '/survivor/weekly/torch-out-icon.svg' })

  const jury = finals.filter(m => m.type === 'champ' && juryMargin(m.tally) != null).sort((a, b) => (juryMargin(b.tally) ?? 0) - (juryMargin(a.tally) ?? 0))[0]
  if (jury?.tally) records.push({ key: 'jury', title: 'Biggest jury win', holder: jury.season ? `${jury.displayName} · ${jury.season}` : jury.displayName, value: jury.tally, icon: '/survivor/late/jury-icon.svg' })

  return records
}
