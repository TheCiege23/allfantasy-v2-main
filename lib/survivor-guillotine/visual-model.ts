/**
 * Survivor Guillotine visual model (handoff: design-refs/native-league-handoff/survivor-guillotine/).
 *
 * Pure presentation over the member-safe season payload from
 * `GET /api/leagues/[leagueId]/survivor-guillotine`. It never decides gameplay: who is immune and who
 * is chopped come from the engine (`lib/survivor-guillotine/competition.ts`, `live.ts`). Everything
 * live here is labelled a projection, and it follows the ENGINE's rules where they differ from the
 * handoff's proposed ones:
 *
 *  - Tribe race: Match Play counts head-to-head matchup wins, Tribe Champion compares the nominated
 *    champions' scores. Total tribe points are shown only as context, never as the deciding metric.
 *  - Chop: the lowest scorer across every tribe WITHOUT immunity (with 2 tribes, the losing tribe).
 *  - Ties: weekly points, then previous period, then the commissioner. No season-points/bench ladder.
 *  - Idols: an immunity idol passes the blade to the next eligible scorer, and can chain.
 *
 * 🛑 SECRECY: inputs are only what the API already returns to this viewer — their own powers, and the
 * period history as projected by `projectSGHostedHistory`. This module never infers an idol holder
 * from anything else, and `shareCardsFor` never names an idol holder.
 */

import { DEFAULT_DANGER_MARGIN_POINTS } from '@/lib/guillotine/constants'
import { buildSGSchedule, SG_MODE_LABELS } from '@/lib/survivor-guillotine/config'
import { SG_POWER_LABELS } from '@/lib/survivor-guillotine/powers'
import type { SGConfig, SGMode, SGPower, SGPowerKind } from '@/lib/survivor-guillotine/types'
import type { SGLivePeriod, SGTribeMember } from '@/lib/survivor-guillotine/live'

export const SG_ART = '/specialty/survguil'

export type SGVisualTeam = { legacyRosterId: string | null; teamName: string; ownerName: string; eliminatedAt: string | null }
export type SGVisualHistoryRow = {
  mode: string
  completedAt?: string
  choppedTeamIds: string[]
  savedTeamIds: string[]
  protectedTeamIds?: string[]
  scores: Record<string, number>
  immuneTribeId: string | null
  placements?: string[]
  hostedCeremony?: { stage: number; updatedAt: string } | null
}
export type SGVisualInput = {
  season: {
    config: SGConfig
    tribes: SGTribeMember[]
    periodState: SGLivePeriod | null
    currentPeriod: number
    status: string
    periodHistory: Record<string, SGVisualHistoryRow>
  }
  ownRosterId: string | null
  teams: SGVisualTeam[]
  scores: { rosterId: string; totalPoints: number; status: string }[]
  powers: SGPower[]
}

/* ───────────────────────────── Tribe identity (art only) ───────────────────────────── */

/**
 * The engine stores tribe ids only (`tribe-0`, `gauntlet-1`). Names and colours are presentation:
 * the handoff's "Island words" pack, in order, composed from blank buffs + symbols so any tribe count
 * renders without new art. Renaming tribes is NOT an engine feature (see "Rules needing a decision").
 */
const ISLAND_WORDS = ['Vela', 'Koa', 'Nalu', 'Lani', 'Kai', 'Ori', 'Tama', 'Ula'] as const
const BUFF_COLORS = ['purple', 'teal', 'orange', 'red', 'gold', 'green', 'blue', 'pink'] as const
const SYMBOLS = ['star', 'wave', 'flame', 'leaf', 'sun', 'moon', 'bolt', 'mountain'] as const
const HEX: Record<(typeof BUFF_COLORS)[number], string> = {
  purple: '#7b6cf0', teal: '#3bb3b8', orange: '#e2672a', red: '#e0402e',
  gold: '#e8b84a', green: '#3aa86a', blue: '#3b82f6', pink: '#e45a9a',
}

export type SGTribeArt = { tribeId: string; name: string; buffSrc: string; symbolSrc: string; color: string }

export function tribeIndex(tribeId: string): number {
  const m = /(\d+)$/.exec(tribeId)
  if (!m) return 0
  const n = Number(m[1])
  return tribeId.startsWith('gauntlet-') ? Math.max(0, n - 1) : n
}

export function sgTribeArt(tribeId: string): SGTribeArt {
  if (tribeId === 'merged') {
    return { tribeId, name: 'Ember', buffSrc: `${SG_ART}/buff-ember.svg`, symbolSrc: `${SG_ART}/tribes/sym-flame.svg`, color: HEX.orange }
  }
  const i = tribeIndex(tribeId) % ISLAND_WORDS.length
  const color = BUFF_COLORS[i]
  return {
    tribeId,
    name: ISLAND_WORDS[i],
    buffSrc: `${SG_ART}/tribes/buff-${color}.svg`,
    symbolSrc: `${SG_ART}/tribes/sym-${SYMBOLS[i]}.svg`,
    color: HEX[color],
  }
}

/* ───────────────────────────── Phase ───────────────────────────── */

export type SGPhase = 'setup' | 'tribal' | 'gauntlet' | 'merged' | 'finale' | 'off' | 'completed'

export function sgPhase(config: SGConfig, currentPeriod: number, status: string): { phase: SGPhase; mode: SGMode | null; label: string } {
  if (status === 'completed') return { phase: 'completed', mode: null, label: 'Season complete' }
  if (!currentPeriod) return { phase: 'setup', mode: null, label: 'Season setup' }
  const row = buildSGSchedule(config).periods.find((p) => p.period === currentPeriod)
  if (!row) return { phase: 'setup', mode: null, label: 'Season setup' }
  const phase: SGPhase = row.mode === 'match_play' || row.mode === 'tribe_champion' ? 'tribal'
    : row.mode === 'gauntlet' ? 'gauntlet' : row.mode === 'merged' ? 'merged'
      : row.mode === 'final_three' ? 'finale' : 'off'
  return { phase, mode: row.mode, label: SG_MODE_LABELS[row.mode] }
}

/** First merged period in the schedule (null when the schedule has none). */
export function sgMergePeriod(config: SGConfig): number | null {
  return buildSGSchedule(config).periods.find((p) => p.mode === 'merged')?.period ?? null
}

/* ───────────────────────────── Tribe race ───────────────────────────── */

export type SGRaceMember = { rosterId: string; name: string; points: number | null; captain: boolean; sittingOut: boolean; you: boolean }
export type SGRaceTribe = SGTribeArt & {
  members: SGRaceMember[]
  totalPoints: number
  /** The engine's deciding metric for this mode: matchup wins (Match Play) or champion score. */
  metric: number | null
  metricLabel: string
  standing: 'leading' | 'trailing' | 'tied' | 'pending'
}
export type SGRace = { mode: SGMode | null; tribes: SGRaceTribe[]; summary: string; projectedImmuneTribeId: string | null }

export function buildTribeRace(input: SGVisualInput): SGRace {
  const { season } = input
  const { mode, phase } = sgPhase(season.config, season.currentPeriod, season.status)
  const names = teamNames(input.teams)
  const alive = aliveIds(input.teams)
  const pts = scoreMap(input.scores)
  const state = season.periodState
  const tribeIds = [...new Set(season.tribes.map((m) => m.tribeId))]
  const tribes: SGRaceTribe[] = tribeIds.map((tribeId) => {
    const members = season.tribes
      .filter((m) => m.tribeId === tribeId && alive.has(m.rosterId))
      .map((m) => ({
        rosterId: m.rosterId,
        name: names.get(m.rosterId) ?? 'Manager',
        points: pts.has(m.rosterId) ? pts.get(m.rosterId)! : null,
        captain: Boolean(m.captain),
        sittingOut: Boolean(state?.sitOuts.includes(m.rosterId)),
        you: m.rosterId === input.ownRosterId,
      }))
      .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity))
    const totalPoints = round1(members.reduce((s, m) => s + (m.points ?? 0), 0))
    let metric: number | null = null
    let metricLabel = 'Tribe points'
    if (mode === 'match_play') {
      metricLabel = 'Matchup wins'
      metric = 0
      for (const mu of state?.matchups ?? []) {
        const a = pts.get(mu.team1), b = pts.get(mu.team2)
        if (a == null || b == null || a === b) continue
        const winner = a > b ? mu.team1 : mu.team2
        if (season.tribes.find((m) => m.rosterId === winner)?.tribeId === tribeId) metric++
      }
    } else if (mode === 'tribe_champion') {
      metricLabel = 'Champion score'
      const champ = (state?.champions ?? []).find((id) => season.tribes.find((m) => m.rosterId === id)?.tribeId === tribeId)
      metric = champ && pts.has(champ) ? pts.get(champ)! : null
    }
    return { ...sgTribeArt(tribeId), members, totalPoints, metric, metricLabel, standing: 'pending' }
  })

  let projectedImmuneTribeId: string | null = null
  if (phase === 'tribal' && tribes.length >= 2 && tribes.every((t) => t.metric != null)) {
    const best = Math.max(...tribes.map((t) => t.metric!))
    const top = tribes.filter((t) => t.metric === best)
    for (const t of tribes) t.standing = top.length > 1 && t.metric === best ? 'tied' : t.metric === best ? 'leading' : 'trailing'
    if (top.length === 1) projectedImmuneTribeId = top[0].tribeId
  }

  const summary = phase === 'tribal'
    ? mode === 'match_play'
      ? projectedImmuneTribeId
        ? `${sgTribeArt(projectedImmuneTribeId).name} leads on matchup wins. If it ends like this, the lowest score outside ${sgTribeArt(projectedImmuneTribeId).name} is chopped.`
        : 'Most matchup wins earns tribe immunity. A tie goes against the tribe holding the lowest weekly score.'
      : projectedImmuneTribeId
        ? `${sgTribeArt(projectedImmuneTribeId).name}'s champion is ahead. If it ends like this, the lowest score outside ${sgTribeArt(projectedImmuneTribeId).name} is chopped.`
        : 'The highest-scoring tribe champion earns immunity for the whole tribe.'
    : phase === 'gauntlet'
      ? 'Gauntlet: two tribes, two chops. No tribe immunity unless the league turned it on.'
      : phase === 'merged'
        ? 'The tribes have merged. The lowest weekly score in the whole field is chopped.'
        : phase === 'finale'
          ? 'Final three. This period\'s score sets first, second and third.'
          : 'Tribes race once the season starts.'
  return { mode, tribes, summary, projectedImmuneTribeId }
}

/* ───────────────────────────── Chop line (danger tiers) ───────────────────────────── */

export type SGTier = 'chop_zone' | 'danger' | 'safe'
export type SGChopRow = { rosterId: string; name: string; points: number; tier: SGTier; marginAboveBlade: number; you: boolean; tribeId: string | null }

/**
 * Who is under the blade right now, using the ENGINE's eligible field: every alive manager outside
 * the projected immune tribe (tribal phase) or the whole field (merged). Gauntlet: one per tribe when
 * `per_tribe`. Tiers are display bands only — chop zone = the lowest (or lowest N), danger = within
 * the guillotine's default 10-point margin. They decide nothing.
 */
export function buildChopLine(input: SGVisualInput, race: SGRace = buildTribeRace(input)): { groups: { label: string; rows: SGChopRow[] }[]; note: string } {
  const { season } = input
  const { phase } = sgPhase(season.config, season.currentPeriod, season.status)
  const names = teamNames(input.teams)
  const alive = aliveIds(input.teams)
  const pts = scoreMap(input.scores)
  const tribeOf = new Map(season.tribes.map((m) => [m.rosterId, m.tribeId]))
  if (phase === 'setup' || phase === 'off' || phase === 'finale' || phase === 'completed' || pts.size === 0) {
    return { groups: [], note: phase === 'finale' ? 'No chop in the finale. Placement is by this period\'s score.' : 'Live chop line appears once this period has scores.' }
  }
  const eligible = [...alive].filter((id) => pts.has(id) && (phase !== 'tribal' || !race.projectedImmuneTribeId || tribeOf.get(id) !== race.projectedImmuneTribeId))
  const perTribe = phase === 'gauntlet' && season.config.gauntletElimination === 'per_tribe' && !season.config.gauntletTribeImmunity
  const chopsPerGroup = phase === 'gauntlet' && !perTribe ? 2 : 1
  const buckets: { label: string; ids: string[] }[] = perTribe
    ? [...new Set(eligible.map((id) => tribeOf.get(id) ?? ''))].map((t) => ({ label: `Inside ${sgTribeArt(t).name}`, ids: eligible.filter((id) => tribeOf.get(id) === t) }))
    : [{ label: phase === 'merged' ? 'Whole field' : race.projectedImmuneTribeId ? `Outside ${sgTribeArt(race.projectedImmuneTribeId).name}` : 'Every tribe', ids: eligible }]
  const groups = buckets.map(({ label, ids }) => {
    const sorted = ids.map((id) => ({ id, p: pts.get(id)! })).sort((a, b) => a.p - b.p)
    const bladeAt = sorted[Math.min(chopsPerGroup, sorted.length) - 1]?.p ?? 0
    const rows: SGChopRow[] = sorted.map(({ id, p }, i) => ({
      rosterId: id,
      name: names.get(id) ?? 'Manager',
      points: p,
      tier: i < chopsPerGroup ? 'chop_zone' : p - bladeAt <= DEFAULT_DANGER_MARGIN_POINTS ? 'danger' : 'safe',
      marginAboveBlade: round1(p - bladeAt),
      you: id === input.ownRosterId,
      tribeId: tribeOf.get(id) ?? null,
    }))
    return { label, rows: rows.reverse() }
  })
  return {
    groups,
    note: 'Live projection. A played immunity idol passes the blade to the next lowest, and can chain. Ties: weekly points, then the previous period, then the commissioner.',
  }
}

/* ───────────────────────────── Idol vault ───────────────────────────── */

/** Art for the engine's five power kinds. Labels stay the engine's (`SG_POWER_LABELS`). */
export const SG_POWER_ART: Record<SGPowerKind, { src: string; blurb: string }> = {
  personal_immunity: { src: `${SG_ART}/idol-block.svg`, blurb: 'Play it before the deadline. If the blade reaches you, it passes to the next lowest.' },
  ally_immunity: { src: `${SG_ART}/idol-tribe.svg`, blurb: 'Protect another manager. The blade passes over them to the next lowest.' },
  steal_player: { src: `${SG_ART}/idol-curse.svg`, blurb: 'Take one unlocked player from an opponent. Revealed when it runs.' },
  tribe_swap: { src: `${SG_ART}/idol-sniffer.svg`, blurb: 'Move a manager to another tribe. Revealed when it runs.' },
  faab_bonus: { src: `${SG_ART}/idol-boost.svg`, blurb: 'A private FAAB cache for the waiver run. Revealed when it runs.' },
}

export type SGVaultIdol = { id: string; kind: SGPowerKind; label: string; src: string; blurb: string; status: SGPower['status']; mine: boolean; throughPeriod: number }

/** Own powers plus powers the engine has already revealed. Nothing else exists to this viewer. */
export function buildIdolVault(input: SGVisualInput): { mine: SGVaultIdol[]; revealed: SGVaultIdol[] } {
  const own = input.ownRosterId
  const toIdol = (p: SGPower, mine: boolean): SGVaultIdol => ({
    id: p.id, kind: p.kind, label: SG_POWER_LABELS[p.kind], src: SG_POWER_ART[p.kind].src,
    blurb: SG_POWER_ART[p.kind].blurb, status: p.status, mine, throughPeriod: p.expiresAfterPeriod,
  })
  const mine = input.powers.filter((p) => own && p.ownerId === own).map((p) => toIdol(p, true))
  const revealed = input.powers.filter((p) => !(own && p.ownerId === own) && p.status === 'used' && p.revealed).map((p) => toIdol(p, false))
  return { mine, revealed }
}

/* ───────────────────────────── Chop night ───────────────────────────── */

export type SGCeremonyStep = { key: 'race' | 'idols' | 'chop' | 'torch' | 'release'; title: string; detail: string; art: string }

/** The five-beat ceremony for a completed (or host-revealed) period, from the engine's own record. */
export function buildCeremony(period: string, row: SGVisualHistoryRow, teams: SGVisualTeam[]): SGCeremonyStep[] {
  const names = teamNames(teams)
  const n = (ids: string[]) => ids.map((id) => names.get(id) ?? 'A manager').join(', ')
  const played = row.protectedTeamIds ?? []
  const steps: SGCeremonyStep[] = [
    { key: 'race', title: 'Race final', art: `${SG_ART}/guillotine.svg`,
      detail: row.immuneTribeId ? `${sgTribeArt(row.immuneTribeId).name} won immunity in period ${period}.` : `Period ${period}: no tribe immunity.` },
    { key: 'idols', title: 'Idols revealed', art: `${SG_ART}/idol-block.svg`,
      detail: played.length ? `Immunity played for ${n(played)}.${row.savedTeamIds.length ? ` The blade passed over ${n(row.savedTeamIds)}.` : ' The blade never reached them.'}` : 'No immunity idol was played.' },
  ]
  if (row.choppedTeamIds.length) {
    const score = row.choppedTeamIds.map((id) => row.scores[id]).filter((s) => typeof s === 'number')
    steps.push(
      { key: 'chop', title: 'Chop', art: `${SG_ART}/guillotine-drop.svg`,
        detail: `${n(row.choppedTeamIds)}${score.length ? `, ${score.map((s) => s.toFixed(1)).join(' / ')}` : ''}.` },
      { key: 'torch', title: 'Torch snuffed', art: `${SG_ART}/torch-out.svg`, detail: 'Out of the game. Chat and spectating stay open.' },
      { key: 'release', title: 'Roster released', art: `${SG_ART}/icon-chop.svg`, detail: 'Their players enter league-wide FAAB waivers.' },
    )
  } else if (row.placements?.length) {
    steps.push({ key: 'chop', title: 'Final placements', art: `${SG_ART}/winner.svg`, detail: `${n(row.placements.slice(0, 1))} is the last one standing.` })
  }
  return steps
}

/* ───────────────────────────── Season timeline, torches, share ───────────────────────────── */

export type SGTimelineEntry = { period: number; mode: string; chopped: string[]; saved: string[]; immuneTribe: string | null }

export function buildTimeline(input: SGVisualInput): SGTimelineEntry[] {
  const names = teamNames(input.teams)
  return Object.entries(input.season.periodHistory)
    .filter(([, r]) => !r.hostedCeremony || r.hostedCeremony.stage >= 3)
    .map(([p, r]) => ({
      period: Number(p), mode: SG_MODE_LABELS[r.mode as SGMode] ?? r.mode,
      chopped: r.choppedTeamIds.map((id) => names.get(id) ?? 'A manager'),
      saved: r.savedTeamIds.map((id) => names.get(id) ?? 'A manager'),
      immuneTribe: r.immuneTribeId ? sgTribeArt(r.immuneTribeId).name : null,
    }))
    .sort((a, b) => a.period - b.period)
}

export type SGTorch = { rosterId: string; name: string; lit: boolean; you: boolean; tribeId: string | null }
export function buildTorches(input: SGVisualInput): SGTorch[] {
  const tribeOf = new Map(input.season.tribes.map((m) => [m.rosterId, m.tribeId]))
  return input.teams.filter((t) => t.legacyRosterId).map((t) => ({
    rosterId: t.legacyRosterId!, name: t.teamName || t.ownerName, lit: !t.eliminatedAt,
    you: t.legacyRosterId === input.ownRosterId, tribeId: tribeOf.get(t.legacyRosterId!) ?? null,
  }))
}

export type SGShareCard = { key: 'missed' | 'out' | 'merge' | 'winner'; title: string; line: string; art: string }

/**
 * Story cards for THIS viewer, earned from engine history. Copy never names an idol holder, and
 * "the blade missed me" never says why (an idol would otherwise be inferable).
 */
export function shareCardsFor(input: SGVisualInput): SGShareCard[] {
  const own = input.ownRosterId
  if (!own) return []
  const rows = Object.entries(input.season.periodHistory).filter(([, r]) => !r.hostedCeremony || r.hostedCeremony.stage >= 3)
  const cards: SGShareCard[] = []
  const choppedIn = rows.find(([, r]) => r.choppedTeamIds.includes(own))
  if (choppedIn) cards.push({ key: 'out', title: 'My torch is out', line: `Chopped in period ${choppedIn[0]}.`, art: `${SG_ART}/torch-out.svg` })
  const survived = rows.filter(([, r]) => r.choppedTeamIds.length && !r.choppedTeamIds.includes(own) && r.scores[own] != null).length
  if (!choppedIn && survived > 0) cards.push({ key: 'missed', title: 'The blade missed me', line: `${survived} chop${survived === 1 ? '' : 's'} survived.`, art: `${SG_ART}/torch-lit.svg` })
  const merge = sgMergePeriod(input.season.config)
  const me = input.teams.find((t) => t.legacyRosterId === own)
  if (merge && input.season.currentPeriod >= merge && me && !me.eliminatedAt) cards.push({ key: 'merge', title: 'Made the merge', line: 'Still burning at the merge.', art: `${SG_ART}/merge.svg` })
  const finale = rows.find(([, r]) => r.placements?.[0] === own)
  if (finale) cards.push({ key: 'winner', title: 'Last one standing', line: 'Sole survivor of the island.', art: `${SG_ART}/winner.svg` })
  return cards
}

/* ───────────────────────────── Notifications (display of defaults) ───────────────────────────── */

/**
 * The handoff's default channel table. DISPLAY ONLY: no notification is wired from here. Moments that
 * do not exist in this engine (tribe-race trailing pushes, sniffer, necklace…) are left out rather
 * than advertised.
 */
export const SG_NOTIFICATION_DEFAULTS: { moment: string; push: boolean; inApp: boolean; email: boolean; tribeChat: boolean }[] = [
  { moment: 'Immunity deadline reminder', push: true, inApp: true, email: false, tribeChat: false },
  { moment: 'Idol played (your confirmation)', push: true, inApp: true, email: false, tribeChat: false },
  { moment: 'Your idol saved you', push: true, inApp: true, email: true, tribeChat: false },
  { moment: 'You were chopped', push: true, inApp: true, email: true, tribeChat: false },
  { moment: 'Someone was chopped', push: false, inApp: true, email: false, tribeChat: true },
  { moment: 'Roster released', push: true, inApp: true, email: false, tribeChat: false },
  { moment: 'The merge', push: true, inApp: true, email: true, tribeChat: true },
  { moment: 'You were given a power', push: true, inApp: true, email: true, tribeChat: false },
  { moment: 'Winner', push: true, inApp: true, email: true, tribeChat: true },
]

/* ───────────────────────────── helpers ───────────────────────────── */

function teamNames(teams: SGVisualTeam[]): Map<string, string> {
  return new Map(teams.filter((t) => t.legacyRosterId).map((t) => [t.legacyRosterId!, t.teamName || t.ownerName]))
}
function aliveIds(teams: SGVisualTeam[]): Set<string> {
  return new Set(teams.filter((t) => t.legacyRosterId && !t.eliminatedAt).map((t) => t.legacyRosterId!))
}
function scoreMap(scores: SGVisualInput['scores']): Map<string, number> {
  return new Map(scores.filter((s) => Number.isFinite(s.totalPoints)).map((s) => [s.rosterId, s.totalPoints]))
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
