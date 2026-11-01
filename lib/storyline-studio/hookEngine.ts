import type {
  HookFact,
  HookKind,
  HookLanguage,
  StoryData,
  StoryFixture,
  StoryHook,
  TeamKey,
} from './types'

/**
 * THE HOOK ENGINE — deterministic trash-talk starters for this week's matchups, built only from
 * rows the league already has in Postgres.
 *
 * 🛑 EVERY NUMBER IN A HOOK'S TEXT COMES FROM ITS FACTS, AND THAT IS CHECKED, NOT HOPED. A hook is a
 * template plus a list of facts; the text is rendered by substituting facts into `{placeholders}`,
 * and `guardHook` then re-reads the rendered text and refuses it if any number in it is not one of
 * its facts. A template that names a fact the data did not supply is DROPPED, never filled with a
 * default — "{points} points" with no points is the fabricated recap `app/api/league-story` was
 * rewritten to stop, and a dropped hook costs nothing.
 *
 * Pure: no prisma, no fetch, no clock. `./loadStoryData.ts` reads the rows.
 *
 * Trash talk is about fantasy teams and play — records, scores, picks. Templates name teams and
 * players, never managers as people.
 */

const round1 = (n: number) => Math.round(n * 10) / 10

/** How a numeric fact appears in text. One rule, so the guard can recognise it. */
export function formatFactNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const r = round1(n)
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/* ─── Templates ─────────────────────────────────────────────────────────────────────────────── */

type TemplateSet = Record<HookLanguage, string>

/**
 * Spanish uses «reclamo» for waiver concepts, never «waiver» — the house rule for every string.
 */
export const HOOK_TEMPLATES: Record<string, TemplateSet> = {
  rivalry_lead: {
    en: '{leaderTeam} leads the all-time series with {trailerTeam} {leaderWins}-{trailerWins}. Last time out, in week {lastWeek} of {lastSeason}, {lastWinnerTeam} won {lastWinnerScore}-{lastLoserScore}.',
    es: '{leaderTeam} domina la serie histórica ante {trailerTeam} {leaderWins}-{trailerWins}. La última vez, en la semana {lastWeek} de {lastSeason}, {lastWinnerTeam} ganó {lastWinnerScore}-{lastLoserScore}.',
  },
  rivalry_even: {
    en: '{teamA} and {teamB} are dead even all-time at {wins}-{wins}. Last time out, in week {lastWeek} of {lastSeason}, {lastWinnerTeam} won {lastWinnerScore}-{lastLoserScore}. Somebody breaks the tie.',
    es: '{teamA} y {teamB} están empatados en la historia {wins}-{wins}. La última vez, en la semana {lastWeek} de {lastSeason}, {lastWinnerTeam} ganó {lastWinnerScore}-{lastLoserScore}. Alguien rompe el empate.',
  },
  rivalry_streak: {
    en: '{streakTeam} has beaten {otherTeam} {streak} straight times. Does the streak live another week?',
    es: '{streakTeam} le ha ganado a {otherTeam} {streak} veces seguidas. ¿Sigue la racha una semana más?',
  },
  playoff_title: {
    en: 'This one has history: {winnerTeam} beat {loserTeam} in the {season} championship game. Rematch time.',
    es: 'Este partido tiene historia: {winnerTeam} venció a {loserTeam} en la final de {season}. Hora de la revancha.',
  },
  playoff_elimination: {
    en: 'Playoff memory: {winnerTeam} knocked {loserTeam} out of the {season} playoffs. {loserTeam} has not forgotten.',
    es: 'Recuerdo de playoffs: {winnerTeam} eliminó a {loserTeam} en los playoffs de {season}. {loserTeam} no lo ha olvidado.',
  },
  revenge_one: {
    en: 'Revenge game: {player} played a week for {formerTeam} in {formerSeason} and scored {points} points for them. Now he lines up for {nowTeam} — against {formerTeam}. Roles have changed. Will he have the same success?',
    es: 'Partido de venganza: {player} jugó una semana con {formerTeam} en {formerSeason} y les dio {points} puntos. Ahora juega para {nowTeam}, contra {formerTeam}. Los papeles cambiaron. ¿Tendrá el mismo éxito?',
  },
  revenge: {
    en: 'Revenge game: {player} played {weeks} weeks for {formerTeam} in {formerSeason} and scored {points} points for them. Now he lines up for {nowTeam} — against {formerTeam}. Roles have changed. Will he have the same success?',
    es: 'Partido de venganza: {player} jugó {weeks} semanas con {formerTeam} en {formerSeason} y les dio {points} puntos. Ahora juega para {nowTeam}, contra {formerTeam}. Los papeles cambiaron. ¿Tendrá el mismo éxito?',
  },
  draft_steal_round: {
    en: '{team} drafted a late-round sleeper: {player} went in round {round} of the {season} draft and has scored {points} points — number {rank} among everyone drafted in this league.',
    es: '{team} encontró una joya tardía: {player} salió en la ronda {round} del draft de {season} y lleva {points} puntos, el número {rank} entre todos los elegidos en esta liga.',
  },
  one_man_army: {
    en: 'Week {week} of {season}: {player} scored {points} for {team} — by himself more than the entire {victimTeam} starting lineup ({victimPoints}).',
    es: 'Semana {week} de {season}: {player} anotó {points} para {team}, él solo más que toda la alineación titular de {victimTeam} ({victimPoints}).',
  },
  streak_hot_cold: {
    en: '{hotTeam} has won {hotStreak} straight. {coldTeam} has lost {coldStreak} straight. Something has to give.',
    es: '{hotTeam} ganó {hotStreak} seguidos. {coldTeam} perdió {coldStreak} seguidos. Algo tiene que ceder.',
  },
  streak_single: {
    en: '{team} has {result} {streak} straight. {otherTeam} is next.',
    es: '{team} lleva {streak} {result} seguidas. {otherTeam} es el siguiente.',
  },
  leader_vs_cellar: {
    en: 'Top vs bottom: {leaderTeam} leads the league with {leaderPoints} points scored. {cellarTeam} has {cellarPoints} — the fewest in the league.',
    es: 'Primero contra último: {leaderTeam} lidera la liga con {leaderPoints} puntos anotados. {cellarTeam} tiene {cellarPoints}, los menos de la liga.',
  },
  title_rematch: {
    en: 'A rematch of the {season} title game: {winnerTeam} beat {loserTeam} {winnerScore}-{loserScore} for the crown. Can {loserTeam} get even?',
    es: 'Revancha de la final de {season}: {winnerTeam} venció a {loserTeam} {winnerScore}-{loserScore} por el título. ¿Podrá {loserTeam} cobrársela?',
  },
  blowout: {
    en: 'Biggest blowout in this series: {winnerTeam} beat {loserTeam} by {margin} in week {week} of {season} ({winnerScore}-{loserScore}).',
    es: 'La mayor paliza de esta serie: {winnerTeam} le ganó a {loserTeam} por {margin} en la semana {week} de {season} ({winnerScore}-{loserScore}).',
  },
}

const STREAK_WORDS: Record<HookLanguage, { won: string; lost: string }> = {
  en: { won: 'won', lost: 'lost' },
  es: { won: 'victorias', lost: 'derrotas' },
}

/* ─── Rendering and the fact guard ──────────────────────────────────────────────────────────── */

/**
 * Render a template from facts. Null when ANY placeholder has no fact (or an empty one): the hook
 * is dropped rather than filled in.
 */
export function renderTemplate(template: string, facts: readonly HookFact[]): string | null {
  const byKey = new Map(facts.map((f) => [f.key, f.value]))
  let missing = false
  const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = byKey.get(key)
    if (v == null) {
      missing = true
      return ''
    }
    const s = typeof v === 'number' ? formatFactNumber(v) : v.trim()
    if (!s) missing = true
    return s
  })
  return missing ? null : text
}

/**
 * The fact guard. True only when every number in `text` is a fact's value — after removing the
 * fact strings themselves, because a team named "Gridiron 99" carries a number that is a name.
 */
export function textIsSupportedByFacts(text: string, facts: readonly HookFact[]): boolean {
  let rest = text
  const strings = facts
    .map((f) => (typeof f.value === 'string' ? f.value.trim() : ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const s of strings) rest = rest.split(s).join(' ')
  const allowed = new Set(
    facts.flatMap((f) => (typeof f.value === 'number' ? [formatFactNumber(f.value)] : extractNumbers(f.value))),
  )
  return extractNumbers(rest).every((n) => allowed.has(n))
}

function extractNumbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? []
}

/** Render + guard. Null drops the hook. */
export function guardHook(
  base: Omit<StoryHook, 'text'>,
  templateKey: keyof typeof HOOK_TEMPLATES,
  language: HookLanguage,
): StoryHook | null {
  const template = HOOK_TEMPLATES[templateKey]?.[language]
  if (!template) return null
  const text = renderTemplate(template, base.facts)
  if (!text) return null
  if (!textIsSupportedByFacts(text, base.facts)) return null
  return { ...base, text }
}

/* ─── Helpers over the data ─────────────────────────────────────────────────────────────────── */

function name(data: StoryData, key: TeamKey): string | null {
  return data.teams.get(key)?.name?.trim() || null
}

function pairKey(a: TeamKey, b: TeamKey): string {
  return [a, b].sort().join('|')
}

/** Completed games between two teams, oldest first, from a's point of view. */
export function headToHead(fixtures: readonly StoryFixture[], a: TeamKey, b: TeamKey) {
  return fixtures
    .filter((f) => f.final && ((f.a === a && f.b === b) || (f.a === b && f.b === a)))
    .map((f) => {
      const mine = f.a === a ? f.scoreA : f.scoreB
      const theirs = f.a === a ? f.scoreB : f.scoreA
      return { season: f.season, week: f.week, mine, theirs }
    })
    .sort((x, y) => x.season - y.season || x.week - y.week)
}

/** A team's current streak this season: +n won n straight, -n lost n straight, 0 none. */
export function currentStreak(fixtures: readonly StoryFixture[], team: TeamKey, season: number): number {
  const games = fixtures
    .filter((f) => f.final && f.season === season && (f.a === team || f.b === team))
    .sort((x, y) => y.week - x.week)
  let streak = 0
  for (const g of games) {
    const mine = g.a === team ? g.scoreA : g.scoreB
    const theirs = g.a === team ? g.scoreB : g.scoreA
    if (mine === theirs) break
    const won = mine > theirs
    if (streak === 0) streak = won ? 1 : -1
    else if (won && streak > 0) streak += 1
    else if (!won && streak < 0) streak -= 1
    else break
  }
  return streak
}

type Builder = (data: StoryData, m: { a: TeamKey; b: TeamKey; matchupId?: string }, lang: HookLanguage) => StoryHook[]

function base(
  data: StoryData,
  kind: HookKind,
  m: { a: TeamKey; b: TeamKey; matchupId?: string } | null,
  idTail: string,
  score: number,
  facts: HookFact[],
  extra: { teams?: TeamKey[]; players?: string[] } = {},
): Omit<StoryHook, 'text'> {
  const teams = extra.teams ?? (m ? [m.a, m.b] : [])
  return {
    id: `${kind}:${m ? pairKey(m.a, m.b) : 'league'}:${idTail}`,
    kind,
    score,
    season: data.season,
    week: data.week,
    matchup: m,
    teams,
    players: extra.players ?? [],
    facts,
  }
}

/* ─── The kinds ─────────────────────────────────────────────────────────────────────────────── */

/** All-time head-to-head, the last meeting, and a winning streak in the series. */
export const rivalryRecord: Builder = (data, m, lang) => {
  const games = headToHead(data.fixtures, m.a, m.b).filter((g) => g.mine !== g.theirs)
  const nameA = name(data, m.a)
  const nameB = name(data, m.b)
  if (games.length === 0 || !nameA || !nameB) return []
  const src = data.sources.fixtures
  const winsA = games.filter((g) => g.mine > g.theirs).length
  const winsB = games.length - winsA
  const last = games[games.length - 1]
  const lastAWon = last.mine > last.theirs
  const lastFacts: HookFact[] = [
    { key: 'lastWeek', value: last.week, source: src },
    { key: 'lastSeason', value: last.season, source: src },
    { key: 'lastWinnerTeam', value: lastAWon ? nameA : nameB, source: src },
    { key: 'lastWinnerScore', value: round1(lastAWon ? last.mine : last.theirs), source: src },
    { key: 'lastLoserScore', value: round1(lastAWon ? last.theirs : last.mine), source: src },
  ]
  const out: StoryHook[] = []
  const record =
    winsA === winsB
      ? guardHook(
          base(data, 'rivalry_record', m, `${winsA}-${winsB}`, 40 + games.length * 4, [
            { key: 'teamA', value: nameA, source: src },
            { key: 'teamB', value: nameB, source: src },
            { key: 'wins', value: winsA, source: src },
            ...lastFacts,
          ]),
          'rivalry_even',
          lang,
        )
      : guardHook(
          base(data, 'rivalry_record', m, `${winsA}-${winsB}`, 35 + games.length * 4, [
            { key: 'leaderTeam', value: winsA > winsB ? nameA : nameB, source: src },
            { key: 'trailerTeam', value: winsA > winsB ? nameB : nameA, source: src },
            { key: 'leaderWins', value: Math.max(winsA, winsB), source: src },
            { key: 'trailerWins', value: Math.min(winsA, winsB), source: src },
            ...lastFacts,
          ]),
          'rivalry_lead',
          lang,
        )
  if (record) out.push(record)

  // A series streak of 3+ is its own hook.
  let streak = 0
  for (let i = games.length - 1; i >= 0; i -= 1) {
    if (games[i].mine > games[i].theirs === lastAWon) streak += 1
    else break
  }
  if (streak >= 3) {
    const h = guardHook(
      base(data, 'rivalry_record', m, `streak-${streak}`, 50 + streak * 5, [
        { key: 'streakTeam', value: lastAWon ? nameA : nameB, source: src },
        { key: 'otherTeam', value: lastAWon ? nameB : nameA, source: src },
        { key: 'streak', value: streak, source: src },
      ]),
      'rivalry_streak',
      lang,
    )
    if (h) out.push(h)
  }
  return out
}

/** Who eliminated whom, and title games, between these two. The most recent meeting only. */
export const playoffHistory: Builder = (data, m, lang) => {
  const games = data.playoffs
    .filter((g) => (g.winner === m.a && g.loser === m.b) || (g.winner === m.b && g.loser === m.a))
    .sort((x, y) => y.season - x.season || y.round - x.round)
  const g = games[0]
  if (!g) return []
  const winner = name(data, g.winner)
  const loser = name(data, g.loser)
  if (!winner || !loser) return []
  const src = data.sources.playoffs
  const h = guardHook(
    base(data, 'playoff_history', m, `${g.season}-${g.round}`, g.title ? 85 : 70, [
      { key: 'winnerTeam', value: winner, source: src },
      { key: 'loserTeam', value: loser, source: src },
      { key: 'season', value: g.season, source: src },
    ]),
    g.title ? 'playoff_title' : 'playoff_elimination',
    lang,
  )
  return h ? [h] : []
}

/**
 * A player now on one side who used to score for the other — last season, or earlier this season
 * (a trade or a drop). "Now" is the latest week this season he was on a roster.
 */
export const revengeGame: Builder = (data, m, lang) => {
  const out: StoryHook[] = []
  const src = data.sources.playerWeeks
  const thisSeason = data.playerWeeks.filter((w) => w.season === data.season)
  const latestWeek = new Map<string, { week: number; team: TeamKey }>()
  for (const w of thisSeason) {
    const cur = latestWeek.get(w.playerId)
    if (!cur || w.week > cur.week) latestWeek.set(w.playerId, { week: w.week, team: w.team })
  }
  for (const [playerId, now] of latestWeek) {
    const nowTeam = now.team
    if (nowTeam !== m.a && nowTeam !== m.b) continue
    const formerTeam = nowTeam === m.a ? m.b : m.a
    // His stints with the opponent: this season before now, else last season.
    const stints = data.playerWeeks.filter(
      (w) =>
        w.playerId === playerId &&
        w.team === formerTeam &&
        (w.season === data.season - 1 || (w.season === data.season && w.week < now.week)),
    )
    if (stints.length === 0) continue
    const formerSeason = Math.max(...stints.map((s) => s.season))
    const inSeason = stints.filter((s) => s.season === formerSeason)
    const points = round1(inSeason.reduce((n, s) => n + (s.starter ? s.points : 0), 0))
    const player = data.playerNames.get(playerId)
    const formerName = name(data, formerTeam)
    const nowName = name(data, nowTeam)
    if (!player || !formerName || !nowName || points <= 0) continue
    const h = guardHook(
      base(
        data,
        'revenge_game',
        m,
        `${playerId}-${formerSeason}`,
        60 + Math.min(30, points / 5),
        [
          { key: 'player', value: player, source: src },
          { key: 'weeks', value: inSeason.length, source: src },
          { key: 'formerTeam', value: formerName, source: src },
          { key: 'formerSeason', value: formerSeason, source: src },
          { key: 'points', value: points, source: src },
          { key: 'nowTeam', value: nowName, source: src },
        ],
        { players: [playerId] },
      ),
      inSeason.length === 1 ? 'revenge_one' : 'revenge',
      lang,
    )
    if (h) out.push(h)
  }
  // The strongest one per matchup is enough.
  return out.sort((x, y) => y.score - x.score).slice(0, 1)
}

/** Rounds past this share of the draft count as "late". */
const LATE_ROUND_SHARE = 0.5

/**
 * A late-round pick who has outscored nearly everyone drafted — this season, or last season when
 * this season's draft has no points yet. `team` restricts to one side of a matchup; null is the
 * league-wide version.
 */
export function draftSteals(data: StoryData, teams: readonly TeamKey[] | null, lang: HookLanguage, m: StoryHook['matchup']): StoryHook[] {
  const out: StoryHook[] = []
  const src = `${data.sources.draftPicks} + ${data.sources.playerWeeks}`
  for (const season of [data.season, data.season - 1]) {
    const picks = data.draftPicks.filter((p) => p.season === season)
    if (picks.length === 0) continue
    const rounds = Math.max(...picks.map((p) => p.round))
    if (rounds < 4) continue
    const totals = new Map<string, number>()
    for (const w of data.playerWeeks) {
      if (w.season !== season || !w.starter) continue
      totals.set(w.playerId, (totals.get(w.playerId) ?? 0) + w.points)
    }
    if (totals.size === 0) continue
    const ranked = picks
      .map((p) => ({ p, pts: round1(totals.get(p.playerId) ?? 0) }))
      .filter((x) => x.pts > 0)
      .sort((x, y) => y.pts - x.pts)
    const teamCount = new Set(picks.map((p) => p.team)).size
    ranked.forEach((x, i) => {
      const rank = i + 1
      if (x.p.round <= Math.ceil(rounds * LATE_ROUND_SHARE) || rank > Math.max(3, teamCount)) return
      if (teams && !teams.includes(x.p.team)) return
      const player = data.playerNames.get(x.p.playerId)
      const team = name(data, x.p.team)
      if (!player || !team) return
      const h = guardHook(
        base(
          data,
          'draft_steal',
          m,
          `${x.p.playerId}-${season}`,
          55 + (x.p.round - rank),
          [
            { key: 'team', value: team, source: src },
            { key: 'player', value: player, source: src },
            { key: 'round', value: x.p.round, source: src },
            { key: 'season', value: season, source: src },
            { key: 'points', value: x.pts, source: src },
            { key: 'rank', value: rank, source: src },
          ],
          { teams: [x.p.team], players: [x.p.playerId] },
        ),
        'draft_steal_round',
        lang,
      )
      if (h) out.push(h)
    })
    if (out.length > 0) break
  }
  return out.sort((x, y) => y.score - x.score).slice(0, teams ? 1 : 3)
}

/**
 * One player outscoring an opponent's ENTIRE starting lineup in a week — this season or last. Only
 * these two teams: the player is on one side, the lineup he beat is the other's.
 */
export const oneManArmy: Builder = (data, m, lang) => {
  const src = data.sources.playerWeeks
  const lineup = new Map<string, number>()
  for (const w of data.playerWeeks) {
    if (!w.starter) continue
    const k = `${w.season}:${w.week}:${w.team}`
    lineup.set(k, (lineup.get(k) ?? 0) + w.points)
  }
  let best: { w: (typeof data.playerWeeks)[number]; victim: TeamKey; victimPoints: number } | null = null
  for (const w of data.playerWeeks) {
    if (!w.starter || w.points <= 0) continue
    if (w.season !== data.season && w.season !== data.season - 1) continue
    if (w.team !== m.a && w.team !== m.b) continue
    const victim = w.team === m.a ? m.b : m.a
    const victimPoints = lineup.get(`${w.season}:${w.week}:${victim}`)
    // A week the victim did not play (or has no starter rows) is not a lineup he beat.
    if (victimPoints == null || victimPoints <= 0 || w.points <= victimPoints) continue
    if (!best || w.points - victimPoints > best.w.points - best.victimPoints) best = { w, victim, victimPoints }
  }
  if (!best) return []
  const player = data.playerNames.get(best.w.playerId)
  const team = name(data, best.w.team)
  const victimTeam = name(data, best.victim)
  if (!player || !team || !victimTeam) return []
  const h = guardHook(
    base(
      data,
      'one_man_army',
      m,
      `${best.w.playerId}-${best.w.season}-${best.w.week}`,
      75,
      [
        { key: 'week', value: best.w.week, source: src },
        { key: 'season', value: best.w.season, source: src },
        { key: 'player', value: player, source: src },
        { key: 'points', value: round1(best.w.points), source: src },
        { key: 'team', value: team, source: src },
        { key: 'victimTeam', value: victimTeam, source: src },
        { key: 'victimPoints', value: round1(best.victimPoints), source: src },
      ],
      { players: [best.w.playerId] },
    ),
    'one_man_army',
    lang,
  )
  return h ? [h] : []
}

/** Win or loss streaks of 3+ this season. */
export const streaks: Builder = (data, m, lang) => {
  const sA = currentStreak(data.fixtures, m.a, data.season)
  const sB = currentStreak(data.fixtures, m.b, data.season)
  const nameA = name(data, m.a)
  const nameB = name(data, m.b)
  if (!nameA || !nameB) return []
  const src = data.sources.fixtures
  if ((sA >= 3 && sB <= -3) || (sB >= 3 && sA <= -3)) {
    const hotIsA = sA > 0
    const h = guardHook(
      base(data, 'streak', m, `${sA}:${sB}`, 65 + Math.abs(sA) + Math.abs(sB), [
        { key: 'hotTeam', value: hotIsA ? nameA : nameB, source: src },
        { key: 'hotStreak', value: Math.abs(hotIsA ? sA : sB), source: src },
        { key: 'coldTeam', value: hotIsA ? nameB : nameA, source: src },
        { key: 'coldStreak', value: Math.abs(hotIsA ? sB : sA), source: src },
      ]),
      'streak_hot_cold',
      lang,
    )
    return h ? [h] : []
  }
  const pick = Math.abs(sA) >= Math.abs(sB) ? { s: sA, team: nameA, other: nameB } : { s: sB, team: nameB, other: nameA }
  if (Math.abs(pick.s) < 3) return []
  const words = STREAK_WORDS[lang]
  const h = guardHook(
    base(data, 'streak', m, `${sA}:${sB}`, 45 + Math.abs(pick.s) * 2, [
      { key: 'team', value: pick.team, source: src },
      { key: 'otherTeam', value: pick.other, source: src },
      { key: 'streak', value: Math.abs(pick.s), source: src },
      { key: 'result', value: pick.s > 0 ? words.won : words.lost, source: 'template' },
    ]),
    'streak_single',
    lang,
  )
  return h ? [h] : []
}

/** The league's points-for leader against the team with the fewest. */
export const leaderVsCellar: Builder = (data, m, lang) => {
  if (data.standings.length < 4) return []
  const sorted = [...data.standings].filter((s) => s.wins + s.losses + s.ties > 0).sort((x, y) => y.pointsFor - x.pointsFor)
  if (sorted.length < 4) return []
  const leader = sorted[0]
  const cellar = sorted[sorted.length - 1]
  const pair = new Set([m.a, m.b])
  if (!pair.has(leader.team) || !pair.has(cellar.team) || leader.team === cellar.team) return []
  const leaderName = name(data, leader.team)
  const cellarName = name(data, cellar.team)
  if (!leaderName || !cellarName) return []
  const src = data.sources.standings
  const h = guardHook(
    base(data, 'points_leader_vs_cellar', m, `${leader.team}-${cellar.team}`, 70, [
      { key: 'leaderTeam', value: leaderName, source: src },
      { key: 'leaderPoints', value: round1(leader.pointsFor), source: src },
      { key: 'cellarTeam', value: cellarName, source: src },
      { key: 'cellarPoints', value: round1(cellar.pointsFor), source: src },
    ]),
    'leader_vs_cellar',
    lang,
  )
  return h ? [h] : []
}

/** Last season's title game, replayed. Needs the score from the fixture of that game. */
export const titleRematch: Builder = (data, m, lang) => {
  const title = data.playoffs.find(
    (g) =>
      g.title &&
      g.season === data.season - 1 &&
      ((g.winner === m.a && g.loser === m.b) || (g.winner === m.b && g.loser === m.a)),
  )
  if (!title) return []
  const winner = name(data, title.winner)
  const loser = name(data, title.loser)
  if (!winner || !loser) return []
  // The title game's score is the pair's LAST meeting of that season.
  const lastOfSeason = headToHead(data.fixtures, title.winner, title.loser)
    .filter((g) => g.season === title.season)
    .pop()
  const src = `${data.sources.playoffs} + ${data.sources.fixtures}`
  const h = guardHook(
    base(data, 'title_rematch', m, `${title.season}`, 95, [
      { key: 'season', value: title.season, source: src },
      { key: 'winnerTeam', value: winner, source: src },
      { key: 'loserTeam', value: loser, source: src },
      // Missing when the final's fixture was never stored — and then the hook is dropped.
      ...(lastOfSeason && lastOfSeason.mine > lastOfSeason.theirs
        ? [
            { key: 'winnerScore', value: round1(lastOfSeason.mine), source: src },
            { key: 'loserScore', value: round1(lastOfSeason.theirs), source: src },
          ]
        : []),
    ]),
    'title_rematch',
    lang,
  )
  return h ? [h] : []
}

/** The biggest margin of victory in this pairing's history. Needs two meetings to be "the biggest". */
export const biggestBlowout: Builder = (data, m, lang) => {
  const games = headToHead(data.fixtures, m.a, m.b).filter((g) => g.mine !== g.theirs)
  if (games.length < 2) return []
  const top = games.reduce((best, g) => (Math.abs(g.mine - g.theirs) > Math.abs(best.mine - best.theirs) ? g : best))
  const aWon = top.mine > top.theirs
  const winner = name(data, aWon ? m.a : m.b)
  const loser = name(data, aWon ? m.b : m.a)
  if (!winner || !loser) return []
  const margin = round1(Math.abs(top.mine - top.theirs))
  if (margin < 20) return []
  const src = data.sources.fixtures
  const h = guardHook(
    base(data, 'biggest_blowout', m, `${top.season}-${top.week}`, 40 + Math.min(30, margin / 2), [
      { key: 'winnerTeam', value: winner, source: src },
      { key: 'loserTeam', value: loser, source: src },
      { key: 'margin', value: margin, source: src },
      { key: 'week', value: top.week, source: src },
      { key: 'season', value: top.season, source: src },
      { key: 'winnerScore', value: round1(aWon ? top.mine : top.theirs), source: src },
      { key: 'loserScore', value: round1(aWon ? top.theirs : top.mine), source: src },
    ]),
    'blowout',
    lang,
  )
  return h ? [h] : []
}

const MATCHUP_BUILDERS: Builder[] = [
  titleRematch,
  playoffHistory,
  rivalryRecord,
  revengeGame,
  oneManArmy,
  streaks,
  leaderVsCellar,
  biggestBlowout,
  (data, m, lang) => draftSteals(data, [m.a, m.b], lang, m),
]

export type WeeklyHooks = {
  season: number
  week: number | null
  /** Hooks per matchup, each list ranked best first. */
  byMatchup: Array<{ matchup: { a: TeamKey; b: TeamKey; matchupId?: string }; hooks: StoryHook[] }>
  /** League-wide hooks for a league with no head-to-head games this week (guillotine, best ball). */
  league: StoryHook[]
}

/**
 * Every hook for this week, ranked. A builder that throws loses its own hooks, never the week.
 */
export function buildWeeklyHooks(data: StoryData, lang: HookLanguage = 'en'): WeeklyHooks {
  const byMatchup = data.matchups.map((m) => {
    const hooks: StoryHook[] = []
    for (const build of MATCHUP_BUILDERS) {
      try {
        hooks.push(...build(data, m, lang))
      } catch {
        // One bad builder must not cost the matchup its other hooks.
      }
    }
    const seen = new Set<string>()
    return {
      matchup: m,
      hooks: hooks.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true))).sort((x, y) => y.score - x.score),
    }
  })
  let league: StoryHook[] = []
  if (data.matchups.length === 0) {
    try {
      league = draftSteals(data, null, lang, null)
    } catch {
      league = []
    }
  }
  return { season: data.season, week: data.week, byMatchup, league }
}

/** The single best hook of the week — what auto-post sends. */
export function topHook(hooks: WeeklyHooks): StoryHook | null {
  const all = [...hooks.byMatchup.flatMap((m) => m.hooks), ...hooks.league]
  return all.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))[0] ?? null
}
