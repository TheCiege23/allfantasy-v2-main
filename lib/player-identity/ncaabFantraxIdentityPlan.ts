import { normalizePlayerName } from '@/lib/team-abbrev'

type NcaabFantraxRef = { fantraxId: string; name: string; team: string; position: string }
export type NcaabIdentity = {
  id: string
  normalizedName: string | null
  position: string | null
  currentTeam: string | null
  rollingInsightsId: string | null
  fantraxId: string | null
}
type NcaabSourcePlayer = { externalId: string; name: string; position: string | null; team: string | null }
type NcaabTeam = { name: string; shortName: string | null }

const teamKey = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase()
/*
 * Letters and spaces only. Fantrax drops apostrophes and hyphens ("OConnor, Collin", "Hayes, Jaichaunn")
 * where the registry keeps them (Collin O'Connor, Jai'chaunn Hayes) — measured 2026-11-19, the largest
 * single cause of "no identity with this name" among rostered unlinked ids. Both sides go through this.
 */
const letters = (value: string) => normalizePlayerName(value).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
const nameKey = (value: string) => {
  const parts = value.split(',')
  return letters(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value)
}
const splitName = (key: string) => {
  const words = key.split(' ').filter(Boolean)
  return words.length >= 2 ? { given: words[0]!, last: words.slice(1).join(' ') } : null
}
/** Given names of one person: equal, or sharing a 3+ letter start (Daniel/Dan, Kordelius/Kordel). */
const sameGiven = (a: string, b: string) => {
  if (a === b) return true
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n >= 3
}

/**
 * Fantrax's school code -> one `SportsTeam` school name, or '' when it cannot be said.
 *
 * 🛑 MOST FANTRAX CODES ARE NOT OUR CODES. Captured 2026-11-19 (`contracts/fantrax/fixtures/
 * ncaab-player-ids.json`): 191 of Fantrax's 365 school codes (PRINC, CORN, SAMF, KAN, OHST, MIA-O…)
 * match no `SportsTeam.shortName` (PRIN, COR, SAM, KU, OSU, M-OH), so 2,805 players at those schools
 * could never link, however exact their name. A code we do not hold is LEARNED, the way the NCAAF
 * matcher learns its school codes (`verifiedFantraxSchoolAliases`): only from three or more players
 * already linked by Fantrax id, all at one school. One dissenting anchor teaches nothing, and a code
 * we do hold is never overridden. Measured on that capture: 183 codes learned, 0 conflicting.
 */
function learnSchoolCodes(
  refs: readonly NcaabFantraxRef[],
  identities: readonly NcaabIdentity[],
  schoolByCode: ReadonlyMap<string, ReadonlySet<string>>,
  uniqueNameSchool: (ref: NcaabFantraxRef) => string | null,
): (code: string | null | undefined) => string {
  const linked = new Map<string, NcaabIdentity[]>()
  for (const identity of identities) {
    if (identity.fantraxId) linked.set(identity.fantraxId, [...(linked.get(identity.fantraxId) ?? []), identity])
  }
  const anchors = new Map<string, Map<string, Set<string>>>()
  for (const ref of refs) {
    const code = teamKey(ref.team)
    const rows = linked.get(ref.fantraxId)
    if (!code || schoolByCode.has(code) || rows?.length !== 1 || !rows[0]!.currentTeam) continue
    const bySchool = anchors.get(code) ?? new Map<string, Set<string>>()
    const school = teamKey(rows[0]!.currentTeam)
    bySchool.set(school, (bySchool.get(school) ?? new Set<string>()).add(ref.fantraxId))
    anchors.set(code, bySchool)
  }
  /*
   * A code with NO linked player yet (Villanova "Vill", Mercer, UNH, Little Rock "ArkLR": 90 rostered
   * players, 2026-11-19) can never gain an anchor that way — nobody there links until the code resolves.
   * For those codes only, a player whose name is held by exactly one identity AND listed once by Fantrax
   * stands in as the anchor, under the same agreement rule.
   */
  const bootstrap = new Map<string, Map<string, Set<string>>>()
  for (const ref of refs) {
    const code = teamKey(ref.team)
    if (!code || schoolByCode.has(code) || anchors.has(code)) continue
    const school = uniqueNameSchool(ref)
    if (!school) continue
    const bySchool = bootstrap.get(code) ?? new Map<string, Set<string>>()
    bySchool.set(school, (bySchool.get(school) ?? new Set<string>()).add(ref.fantraxId))
    bootstrap.set(code, bySchool)
  }
  /*
   * Unanimous with three anchors, or a supermajority (10+ on one school and 85%+ of all) — one transfer
   * whose Fantrax listing lags must not veto a school, as the NCAAF matcher found for 21 FBS codes.
   */
  const learned = new Map<string, string>()
  for (const [code, bySchool] of [...anchors, ...bootstrap]) {
    const ranked = [...bySchool].sort((a, b) => b[1].size - a[1].size)
    const [school, ids] = ranked[0]!
    const total = ranked.reduce((n, [, x]) => n + x.size, 0)
    if (bySchool.size === 1 ? ids.size >= 3 : ids.size >= 10 && ids.size >= 0.85 * total) learned.set(code, school)
  }
  return (code) => {
    const key = teamKey(code)
    const held = schoolByCode.get(key)
    if (held) return held.size === 1 ? [...held][0]! : ''
    return learned.get(key) ?? ''
  }
}

/**
 * #3910's learner (`Verify college basketball school aliases against current appearances`), kept as it
 * landed: a code is learned from three distinct players with a CURRENT game appearance at the school, unique
 * names on both sides, the same position, and no competing school. `activeByName` is what it matches a code
 * it alone taught against. Its strict normalised-name key is kept for the same reason.
 */
function learnFromAppearances(args: {
  refs: readonly NcaabFantraxRef[]
  identities: readonly NcaabIdentity[]
  sourceById: ReadonlyMap<string, NcaabSourcePlayer[]>
  schoolByCode: ReadonlyMap<string, ReadonlySet<string>>
  currentAppearances?: readonly { playerId: string; team: string | null }[]
}) {
  const strictKey = (value: string) => { const parts = value.split(','); return normalizePlayerName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value) }
  const gameSchools = new Map<string, Set<string>>()
  for (const row of args.currentAppearances ?? []) {
    const schools = args.schoolByCode.get(teamKey(row.team))
    const claims = gameSchools.get(row.playerId) ?? new Set<string>()
    claims.add(schools?.size === 1 ? [...schools][0]! : '')
    gameSchools.set(row.playerId, claims)
  }
  const activeByName = new Map<string, NcaabIdentity[]>()
  for (const identity of args.identities) {
    if (!identity.rollingInsightsId || !identity.normalizedName || !identity.currentTeam || !identity.position) continue
    const sources = args.sourceById.get(identity.rollingInsightsId)
    if (sources?.length !== 1) continue
    const source = sources[0]!
    if (normalizePlayerName(source.name) !== identity.normalizedName || teamKey(source.team) !== teamKey(identity.currentTeam) ||
        source.position !== identity.position) continue
    const game = gameSchools.get(identity.id)
    if (game?.size === 1 && game.has(teamKey(identity.currentTeam))) {
      activeByName.set(identity.normalizedName, [...(activeByName.get(identity.normalizedName) ?? []), identity])
    }
  }
  const providerNames = new Map<string, number>()
  const providerIds = new Map<string, number>()
  for (const ref of args.refs) {
    const name = strictKey(ref.name)
    providerNames.set(name, (providerNames.get(name) ?? 0) + 1)
    providerIds.set(ref.fantraxId, (providerIds.get(ref.fantraxId) ?? 0) + 1)
  }
  const schoolVotes = new Map<string, Map<string, Set<string>>>()
  for (const ref of args.refs) {
    const code = teamKey(ref.team), name = strictKey(ref.name)
    if (!code || args.schoolByCode.has(code) || providerNames.get(name) !== 1 || providerIds.get(ref.fantraxId) !== 1) continue
    const matches = activeByName.get(name)
    if (matches?.length !== 1) continue
    const player = matches[0]!
    if (ref.position !== player.position || (player.fantraxId && player.fantraxId !== ref.fantraxId)) continue
    const school = teamKey(player.currentTeam), votes = schoolVotes.get(code) ?? new Map<string, Set<string>>()
    votes.set(school, (votes.get(school) ?? new Set<string>()).add(player.id))
    schoolVotes.set(code, votes)
  }
  const learned = new Map<string, string>()
  for (const [code, votes] of schoolVotes) {
    const [first] = votes
    if (votes.size === 1 && first && first[1].size >= 3) learned.set(code, first[0])
  }
  /** A ref at a code only this learner taught: its one active, unlinked namesake there in the same position. */
  const eligible = (ref: NcaabFantraxRef, school: string) => {
    const rows = (activeByName.get(strictKey(ref.name)) ?? []).filter(p => teamKey(p.currentTeam) === school && p.position === ref.position)
    return rows.length === 1 && !rows[0]!.fantraxId ? rows : []
  }
  return { learned, eligible }
}

/** Attach only rostered Fantrax IDs with one exact name and school match (position breaks a tie). */
export function planNcaabFantraxIdentityLinks(args: {
  refs: readonly NcaabFantraxRef[]
  identities: readonly NcaabIdentity[]
  sourcePlayers: readonly NcaabSourcePlayer[]
  teams: readonly NcaabTeam[]
  rosterIds: ReadonlySet<string>
  currentAppearances?: readonly { playerId: string; team: string | null }[]
}) {
  const schoolByCode = new Map<string, Set<string>>()
  for (const team of args.teams) {
    const code = teamKey(team.shortName)
    if (!code) continue
    const names = schoolByCode.get(code) ?? new Set<string>()
    names.add(teamKey(team.name))
    schoolByCode.set(code, names)
  }

  const sourceById = new Map<string, NcaabSourcePlayer[]>()
  for (const player of args.sourcePlayers) {
    const rows = sourceById.get(player.externalId) ?? []
    rows.push(player)
    sourceById.set(player.externalId, rows)
  }
  /*
   * Every identity counts toward uniqueness (linked ones too — a namesake already linked to another
   * Fantrax id still makes a name common). Only an identity that agrees with its own Rolling Insights row
   * on name and school is a CANDIDATE. Position is not part of that agreement: the registry and RI disagree
   * on the G/F/C label for the same player (8 rostered players, 2026-11-19).
   */
  const identityByKey = new Map<string, NcaabIdentity[]>()
  const candidatesByName = new Map<string, NcaabIdentity[]>()
  const candidatesBySurname = new Map<string, NcaabIdentity[]>()
  const allByName = new Map<string, number>()
  const allBySurname = new Map<string, number>()
  const ownedSourceIds = new Set<string>()
  const keyOf = (identity: NcaabIdentity) => letters(identity.normalizedName ?? '')
  for (const identity of args.identities) {
    const name = keyOf(identity), s = splitName(name)
    if (name) allByName.set(name, (allByName.get(name) ?? 0) + 1)
    if (s && identity.currentTeam) { const k = `${s.last}|${teamKey(identity.currentTeam)}`; allBySurname.set(k, (allBySurname.get(k) ?? 0) + 1) }
    if (identity.fantraxId) ownedSourceIds.add(identity.fantraxId)
    if (identity.fantraxId || !identity.rollingInsightsId || !name || !identity.currentTeam) continue
    const sources = sourceById.get(identity.rollingInsightsId)
    if (sources?.length !== 1) continue
    const source = sources[0]!
    if (letters(source.name) !== name || teamKey(source.team) !== teamKey(identity.currentTeam)) continue
    const school = teamKey(identity.currentTeam)
    identityByKey.set(`${name}|${school}`, [...(identityByKey.get(`${name}|${school}`) ?? []), identity])
    candidatesByName.set(name, [...(candidatesByName.get(name) ?? []), identity])
    if (s) candidatesBySurname.set(`${s.last}|${school}`, [...(candidatesBySurname.get(`${s.last}|${school}`) ?? []), identity])
  }
  // Source side of uniqueness: how often Fantrax lists a name anywhere, or a surname at a school.
  const refsByName = new Map<string, number>()
  for (const ref of args.refs) {
    if (ref.position === 'Tm' || !ref.name) continue
    const name = nameKey(ref.name)
    refsByName.set(name, (refsByName.get(name) ?? 0) + 1)
  }
  const uniqueNameSchool = (ref: NcaabFantraxRef) => {
    if (ref.position === 'Tm' || !ref.name) return null
    const name = nameKey(ref.name)
    const rows = candidatesByName.get(name)
    return rows?.length === 1 && allByName.get(name) === 1 && refsByName.get(name) === 1 ? teamKey(rows[0]!.currentTeam) : null
  }

  /*
   * TWO LEARNERS, BOTH KEPT (owner's decision 2026-11-19): this file's (linked anchors, unique-name
   * bootstrap, supermajority) and #3910's (current game appearances). A code we hold resolves as before. A
   * code either one learned resolves to its school; a code they learned DIFFERENTLY resolves to nothing,
   * so neither can override the other. The disagreement is judged at the CODE (owner's decision: the
   * stricter per-player reading would have refused 357 of 558 correct links — players with no minutes yet,
   * F vs PF, apostrophes, transfers). A code only #3910's learner taught is matched by its own rule (a
   * current appearance at the school); a code this file's learner knows, alone or in agreement, by this
   * file's rules. No per-player veto from box scores: the appearance feed's codes collide with ours (New
   * Haven players appear as UNH, our New Hampshire; NOVA, UWG and MER are held twice), and an unresolved or
   * colliding code is not evidence of another school — #3910's learner treats it the same way. A veto
   * tried here refused 45 correct links, all players appearing for their own school.
   */
  const mineOf = learnSchoolCodes(args.refs, args.identities, schoolByCode, uniqueNameSchool)
  const appearances = learnFromAppearances({ refs: args.refs, identities: args.identities, sourceById, schoolByCode, currentAppearances: args.currentAppearances })
  const schoolFor = (code: string | null | undefined): { school: string; via: 'held' | 'mine' | 'both' | 'appearances' | 'none' } => {
    const key = teamKey(code)
    if (schoolByCode.has(key)) return { school: mineOf(code), via: 'held' }
    const mine = mineOf(code), theirs = appearances.learned.get(key) ?? ''
    if (mine && theirs && mine !== theirs) return { school: '', via: 'none' }
    if (mine && theirs) return { school: mine, via: 'both' }
    if (mine) return { school: mine, via: 'mine' }
    if (theirs) return { school: theirs, via: 'appearances' }
    return { school: '', via: 'none' }
  }
  const schoolOf = (code: string | null | undefined) => schoolFor(code).school
  const refsBySchoolSurname = new Map<string, number>()
  for (const ref of args.refs) {
    if (ref.position === 'Tm' || !ref.name) continue
    const school = schoolOf(ref.team), s = splitName(nameKey(ref.name))
    if (school && s) refsBySchoolSurname.set(`${s.last}|${school}`, (refsBySchoolSurname.get(`${s.last}|${school}`) ?? 0) + 1)
  }
  const sourceCounts = new Map<string, number>()
  const candidates = new Map<string, NcaabIdentity[]>()
  const claims = new Map<string, Set<string>>()
  for (const ref of args.refs) {
    sourceCounts.set(ref.fantraxId, (sourceCounts.get(ref.fantraxId) ?? 0) + 1)
    const { school, via } = schoolFor(ref.team)
    if (!school || !ref.position || !ref.name || ref.position === 'Tm') continue
    if (via === 'appearances') {
      const rows = appearances.eligible(ref, school)
      candidates.set(ref.fantraxId, rows)
      for (const row of rows) claims.set(row.id, (claims.get(row.id) ?? new Set<string>()).add(ref.fantraxId))
      continue
    }
    /*
     * Name + school, and position only to break a tie. Measured 2026-11-19 on the rostered ids still
     * unlinked in production: of those with exactly one same-name identity at a known school, 23%
     * disagreed with Fantrax on the label alone (F/G, C/F) — the same disagreement the NBA matcher
     * (`proFantraxIdentityPlan.ts`) measured at 70% and stopped requiring. Two same-named players on
     * one college roster are still split by position, and refused when position cannot split them.
     */
    const name = nameKey(ref.name), s = splitName(name)
    const named = identityByKey.get(`${name}|${school}`) ?? []
    const samePosition = named.filter((row) => row.position === ref.position)
    let rows = named.length > 1 ? samePosition : named
    /*
     * A spelling of the name the registry does not hold (Kordelius / Kordel Jefferson, Daniel / Dan
     * Skillings): the school's only identity with that surname, given names sharing a 3+ letter start,
     * and the only Fantrax player with that surname at the school. A shared initial alone never counts.
     */
    if (!rows.length && !named.length && s && allBySurname.get(`${s.last}|${school}`) === 1 && refsBySchoolSurname.get(`${s.last}|${school}`) === 1) {
      const pool = candidatesBySurname.get(`${s.last}|${school}`) ?? []
      const other = pool.length === 1 ? splitName(keyOf(pool[0]!)) : null
      if (other && sameGiven(s.given, other.given)) rows = pool
    }
    /*
     * A transfer (140 rostered players, 2026-11-19: JoJo Moore, Tulane on Fantrax, Oral Roberts here). Only
     * when the name is held by exactly ONE identity in the whole sport and Fantrax lists it exactly once.
     */
    if (!rows.length && allByName.get(name) === 1 && refsByName.get(name) === 1) rows = candidatesByName.get(name) ?? []
    candidates.set(ref.fantraxId, rows)
    for (const row of rows) {
      const ids = claims.get(row.id) ?? new Set<string>()
      ids.add(ref.fantraxId)
      claims.set(row.id, ids)
    }
  }

  const links: Array<{ id: string; fantraxId: string; rollingInsightsId: string }> = []
  let ambiguous = 0
  let conflicts = 0
  for (const fantraxId of args.rosterIds) {
    if (ownedSourceIds.has(fantraxId)) continue
    const rows = candidates.get(fantraxId) ?? []
    if (rows.length !== 1 || sourceCounts.get(fantraxId) !== 1) {
      if (rows.length > 1 || (rows.length && sourceCounts.get(fantraxId) !== 1)) ambiguous++
      continue
    }
    const row = rows[0]!
    if (claims.get(row.id)?.size !== 1) { conflicts++; continue }
    links.push({ id: row.id, fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  return { links, ambiguous, conflicts }
}
