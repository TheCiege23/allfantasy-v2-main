import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import {
  buildMergePreview,
  conflictTypeKey,
  countByConfidence,
  isPlayerMergeable,
  localizeMergeMessage,
  stepForStatus,
  type ImportSourceSummary,
  type ManagerMappingRow,
  type MergeConflictRow,
  type PlayerMappingRow,
} from '@/app/devy/lib/importWizardModel'

const player = (o: Partial<PlayerMappingRow> = {}): PlayerMappingRow => ({
  id: 'p', externalId: 'x', externalName: 'Name', externalPlatform: 'sleeper', externalPosition: null, externalTeam: null,
  externalSchool: null, internalPlayerId: 'ip', internalPlayerName: 'Name', matchConfidence: 'exact', matchMethod: 'id_lookup',
  isConfirmedByCommissioner: false, requiresReview: false, playerType: 'nfl_veteran', ...o,
})
const manager = (o: Partial<ManagerMappingRow> = {}): ManagerMappingRow => ({
  id: 'm', externalUsername: 'u', externalDisplayName: 'U', externalPlatform: 'sleeper', internalUserId: 'uid', internalUsername: 'U',
  matchConfidence: 'exact', isConfirmedByCommissioner: false, requiresReview: false, ...o,
})
const source = (season: number | null): ImportSourceSummary => ({
  id: `s${season}`, sourceType: 'league_id_entry', sourcePlatform: 'sleeper', classification: 'nfl_roster', connectionStatus: 'connected',
  importedAt: null, createdAt: '2026-10-01', playerCount: 1, managerCount: 1, season, hasError: false,
})
const conflict = (resolution = 'pending'): MergeConflictRow => ({ id: 'c', conflictType: 'duplicate_player', description: 'd', resolution })

describe('mergeability mirrors the merge engine', () => {
  it('writes an exact, unreviewed match or any confirmed match — and never a row with no player', () => {
    expect(isPlayerMergeable(player())).toBe(true)
    expect(isPlayerMergeable(player({ matchConfidence: 'high' }))).toBe(false)
    expect(isPlayerMergeable(player({ matchConfidence: 'high', isConfirmedByCommissioner: true }))).toBe(true)
    expect(isPlayerMergeable(player({ requiresReview: true }))).toBe(false)
    expect(isPlayerMergeable(player({ internalPlayerId: null, isConfirmedByCommissioner: true }))).toBe(false)
  })

  it('the engine imports the same rule rather than keeping its own copy', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/devy/mergeExecutionEngine.ts'), 'utf8')
    expect(src).toMatch(/^import \{ mergeablePlayer \} from '@\/lib\/devy\/importMergeRules'/m)
    expect(src).not.toMatch(/^function mergeablePlayer/m)
  })
})

describe('buildMergePreview', () => {
  it('splits NFL and devy writes, counts skips, and lists seasons once each in order', () => {
    const p = buildMergePreview(
      [
        player({ id: '1' }),
        player({ id: '2', playerType: 'devy' }),
        player({ id: '3', matchConfidence: 'high' }),
        player({ id: '4', internalPlayerId: null, matchConfidence: 'low' }),
      ],
      [manager()],
      [],
      [source(2024), source(2023), source(2024), source(null)],
    )
    expect(p).toMatchObject({ nflPlayers: 1, devyPlayers: 1, needsConfirmation: 1, unmatchedPlayers: 1, skippedPlayers: 2, historySeasons: [2023, 2024], canMerge: true })
  })

  it('blocks on a pending conflict and on an unlinked manager that still needs review', () => {
    expect(buildMergePreview([player()], [manager()], [conflict()], []).canMerge).toBe(false)
    expect(buildMergePreview([player()], [manager()], [conflict('skipped')], []).canMerge).toBe(true)
    const blocked = buildMergePreview([player()], [manager({ internalUserId: null, requiresReview: true })], [], [])
    expect(blocked).toMatchObject({ blockingManagers: 1, canMerge: false })
    // Confirmed without a link: not a blocker, the merge just skips that manager's players.
    expect(buildMergePreview([player()], [manager({ internalUserId: null, requiresReview: false })], [], []).canMerge).toBe(true)
  })

  it('has nothing to merge when no player is ready and no season is present', () => {
    expect(buildMergePreview([player({ matchConfidence: 'low' })], [], [], []).canMerge).toBe(false)
  })
})

describe('small helpers', () => {
  it('opens the step a session stopped at', () => {
    expect([undefined, 'pending', 'source_connected', 'classified', 'matching', 'conflict_review', 'approved', 'merged'].map(stepForStatus)).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
  })
  it('counts an unmatched row as unmatched whatever confidence it carries', () => {
    expect(countByConfidence([player(), player({ internalPlayerId: null, matchConfidence: 'low' }), player({ matchConfidence: 'weird' })])).toEqual({ exact: 1, high: 0, medium: 0, low: 0, unmatched: 2 })
  })
  it('maps unknown conflict types to the fallback', () => {
    expect(conflictTypeKey('duplicate_player')).toBe('duplicate_player')
    expect(conflictTypeKey('brand_new_kind')).toBe('other')
  })
})

describe('localizeMergeMessage renders every English line the engine writes', () => {
  const es = (k: string, v?: Record<string, string | number>) => tInterpolate((key) => translations.es[key] ?? key, k, v ?? {})
  const engineLines = [
    '2 conflicts still pending',
    'Unmatched managers require review',
    'DevyLeague row missing — create devy config before merge',
    'No RedraftSeason for league — create a season before merge',
    'Session not found',
    'No manager mapping for Bijan Robinson (external roster owner bob)',
    'No manager mapping for Bijan Robinson (external roster owner unknown)',
    'No redraft roster for owner u_1',
    'Some players could not be matched automatically.',
    'Some managers need manual linking.',
  ]
  it.each(engineLines)('%s', (line) => {
    const out = localizeMergeMessage(line, es)
    expect(out).not.toBe(line)
    expect(out).not.toMatch(/devyImport\./)
    expect(out).not.toMatch(/\{\{/)
  })
  it('keeps the player name and owner, and passes unknown text through untouched', () => {
    expect(localizeMergeMessage('No manager mapping for Bijan Robinson (external roster owner bob)', es)).toBe('Bijan Robinson: su mánager (bob) no está vinculado.')
    expect(localizeMergeMessage('something new', es)).toBe('something new')
  })
  it('the engine still writes those exact lines (a reworded engine message would fall through to English)', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/devy/mergeExecutionEngine.ts'), 'utf8')
    for (const needle of [
      'conflicts still pending',
      "'Unmatched managers require review'",
      "'DevyLeague row missing",
      "'No RedraftSeason for league",
      '`No manager mapping for ${m.externalName} (external roster owner ${mgrExternal ?? \'unknown\'})`',
      '`No redraft roster for owner ${ownerId}`',
      "'Some players could not be matched automatically.'",
      "'Some managers need manual linking.'",
    ]) {
      expect(src, needle).toContain(needle)
    }
  })
})

describe('every key the import UI asks for exists in English and Spanish', () => {
  const files = ['app/devy/components/ImportWizard.tsx', 'app/devy/components/settings/DevyImportPanel.tsx', 'app/devy/lib/importWizardModel.ts']
  const src = files.map(f => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n')
  const literal = [...src.matchAll(/'(devyImport\.[A-Za-z0-9_.]+[A-Za-z0-9_])'/g)].map(m => m[1]!)
  // Keys built from a template: enumerate every value the template can take.
  const templated = [
    ...['pending', 'source_connected', 'classified', 'matching', 'conflict_review', 'approved', 'merged'].map(s => `devyImport.status.${s}`),
    ...['sleeper', 'csv', 'other'].map(s => `devyImport.platform.${s}`),
    ...['connected', 'partial', 'failed'].map(s => `devyImport.connection.${s}`),
    ...['nfl_roster', 'devy_roster', 'history'].map(s => `devyImport.classification.${s}`),
    ...['sleeper', 'csv'].map(s => `devyImport.source.kind.${s}`),
    ...['exact', 'high', 'medium', 'low', 'unmatched'].map(s => `devyImport.confidence.${s}`),
    ...['duplicate_player', 'graduated_devy_on_nfl_roster', 'username_mismatch', 'conflicting_picks', 'player_on_two_rosters', 'other'].flatMap(s => [
      `devyImport.conflictType.${s}`,
      `devyImport.conflictHint.${s}`,
    ]),
    ...['commissioner_resolved', 'skipped'].map(s => `devyImport.resolution.${s}`),
    ...['high', 'medium', 'low'].map(s => `devyImport.audit.level.${s}`),
  ]
  const all = [...new Set([...literal, ...templated])]

  it('found the keys (a scan that matches nothing proves nothing)', () => {
    expect(literal.length).toBeGreaterThan(100)
  })
  it.each(['en', 'es'] as const)('%s has all of them', (lang) => {
    const missing = all.filter(k => typeof translations[lang][k] !== 'string' || translations[lang][k]!.length === 0)
    expect(missing).toEqual([])
  })
  it('Spanish is actually Spanish where the copy is prose, and never says «waiver»', () => {
    const same = all.filter(k => translations.es[k] === translations.en[k] && !/csvPlaceholder/.test(k))
    expect(same).toEqual([])
    expect(all.filter(k => /waiver/i.test(translations.es[k] ?? ''))).toEqual([])
  })
})
