import { canonicalName, canonicalPosition, canonicalTeam, isProviderImage, getCanonicalPlayerKey } from '@/lib/draft-room/player-canonical-identity'
import { detectSharedImages, type ImageConflict } from '@/lib/players/player-image-pipeline'

export type PlayerPoolAuditRow = {
  id?: string | null
  canonicalPlayerId?: string | null
  providerPlayerId?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
  sport?: string | null
  birthDate?: string | null
  imageUrl?: string | null
  status?: string | null
  source?: string | null
  rookie?: boolean | null
  yearsExp?: number | null
  adp?: number | null
  fantasyPointsPerGame?: number | null
  lifetimeValue?: number | null
  primaryStatValue?: number | null
  secondaryStatValue?: number | null
  /** Phase 2: external ID fields used for canonical key resolution */
  sleeperId?: string | null
  sportsDataId?: string | null
  apiSportsId?: string | null
  thesportsdbId?: string | null
}

export type DuplicateGroup = {
  key: string
  count: number
  players: Array<{
    id: string | null
    name: string
    position: string | null
    team: string | null
    imageUrl: string | null
  }>
}

export type PlayerPoolAuditReport = {
  totalPlayers: number
  duplicateCanonicalGroups: DuplicateGroup[]
  duplicateProviderGroups: DuplicateGroup[]
  duplicateNameTeamPositionGroups: DuplicateGroup[]
  duplicateNameBirthdateGroups: DuplicateGroup[]
  duplicateNameSportNoTeamGroups: DuplicateGroup[]
  missingImageCount: number
  missingImageExamples: string[]
  suspiciousImageCount: number
  suspiciousImageExamples: string[]
  /** Phase 2: players with real provider headshot */
  realImageCount: number
  /** Phase 2: players with placeholder/missing headshot */
  placeholderImageCount: number
  /** Phase 2: percentage of players with real headshots (0-100) */
  imageRealPercent: number
  /** Phase 2: canonical key collision warnings (two players sharing same canonical key) */
  canonicalCollisionWarnings: string[]
  /** Phase 2: image URL shared across multiple distinct canonical identities */
  imageReuseConflicts: string[]
  missingNameCount: number
  malformedNameExamples: string[]
  missingTeamCount: number
  missingPositionCount: number
  missingStatusCount: number
  missingStatsCount: number
  missingAdpCount: number
  rookieFlagMissingCount: number
  rookieExamples: string[]
  sourceBreakdown: Record<string, number>
  topProblemPlayers: Array<{
    name: string
    position: string | null
    team: string | null
    issues: string[]
    issueScore: number
  }>
  recommendedFixes: string[]
}

const PLACEHOLDER_IMAGE_PATTERNS = [
  /placeholder/i,
  /default/i,
  /missing/i,
  /avatar/i,
  /blank/i,
  /silhouette/i,
  /generic/i,
  /ui-avatars/i,
  /dicebear/i,
]

function cleanString(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeAuditPlayerName(value: string | null | undefined): string {
  return canonicalName(normalizeWhitespace(cleanString(value)))
}

function normalizedBirthDate(value: string | null | undefined): string {
  const v = cleanString(value)
  if (!v) return ''
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v
}

function looksLikePlaceholderImage(url: string | null | undefined): boolean {
  const value = cleanString(url)
  if (!value) return false
  if (value.toLowerCase().startsWith('data:')) return true
  return PLACEHOLDER_IMAGE_PATTERNS.some((re) => re.test(value))
}

function isMissingImage(url: string | null | undefined): boolean {
  const value = cleanString(url)
  if (!value) return true
  if (value === 'null' || value === 'undefined' || value === '-' || value === 'n/a') return true
  return false
}

function isMalformedName(name: string | null | undefined): boolean {
  const value = normalizeWhitespace(cleanString(name))
  if (!value) return false
  if (value.length < 2) return true
  if (/[^\p{L}\p{N}\s'\-\.]/u.test(value)) return true
  if (!/[\p{L}]/u.test(value)) return true
  if (/(.)\1{4,}/.test(value)) return true
  return false
}

function isFiniteNumeric(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  const n = Number(value)
  return Number.isFinite(n)
}

function missingStats(row: PlayerPoolAuditRow): boolean {
  const hasAnyStat =
    isFiniteNumeric(row.adp) ||
    isFiniteNumeric(row.primaryStatValue) ||
    isFiniteNumeric(row.secondaryStatValue) ||
    isFiniteNumeric(row.fantasyPointsPerGame) ||
    isFiniteNumeric(row.lifetimeValue)
  return !hasAnyStat
}

function displayName(row: PlayerPoolAuditRow): string {
  const name = normalizeWhitespace(cleanString(row.name))
  if (name) return name
  return '(missing name)'
}

function toSimplePlayer(row: PlayerPoolAuditRow) {
  return {
    id: cleanString(row.id) || null,
    name: displayName(row),
    position: cleanString(row.position) || null,
    team: cleanString(row.team) || null,
    imageUrl: cleanString(row.imageUrl) || null,
  }
}

function groupedDuplicates(rows: PlayerPoolAuditRow[], keyOf: (row: PlayerPoolAuditRow) => string): DuplicateGroup[] {
  const grouped = new Map<string, PlayerPoolAuditRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }

  const result: DuplicateGroup[] = []
  for (const [key, list] of grouped.entries()) {
    if (list.length < 2) continue
    result.push({
      key,
      count: list.length,
      players: list.slice(0, 8).map(toSimplePlayer),
    })
  }

  result.sort((a, b) => b.count - a.count)
  return result
}

export function buildPlayerPoolAudit(rows: PlayerPoolAuditRow[]): PlayerPoolAuditReport {
  const normalizedRows = rows.map((row) => ({
    ...row,
    name: normalizeWhitespace(cleanString(row.name)) || null,
    position: canonicalPosition(row.position),
    team: canonicalTeam(row.team) || null,
    sport: cleanString(row.sport).toUpperCase() || null,
    birthDate: normalizedBirthDate(row.birthDate) || null,
    imageUrl: cleanString(row.imageUrl) || null,
    status: cleanString(row.status) || null,
    source: cleanString(row.source) || null,
    canonicalPlayerId: cleanString(row.canonicalPlayerId) || null,
    providerPlayerId: cleanString(row.providerPlayerId) || null,
  }))

  const duplicateCanonicalGroups = groupedDuplicates(normalizedRows, (row) => row.canonicalPlayerId ?? '')
  const duplicateProviderGroups = groupedDuplicates(normalizedRows, (row) => row.providerPlayerId ?? '')
  const duplicateNameTeamPositionGroups = groupedDuplicates(
    normalizedRows,
    (row) => `${normalizeAuditPlayerName(row.name)}|${canonicalTeam(row.team)}|${canonicalPosition(row.position)}`,
  )
  const duplicateNameBirthdateGroups = groupedDuplicates(normalizedRows, (row) => {
    const name = normalizeAuditPlayerName(row.name)
    const birth = normalizedBirthDate(row.birthDate)
    if (!name || !birth) return ''
    return `${name}|${birth}`
  })
  const duplicateNameSportNoTeamGroups = groupedDuplicates(normalizedRows, (row) => {
    const name = normalizeAuditPlayerName(row.name)
    const sport = cleanString(row.sport)
    const team = canonicalTeam(row.team)
    if (!name || !sport || team) return ''
    return `${name}|${sport}`
  })

  const missingImageRows = normalizedRows.filter((row) => isMissingImage(row.imageUrl))
  const malformedNameRows = normalizedRows.filter((row) => isMalformedName(row.name))
  const missingNameRows = normalizedRows.filter((row) => !cleanString(row.name))
  const missingTeamRows = normalizedRows.filter((row) => !canonicalTeam(row.team))
  const missingPositionRows = normalizedRows.filter((row) => !canonicalPosition(row.position))
  const missingStatusRows = normalizedRows.filter((row) => !cleanString(row.status))
  const missingStatsRows = normalizedRows.filter((row) => missingStats(row))
  const missingAdpRows = normalizedRows.filter((row) => !isFiniteNumeric(row.adp))

  const rookieFlagMissingRows = normalizedRows.filter((row) => {
    const yearsExp = row.yearsExp
    if (yearsExp == null || !Number.isFinite(Number(yearsExp))) return false
    if (Number(yearsExp) !== 0) return false
    return row.rookie !== true
  })

  const imageByUrl = new Map<string, PlayerPoolAuditRow[]>()
  for (const row of normalizedRows) {
    const imageUrl = cleanString(row.imageUrl)
    if (!imageUrl) continue
    const key = imageUrl.toLowerCase()
    const list = imageByUrl.get(key) ?? []
    list.push(row)
    imageByUrl.set(key, list)
  }

  const duplicateImageExamples: string[] = []
  let duplicateImageCount = 0
  for (const [imageUrl, list] of imageByUrl.entries()) {
    const distinctNames = new Set(list.map((row) => normalizeAuditPlayerName(row.name)).filter(Boolean))
    if (distinctNames.size < 2) continue
    duplicateImageCount += list.length
    if (duplicateImageExamples.length < 8) {
      duplicateImageExamples.push(`${imageUrl} -> ${[...distinctNames].slice(0, 3).join(', ')}`)
    }
  }

  const placeholderImageRows = normalizedRows.filter((row) => looksLikePlaceholderImage(row.imageUrl))

  const suspiciousDuplicateNameImageRows = new Set<string>()
  for (const group of duplicateNameTeamPositionGroups) {
    const imageSet = new Set(group.players.map((p) => cleanString(p.imageUrl).toLowerCase()).filter(Boolean))
    if (imageSet.size === 1 && group.count > 1) {
      for (const p of group.players) {
        suspiciousDuplicateNameImageRows.add(`${normalizeAuditPlayerName(p.name)}|${cleanString(p.imageUrl).toLowerCase()}`)
      }
    }
  }

  const sourceBreakdown: Record<string, number> = {}
  for (const row of normalizedRows) {
    const source = cleanString(row.source) || 'unknown'
    sourceBreakdown[source] = (sourceBreakdown[source] ?? 0) + 1
  }

  // Phase 2: real vs placeholder image counts
  const realImageRows = normalizedRows.filter((row) => isProviderImage(row.imageUrl) && !row.imageUrl?.startsWith('data:'))
  const placeholderRows = normalizedRows.filter((row) => !isProviderImage(row.imageUrl) || looksLikePlaceholderImage(row.imageUrl))
  const imageRealPercent = normalizedRows.length > 0 ? Math.round((realImageRows.length / normalizedRows.length) * 100) : 0

  // Phase 2: canonical key collision detection
  const canonicalKeyMap = new Map<string, string[]>()
  for (const row of normalizedRows) {
    const key = getCanonicalPlayerKey({
      sleeperId: row.sleeperId,
      sportsDataId: row.sportsDataId,
      apiSportsId: row.apiSportsId,
      thesportsdbId: row.thesportsdbId,
      name: row.name,
      position: row.position,
      team: row.team,
    })
    const names = canonicalKeyMap.get(key) ?? []
    names.push(displayName(row))
    canonicalKeyMap.set(key, names)
  }
  const canonicalCollisionWarnings: string[] = []
  for (const [key, names] of canonicalKeyMap.entries()) {
    if (names.length > 1) {
      canonicalCollisionWarnings.push(`key "${key}" → ${names.slice(0, 4).join(', ')}`)
    }
  }

  // Phase 2: image reuse conflicts (same non-Sleeper URL shared by distinct canonical identities)
  const sharedImageConflicts: ImageConflict[] = detectSharedImages(
    normalizedRows.map((row) => ({
      id: row.id ?? null,
      name: row.name ?? null,
      position: row.position ?? null,
      team: row.team ?? null,
      imageUrl: row.imageUrl ?? null,
      sleeperId: row.sleeperId ?? null,
    })),
  )
  const imageReuseConflicts: string[] = sharedImageConflicts.slice(0, 12).map((c) => {
    const names = c.players.map((p) => p.name).join(', ')
    return `"${c.imageUrl}" shared by: ${names}`
  })

  const problemScoreByPlayer = new Map<string, { name: string; position: string | null; team: string | null; issues: Set<string>; score: number }>()
  const addProblem = (row: PlayerPoolAuditRow, issue: string, score = 1) => {
    const key = `${normalizeAuditPlayerName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    if (!key) return
    const current =
      problemScoreByPlayer.get(key) ??
      {
        name: displayName(row),
        position: canonicalPosition(row.position) || null,
        team: canonicalTeam(row.team) || null,
        issues: new Set<string>(),
        score: 0,
      }
    current.issues.add(issue)
    current.score += score
    problemScoreByPlayer.set(key, current)
  }

  missingImageRows.forEach((row) => addProblem(row, 'missing image', 2))
  malformedNameRows.forEach((row) => addProblem(row, 'malformed name', 2))
  missingTeamRows.forEach((row) => addProblem(row, 'missing team', 1))
  missingPositionRows.forEach((row) => addProblem(row, 'missing position', 1))
  missingStatsRows.forEach((row) => addProblem(row, 'missing stats', 1))
  missingAdpRows.forEach((row) => addProblem(row, 'missing adp', 1))
  rookieFlagMissingRows.forEach((row) => addProblem(row, 'rookie flag missing', 1))

  const topProblemPlayers = [...problemScoreByPlayer.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((entry) => ({
      name: entry.name,
      position: entry.position,
      team: entry.team,
      issues: [...entry.issues],
      issueScore: entry.score,
    }))

  const recommendedFixes = [
    duplicateCanonicalGroups.length > 0 || duplicateProviderGroups.length > 0
      ? 'Consolidate duplicate identity rows by canonical/provider ID before rendering draft pool.'
      : null,
    duplicateNameTeamPositionGroups.length > 0
      ? 'Add a deterministic unique constraint/upsert key on normalized name+team+position in ingestion staging.'
      : null,
    missingImageRows.length > 0 || placeholderImageRows.length > 0
      ? 'Backfill headshots from approved provider sources and keep placeholder-only URLs out of primary image fields.'
      : null,
    missingStatsRows.length > 0
      ? 'Backfill PlayerSeasonStats/ADP snapshots before draft room reads and expose synced_at in diagnostics.'
      : null,
    missingAdpRows.length > 0 && missingAdpRows.length === normalizedRows.length
      ? 'No ADP snapshots matched any pool row — verify AllFantasyAdpSnapshot.playerKey shape (`${normalizedName}|${POSITION}`) and recompute job ran for this sport/season.'
      : null,
    rookieFlagMissingRows.length > 0
      ? 'Derive rookie flag from yearsExp/source metadata in normalization to avoid inconsistent rookie visibility.'
      : null,
  ].filter((v): v is string => Boolean(v))

  return {
    totalPlayers: normalizedRows.length,
    duplicateCanonicalGroups,
    duplicateProviderGroups,
    duplicateNameTeamPositionGroups,
    duplicateNameBirthdateGroups,
    duplicateNameSportNoTeamGroups,
    missingImageCount: missingImageRows.length,
    missingImageExamples: missingImageRows.slice(0, 12).map((row) => displayName(row)),
    suspiciousImageCount:
      placeholderImageRows.length +
      duplicateImageCount +
      suspiciousDuplicateNameImageRows.size,
    suspiciousImageExamples: [
      ...placeholderImageRows.slice(0, 6).map((row) => `${displayName(row)} -> ${cleanString(row.imageUrl)}`),
      ...duplicateImageExamples,
    ].slice(0, 12),
    realImageCount: realImageRows.length,
    placeholderImageCount: placeholderRows.length,
    imageRealPercent,
    canonicalCollisionWarnings: canonicalCollisionWarnings.slice(0, 20),
    imageReuseConflicts,
    missingNameCount: missingNameRows.length,
    malformedNameExamples: malformedNameRows.slice(0, 12).map((row) => displayName(row)),
    missingTeamCount: missingTeamRows.length,
    missingPositionCount: missingPositionRows.length,
    missingStatusCount: missingStatusRows.length,
    missingStatsCount: missingStatsRows.length,
    missingAdpCount: missingAdpRows.length,
    rookieFlagMissingCount: rookieFlagMissingRows.length,
    rookieExamples: rookieFlagMissingRows.slice(0, 12).map((row) => displayName(row)),
    sourceBreakdown,
    topProblemPlayers,
    recommendedFixes,
  }
}

export function buildDraftRoomClientDiagnostics(
  rows: Array<{ id?: string | null; name?: string | null; position?: string | null; team?: string | null; imageUrl?: string | null }>,
) {
  const ids = new Map<string, number>()
  const names = new Map<string, number>()
  const malformed: string[] = []
  let missingImages = 0
  let missingTeamOrPosition = 0

  for (const row of rows) {
    const id = cleanString(row.id)
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1)

    const normalizedName = normalizeAuditPlayerName(row.name)
    if (normalizedName) names.set(normalizedName, (names.get(normalizedName) ?? 0) + 1)

    if (isMissingImage(row.imageUrl)) missingImages += 1
    if (!canonicalTeam(row.team) || !canonicalPosition(row.position)) missingTeamOrPosition += 1
    if (isMalformedName(row.name) && malformed.length < 10) malformed.push(displayName(row))
  }

  const duplicatePlayerIds = [...ids.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  const duplicateNormalizedNames = [...names.entries()].filter(([, count]) => count > 1).map(([key]) => key)

  return {
    totalPlayers: rows.length,
    duplicatePlayerIds,
    duplicateNormalizedNames,
    missingImages,
    malformedNameExamples: malformed,
    missingTeamOrPosition,
    hasIssues:
      duplicatePlayerIds.length > 0 ||
      duplicateNormalizedNames.length > 0 ||
      missingImages > 0 ||
      malformed.length > 0 ||
      missingTeamOrPosition > 0,
  }
}
