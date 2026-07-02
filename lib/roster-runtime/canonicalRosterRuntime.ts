import type {
  CanonicalLeagueRules,
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'

export type RosterRuntimeSection = 'starters' | 'bench' | 'ir'
export type RosterRuntimeActorRole = 'manager' | 'commissioner' | 'system'

export type RosterRuntimePlayer = {
  playerId: string
  playerName: string
  position: string
  team?: string | null
  status?: string | null
  byeWeek?: number | null
  gameStartIso?: string | null
  locked?: boolean | null
  acquisitionType?: string | null
}

export type RosterRuntimeSections = {
  starters: RosterRuntimePlayer[]
  bench: RosterRuntimePlayer[]
  ir: RosterRuntimePlayer[]
}

export type CanonicalRosterSlot = {
  slotId: string
  label: string
  section: 'starter' | 'bench' | 'ir'
  index: number
  allowedPositions: string[]
  required: boolean
  flexible: boolean
}

export type CanonicalRosterSlotAssignment = {
  slot: CanonicalRosterSlot
  player: RosterRuntimePlayer | null
  locked: boolean
  lockReason: string | null
}

export type RosterRuntimeValidationIssue = {
  code:
    | 'ACTIVE_ROSTER_OVER_LIMIT'
    | 'BENCH_OVER_LIMIT'
    | 'DUPLICATE_PLAYER'
    | 'EMPTY_REQUIRED_STARTER'
    | 'INACTIVE_STARTER'
    | 'INVALID_POSITION'
    | 'IR_INELIGIBLE'
    | 'IR_OVER_LIMIT'
    | 'LOCKED_PLAYER_MOVED'
    | 'ROSTER_RULE_MISMATCH'
    | 'STARTER_ON_BYE'
    | 'STARTER_POSITION_INELIGIBLE'
    | 'STARTER_OVER_LIMIT'
  severity: 'blocking' | 'warning'
  message: string
  section?: RosterRuntimeSection
  playerId?: string
  slotId?: string
}

export type CanonicalRosterRuntimeTeamInput = {
  rosterId: string
  displayName?: string | null
  platformUserId?: string | null
  playerData?: unknown
  sections?: Partial<RosterRuntimeSections>
  lockOverridePlayerIds?: string[]
}

export type CanonicalRosterRuntimeTeamState = {
  rosterId: string
  displayName: string | null
  platformUserId: string | null
  sections: RosterRuntimeSections
  starterAssignments: CanonicalRosterSlotAssignment[]
  benchAssignments: CanonicalRosterSlotAssignment[]
  irAssignments: CanonicalRosterSlotAssignment[]
  activeRosterSize: number
  totalRosterSize: number
  capacity: {
    starters: number
    bench: number
    active: number
    ir: number
    totalWithIr: number
  }
  lockedPlayerIds: string[]
  validation: {
    ok: boolean
    issues: RosterRuntimeValidationIssue[]
  }
}

export type CanonicalRosterRuntimeState = {
  leagueId: string
  rulesVersion: CanonicalLeagueRules['version']
  generatedAtIso: string
  season: number | null
  scoringWeek: number | null
  starterSlots: CanonicalRosterSlot[]
  teams: CanonicalRosterRuntimeTeamState[]
  runtimeInvariants: RosterRuntimeValidationIssue[]
}

export type RosterMoveInput = {
  rules: CanonicalLeagueRules
  team: CanonicalRosterRuntimeTeamState
  playerId: string
  toSection: RosterRuntimeSection
  toIndex?: number
  actorRole: RosterRuntimeActorRole
  commissionerOverride?: boolean
  now?: Date
  scoringWeek?: number | null
}

export type RosterMoveResult =
  | {
      ok: true
      sections: RosterRuntimeSections
      nextTeam: CanonicalRosterRuntimeTeamState
      events: CanonicalLeagueRuntimeEvent[]
    }
  | {
      ok: false
      code:
        | 'PLAYER_NOT_FOUND'
        | 'PLAYER_LOCKED'
        | 'IR_FULL'
        | 'IR_INELIGIBLE'
        | 'STARTER_FULL'
        | 'LINEUP_INVALID'
      message: string
      issues?: RosterRuntimeValidationIssue[]
    }

const DEFAULT_NFL_STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const BASE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
const FLEX_POSITIONS = ['RB', 'WR', 'TE']
const SUPER_FLEX_POSITIONS = ['QB', 'RB', 'WR', 'TE']
const IR_STATUSES = new Set(['IR', 'PUP', 'OUT_IR', 'RESERVE'])
const STARTER_BLOCKING_STATUSES = new Set(['INACTIVE', 'OUT', 'IR', 'PUP', 'SUSP', 'SUSPENDED', 'RESERVE'])

function normalizePosition(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === 'DST' || raw === 'D/ST') return 'DEF'
  if (raw === 'FLX') return 'FLEX'
  if (raw === 'SUPERFLEX') return 'SUPER_FLEX'
  if (raw === 'BN') return 'BENCH'
  return raw
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return null
}

function toPlayerId(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>
    const id = row.id ?? row.playerId ?? row.player_id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

function normalizePlayer(raw: unknown): RosterRuntimePlayer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const id = toPlayerId(raw)
    return id ? { playerId: id, playerName: id, position: 'UTIL' } : null
  }
  const row = raw as Record<string, unknown>
  const playerId = toPlayerId(row)
  if (!playerId) return null
  const name = row.playerName ?? row.name ?? row.full_name ?? row.fullName ?? playerId
  return {
    playerId,
    playerName: String(name),
    position: normalizePosition(row.position ?? row.pos ?? row.rosterPosition ?? 'UTIL'),
    team: typeof row.team === 'string' ? row.team : typeof row.team_abbreviation === 'string' ? row.team_abbreviation : null,
    status: typeof row.status === 'string' ? row.status : typeof row.injury_status === 'string' ? row.injury_status : null,
    byeWeek: positiveInt(row.byeWeek ?? row.bye_week),
    gameStartIso:
      typeof row.gameStartIso === 'string'
        ? row.gameStartIso
        : typeof row.gameTime === 'string'
          ? row.gameTime
          : typeof row.game_time === 'string'
            ? row.game_time
            : null,
    locked: row.locked === true || row.isLocked === true,
    acquisitionType: typeof row.acquisitionType === 'string' ? row.acquisitionType : null,
  }
}

function normalizeSection(value: unknown): RosterRuntimePlayer[] {
  if (!Array.isArray(value)) return []
  const players: RosterRuntimePlayer[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const player = normalizePlayer(raw)
    if (!player || seen.has(player.playerId)) continue
    seen.add(player.playerId)
    players.push(player)
  }
  return players
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizeStarterTokens(starters: unknown): string[] {
  if (Array.isArray(starters)) {
    const tokens = starters.map(normalizePosition).filter(Boolean)
    return tokens.length ? tokens : DEFAULT_NFL_STARTERS
  }
  if (starters && typeof starters === 'object') {
    const tokens: string[] = []
    for (const [key, rawCount] of Object.entries(starters as Record<string, unknown>)) {
      const token = normalizePosition(key)
      if (!token || token === 'BENCH' || token === 'IR') continue
      const count = positiveInt(rawCount) ?? 0
      for (let i = 0; i < count; i += 1) tokens.push(token)
    }
    return tokens.length ? tokens : DEFAULT_NFL_STARTERS
  }
  return DEFAULT_NFL_STARTERS
}

function allowedPositionsForSlot(token: string): string[] {
  const normalized = normalizePosition(token)
  if (normalized === 'FLEX') return FLEX_POSITIONS
  if (normalized === 'SUPER_FLEX' || normalized === 'OP') return SUPER_FLEX_POSITIONS
  if (normalized === 'DEF') return ['DEF']
  if (BASE_POSITIONS.includes(normalized)) return [normalized]
  return [normalized]
}

export function buildCanonicalStarterSlots(rules: CanonicalLeagueRules): CanonicalRosterSlot[] {
  const tokens = normalizeStarterTokens(rules.roster.starters)
  const seen: Record<string, number> = {}
  return tokens.map((token, index) => {
    const label = normalizePosition(token)
    seen[label] = (seen[label] ?? 0) + 1
    const count = tokens.filter((item) => normalizePosition(item) === label).length
    const display = count > 1 ? `${label}${seen[label]}` : label
    const allowedPositions = allowedPositionsForSlot(label)
    return {
      slotId: `starter-${index + 1}-${display.toLowerCase()}`,
      label: display,
      section: 'starter' as const,
      index,
      allowedPositions,
      required: true,
      flexible: allowedPositions.length > 1,
    }
  })
}

export function getCanonicalRosterCapacity(rules: CanonicalLeagueRules): CanonicalRosterRuntimeTeamState['capacity'] {
  const starterCount = buildCanonicalStarterSlots(rules).length
  const active = Math.max(starterCount, rules.roster.size ?? starterCount)
  const ir = Math.max(0, rules.roster.irSlots ?? 0)
  return {
    starters: starterCount,
    bench: Math.max(0, active - starterCount),
    active,
    ir,
    totalWithIr: active + ir,
  }
}

function slotAccepts(slot: CanonicalRosterSlot, player: RosterRuntimePlayer): boolean {
  const position = normalizePosition(player.position)
  return slot.allowedPositions.map(normalizePosition).includes(position)
}

function isExactSlot(slot: CanonicalRosterSlot, player: RosterRuntimePlayer): boolean {
  if (slot.flexible) return false
  return slotAccepts(slot, player)
}

function buildLock(player: RosterRuntimePlayer, now: Date): { locked: boolean; reason: string | null } {
  if (player.locked) return { locked: true, reason: 'Player is locked by roster state.' }
  if (player.gameStartIso) {
    const parsed = Date.parse(player.gameStartIso)
    if (!Number.isNaN(parsed) && parsed <= now.getTime()) {
      return { locked: true, reason: 'Player is locked after game kickoff.' }
    }
  }
  return { locked: false, reason: null }
}

function assignStartersToSlots(
  players: RosterRuntimePlayer[],
  slots: CanonicalRosterSlot[],
  now: Date,
): { assignments: CanonicalRosterSlotAssignment[]; unassignedStarters: RosterRuntimePlayer[] } {
  const assignments = slots.map((slot) => ({ slot, player: null, locked: false, lockReason: null }) as CanonicalRosterSlotAssignment)
  const unassignedStarters: RosterRuntimePlayer[] = []

  for (const player of players) {
    let target = assignments.find((item) => !item.player && isExactSlot(item.slot, player))
    if (!target) target = assignments.find((item) => !item.player && slotAccepts(item.slot, player))
    if (!target) {
      unassignedStarters.push(player)
      continue
    }
    const lock = buildLock(player, now)
    target.player = player
    target.locked = lock.locked
    target.lockReason = lock.reason
  }

  return { assignments, unassignedStarters }
}

function mapSectionAssignments(
  section: 'bench' | 'ir',
  players: RosterRuntimePlayer[],
  now: Date,
): CanonicalRosterSlotAssignment[] {
  return players.map((player, index) => {
    const lock = buildLock(player, now)
    return {
      slot: {
        slotId: `${section}-${index + 1}`,
        label: section === 'bench' ? `Bench ${index + 1}` : `IR ${index + 1}`,
        section,
        index,
        allowedPositions: section === 'bench' ? BASE_POSITIONS : ['*'],
        required: false,
        flexible: section === 'ir',
      },
      player,
      locked: lock.locked,
      lockReason: lock.reason,
    }
  })
}

function isIrEligible(player: RosterRuntimePlayer, rules: CanonicalLeagueRules): boolean {
  const status = normalizeStatus(player.status)
  if (IR_STATUSES.has(status)) return true
  const allowed = new Set((rules.roster.eligibleReserveStatuses ?? []).map(normalizeStatus))
  return status.length > 0 && allowed.has(status)
}

function allowedRosterPositions(rules: CanonicalLeagueRules): Set<string> {
  const allowed = new Set<string>()
  for (const slot of buildCanonicalStarterSlots(rules)) {
    for (const position of slot.allowedPositions) allowed.add(normalizePosition(position))
  }
  allowed.add('K')
  allowed.add('DEF')
  return allowed
}

export function validateCanonicalRosterLineup(input: {
  rules: CanonicalLeagueRules
  sections: RosterRuntimeSections
  starterAssignments: CanonicalRosterSlotAssignment[]
  unassignedStarters?: RosterRuntimePlayer[]
  scoringWeek?: number | null
}): { ok: boolean; issues: RosterRuntimeValidationIssue[] } {
  const { rules, sections } = input
  const capacity = getCanonicalRosterCapacity(rules)
  const issues: RosterRuntimeValidationIssue[] = []
  const activeRosterSize = sections.starters.length + sections.bench.length

  if (capacity.active < capacity.starters) {
    issues.push({
      code: 'ROSTER_RULE_MISMATCH',
      severity: 'blocking',
      message: `Canonical roster size ${capacity.active} is smaller than required starters ${capacity.starters}.`,
    })
  }
  if (sections.starters.length > capacity.starters) {
    issues.push({
      code: 'STARTER_OVER_LIMIT',
      severity: 'blocking',
      message: `Lineup has ${sections.starters.length} starters, max ${capacity.starters}.`,
      section: 'starters',
    })
  }
  if (sections.bench.length > capacity.bench) {
    issues.push({
      code: 'BENCH_OVER_LIMIT',
      severity: 'blocking',
      message: `Bench has ${sections.bench.length} players, max ${capacity.bench}.`,
      section: 'bench',
    })
  }
  if (activeRosterSize > capacity.active) {
    issues.push({
      code: 'ACTIVE_ROSTER_OVER_LIMIT',
      severity: 'blocking',
      message: `Active roster has ${activeRosterSize} players, max ${capacity.active}.`,
    })
  }
  if (sections.ir.length > capacity.ir) {
    issues.push({
      code: 'IR_OVER_LIMIT',
      severity: 'blocking',
      message: `IR has ${sections.ir.length} players, max ${capacity.ir}.`,
      section: 'ir',
    })
  }

  for (const assignment of input.starterAssignments) {
    if (!assignment.player && assignment.slot.required) {
      issues.push({
        code: 'EMPTY_REQUIRED_STARTER',
        severity: 'blocking',
        message: `${assignment.slot.label} is empty.`,
        section: 'starters',
        slotId: assignment.slot.slotId,
      })
    }
  }
  for (const player of input.unassignedStarters ?? []) {
    issues.push({
      code: 'STARTER_POSITION_INELIGIBLE',
      severity: 'blocking',
      message: `${player.playerName} (${normalizePosition(player.position)}) does not fit an open starter slot.`,
      section: 'starters',
      playerId: player.playerId,
    })
  }

  const seen = new Map<string, RosterRuntimeSection>()
  const allSections: Array<[RosterRuntimeSection, RosterRuntimePlayer[]]> = [
    ['starters', sections.starters],
    ['bench', sections.bench],
    ['ir', sections.ir],
  ]
  const allowed = allowedRosterPositions(rules)
  for (const [section, players] of allSections) {
    for (const player of players) {
      const position = normalizePosition(player.position)
      if (seen.has(player.playerId)) {
        issues.push({
          code: 'DUPLICATE_PLAYER',
          severity: 'blocking',
          message: `${player.playerName} appears in ${seen.get(player.playerId)} and ${section}.`,
          section,
          playerId: player.playerId,
        })
      } else {
        seen.set(player.playerId, section)
      }
      if (section !== 'ir' && !allowed.has(position)) {
        issues.push({
          code: 'INVALID_POSITION',
          severity: 'blocking',
          message: `${position} is not eligible for this NFL redraft roster.`,
          section,
          playerId: player.playerId,
        })
      }
      if (section === 'ir' && !isIrEligible(player, rules)) {
        issues.push({
          code: 'IR_INELIGIBLE',
          severity: 'blocking',
          message: `${player.playerName} is not eligible for IR under canonical rules.`,
          section,
          playerId: player.playerId,
        })
      }
    }
  }

  for (const player of sections.starters) {
    const status = normalizeStatus(player.status)
    if (STARTER_BLOCKING_STATUSES.has(status)) {
      issues.push({
        code: 'INACTIVE_STARTER',
        severity: 'blocking',
        message: `${player.playerName} is ${status} and cannot be submitted as an active starter.`,
        section: 'starters',
        playerId: player.playerId,
      })
    }
    if (input.scoringWeek != null && player.byeWeek === input.scoringWeek) {
      issues.push({
        code: 'STARTER_ON_BYE',
        severity: 'warning',
        message: `${player.playerName} is on bye in week ${input.scoringWeek}.`,
        section: 'starters',
        playerId: player.playerId,
      })
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'blocking'),
    issues,
  }
}

function sectionsFromPlayerData(rules: CanonicalLeagueRules, playerData: unknown): RosterRuntimeSections {
  const row = toRecord(playerData)
  const lineupSections = toRecord(row.lineup_sections)
  const sections = {
    starters: normalizeSection(lineupSections.starters),
    bench: normalizeSection(lineupSections.bench),
    ir: normalizeSection(lineupSections.ir),
  }
  if (sections.starters.length || sections.bench.length || sections.ir.length) return sections

  if (Array.isArray(row.draftPicks)) {
    return buildCanonicalRosterSectionsFromDraftedPlayers({
      rules,
      draftedPlayers: row.draftPicks,
    })
  }

  const starterIds = new Set(Array.isArray(row.starters) ? row.starters.map(String) : [])
  const irIds = new Set(Array.isArray(row.reserve) ? row.reserve.map(String) : [])
  const all = normalizeSection(row.players)
  return {
    starters: all.filter((player) => starterIds.has(player.playerId)),
    bench: all.filter((player) => !starterIds.has(player.playerId) && !irIds.has(player.playerId)),
    ir: all.filter((player) => irIds.has(player.playerId)),
  }
}

export function buildCanonicalRosterRuntimeTeam(input: {
  rules: CanonicalLeagueRules
  team: CanonicalRosterRuntimeTeamInput
  now?: Date
  scoringWeek?: number | null
}): CanonicalRosterRuntimeTeamState {
  const now = input.now ?? new Date()
  const explicitSections = input.team.sections
  const sections: RosterRuntimeSections = explicitSections
    ? {
        starters: explicitSections.starters ?? [],
        bench: explicitSections.bench ?? [],
        ir: explicitSections.ir ?? [],
      }
    : sectionsFromPlayerData(input.rules, input.team.playerData)
  const starterSlots = buildCanonicalStarterSlots(input.rules)
  const { assignments: starterAssignments, unassignedStarters } = assignStartersToSlots(sections.starters, starterSlots, now)
  const benchAssignments = mapSectionAssignments('bench', sections.bench, now)
  const irAssignments = mapSectionAssignments('ir', sections.ir, now)
  const capacity = getCanonicalRosterCapacity(input.rules)
  const lockedPlayerIds = [
    ...starterAssignments,
    ...benchAssignments,
    ...irAssignments,
  ]
    .filter((assignment) => assignment.locked && assignment.player)
    .map((assignment) => assignment.player!.playerId)
  for (const id of input.team.lockOverridePlayerIds ?? []) {
    if (!lockedPlayerIds.includes(id)) lockedPlayerIds.push(id)
  }
  const validation = validateCanonicalRosterLineup({
    rules: input.rules,
    sections,
    starterAssignments,
    unassignedStarters,
    scoringWeek: input.scoringWeek,
  })

  return {
    rosterId: input.team.rosterId,
    displayName: input.team.displayName ?? null,
    platformUserId: input.team.platformUserId ?? null,
    sections,
    starterAssignments,
    benchAssignments,
    irAssignments,
    activeRosterSize: sections.starters.length + sections.bench.length,
    totalRosterSize: sections.starters.length + sections.bench.length + sections.ir.length,
    capacity,
    lockedPlayerIds,
    validation,
  }
}

export function buildCanonicalRosterRuntimeState(input: {
  rules: CanonicalLeagueRules
  teams: CanonicalRosterRuntimeTeamInput[]
  now?: Date
  scoringWeek?: number | null
}): CanonicalRosterRuntimeState {
  const generatedAtIso = (input.now ?? new Date()).toISOString()
  const starterSlots = buildCanonicalStarterSlots(input.rules)
  const teams = input.teams.map((team) =>
    buildCanonicalRosterRuntimeTeam({
      rules: input.rules,
      team,
      now: input.now,
      scoringWeek: input.scoringWeek,
    }),
  )
  const runtimeInvariants = teams.flatMap((team) =>
    team.validation.issues.filter((issue) => issue.code === 'ROSTER_RULE_MISMATCH'),
  )

  return {
    leagueId: input.rules.leagueId,
    rulesVersion: input.rules.version,
    generatedAtIso,
    season: input.rules.general.season,
    scoringWeek: input.scoringWeek ?? null,
    starterSlots,
    teams,
    runtimeInvariants,
  }
}

export function buildCanonicalRosterSectionsFromDraftedPlayers(input: {
  rules: CanonicalLeagueRules
  draftedPlayers: unknown[]
}): RosterRuntimeSections {
  const players = input.draftedPlayers.map(normalizePlayer).filter((player): player is RosterRuntimePlayer => Boolean(player))
  const slots = buildCanonicalStarterSlots(input.rules).map((slot) => ({ slot, player: null as RosterRuntimePlayer | null }))
  const placed = new Set<string>()

  for (const player of players) {
    let target = slots.find((item) => !item.player && !item.slot.flexible && slotAccepts(item.slot, player))
    if (!target) target = slots.find((item) => !item.player && slotAccepts(item.slot, player))
    if (!target) continue
    target.player = player
    placed.add(player.playerId)
  }

  return {
    starters: slots.map((item) => item.player).filter((player): player is RosterRuntimePlayer => Boolean(player)),
    bench: players.filter((player) => !placed.has(player.playerId)),
    ir: [],
  }
}

function insertAt<T>(values: T[], item: T, index?: number): T[] {
  const copy = [...values]
  const safeIndex = index == null ? copy.length : Math.max(0, Math.min(copy.length, Math.floor(index)))
  copy.splice(safeIndex, 0, item)
  return copy
}

function eventTypeForMove(from: RosterRuntimeSection, to: RosterRuntimeSection): CanonicalLeagueRuntimeEventType {
  if (to === 'ir') return 'roster.player.moved_to_ir'
  if (from === 'ir') return 'roster.player.removed_from_ir'
  if (to === 'starters') return 'roster.player.started'
  if (from === 'starters' && to === 'bench') return 'roster.player.benched'
  return 'roster.updated'
}

export function planCanonicalRosterMove(input: RosterMoveInput): RosterMoveResult {
  const locked = input.team.lockedPlayerIds.includes(input.playerId)
  const override = input.actorRole === 'commissioner' && input.commissionerOverride
  if (locked && !override) {
    return {
      ok: false,
      code: 'PLAYER_LOCKED',
      message: 'Player is locked after kickoff and cannot be moved without commissioner override.',
      issues: [
        {
          code: 'LOCKED_PLAYER_MOVED',
          severity: 'blocking',
          message: 'Locked player movement is blocked.',
          playerId: input.playerId,
        },
      ],
    }
  }

  let found: { player: RosterRuntimePlayer; from: RosterRuntimeSection } | null = null
  const next: RosterRuntimeSections = {
    starters: [],
    bench: [],
    ir: [],
  }
  for (const section of ['starters', 'bench', 'ir'] as RosterRuntimeSection[]) {
    for (const player of input.team.sections[section]) {
      if (player.playerId === input.playerId) {
        found = { player, from: section }
      } else {
        next[section].push(player)
      }
    }
  }
  if (!found) return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Player is not on this roster.' }

  if (input.toSection === 'ir') {
    if (next.ir.length >= input.team.capacity.ir) {
      return { ok: false, code: 'IR_FULL', message: 'IR is already at capacity.' }
    }
    if (!isIrEligible(found.player, input.rules) && !override) {
      return { ok: false, code: 'IR_INELIGIBLE', message: 'Player is not eligible for IR under canonical rules.' }
    }
  }
  if (input.toSection === 'starters' && next.starters.length >= input.team.capacity.starters) {
    return { ok: false, code: 'STARTER_FULL', message: 'Starter lineup is already full.' }
  }

  next[input.toSection] = insertAt(next[input.toSection], found.player, input.toIndex)
  const nextTeam = buildCanonicalRosterRuntimeTeam({
    rules: input.rules,
    team: {
      rosterId: input.team.rosterId,
      displayName: input.team.displayName,
      platformUserId: input.team.platformUserId,
      sections: next,
    },
    now: input.now,
    scoringWeek: input.scoringWeek,
  })

  const blocking = nextTeam.validation.issues.filter((issue) => issue.severity === 'blocking')
  if (blocking.length > 0 && !override) {
    return {
      ok: false,
      code: 'LINEUP_INVALID',
      message: blocking.map((issue) => issue.message).join(' '),
      issues: blocking,
    }
  }

  const primaryEventType = eventTypeForMove(found.from, input.toSection)
  return {
    ok: true,
    sections: next,
    nextTeam,
    events: [
      buildRosterRuntimeEvent({
        leagueId: input.rules.leagueId,
        type: primaryEventType,
        payload: {
          rosterId: input.team.rosterId,
          playerId: input.playerId,
          fromSection: found.from,
          toSection: input.toSection,
          commissionerOverride: override,
        },
      }),
      ...(primaryEventType !== 'lineup.starter.changed' && input.toSection === 'starters'
        ? [
            buildRosterRuntimeEvent({
              leagueId: input.rules.leagueId,
              type: 'lineup.starter.changed',
              payload: { rosterId: input.team.rosterId, playerId: input.playerId },
            }),
          ]
        : []),
    ],
  }
}

export function toPersistedPlayerDataFromRosterSections(
  existingPlayerData: unknown,
  sections: RosterRuntimeSections,
): Record<string, unknown> {
  const base = toRecord(existingPlayerData)
  const active = [...sections.starters, ...sections.bench]
  const all = [...active, ...sections.ir]
  return {
    ...base,
    players: all.map((player) => player.playerId),
    starters: sections.starters.map((player) => player.playerId),
    reserve: sections.ir.map((player) => player.playerId),
    lineup_sections: sections,
    lineup_updated_at: new Date().toISOString(),
    roster_runtime: {
      source: 'canonical_roster_runtime',
      updatedAt: new Date().toISOString(),
      totalPlayers: all.length,
    },
  }
}

export function buildRosterRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  occurredAt?: Date | string | null
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    createdAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  })
}
