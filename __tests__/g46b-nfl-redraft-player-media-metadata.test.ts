import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import {
  buildNflRedraftPlayerMetadata,
  buildNflRedraftPlayerMetadataFromIdentity,
  buildNflRedraftPlayerMetadataFromWire,
  type NflRedraftPlayerDisplayMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'
import { normalizeSportsDataIoPlayerIdentity, normalizeSleeperPlayerIdentity } from '@/lib/nfl-provider'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { mergeUnifiedIntoRosterState, type RosterStateMergeable } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import { tradeEvidenceFromUnifiedWire } from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import {
  getDraftRoomDisplayHeadshot,
  getDraftRoomDisplayName,
  getDraftRoomDisplayPosition,
  getDraftRoomDisplayTeam,
} from '@/lib/player-data/adapters/draftRoomDisplayFields'
import { mapNormalizedDraftEntryToPlayerEntry } from '@/lib/player-data/adapters/draftRoomPlayerAdapter'

const NOW = new Date('2026-07-03T12:00:00.000Z')

function wire(metadata: NflRedraftPlayerDisplayMetadata, partial: Partial<UnifiedPlayerWireDto> = {}): UnifiedPlayerWireDto {
  return {
    id: 'af-player-1',
    name: 'Legacy Name',
    position: 'RB',
    team: 'LAR',
    sport: 'NFL',
    headshotUrl: 'https://legacy.test/headshot.png',
    imageUrl: 'https://legacy.test/headshot.png',
    teamLogoUrl: 'https://legacy.test/logo.png',
    injuryStatus: null,
    fantasyPointsPerGame: null,
    projectedPoints: null,
    adp: null,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'rolling_insights',
    statsSource: 'rolling_insights',
    projectionsSource: null,
    normalizedStats: {},
    normalizedProjections: {},
    nflRedraftPlayerMetadata: metadata,
    product: {
      unified: {} as UnifiedPlayerWireDto['product']['unified'],
      yearsExp: null,
      byeWeek: metadata.byeWeek,
    },
    ...partial,
  }
}

function canonicalMetadata(): NflRedraftPlayerDisplayMetadata {
  return buildNflRedraftPlayerMetadata({
    displayName: 'Canonical Runner',
    playerName: 'Canonical Runner',
    teamAbbr: 'KC',
    position: 'QB',
    fantasyPositions: ['QB', 'SUPER_FLEX'],
    jerseyNumber: 15,
    headshotUrl: 'https://canonical.test/player.png',
    teamLogoUrl: 'https://canonical.test/kc.svg',
    byeWeek: 10,
    activeStatus: 'active',
    providerFreshness: {
      status: 'available',
      updatedAtIso: '2026-07-03T11:45:00.000Z',
      ageMinutes: 15,
      maxAgeMinutes: 1440,
      stale: false,
      warnings: [],
    },
    providerFallback: {
      fallback: false,
      fields: [],
      labels: [],
    },
  })
}

describe('G46B NFL redraft player media and metadata wiring', () => {
  it('creates display-safe metadata from canonical provider identity', () => {
    const identity = normalizeSportsDataIoPlayerIdentity(
      {
        PlayerID: 18890,
        Name: 'Patrick Mahomes',
        Team: 'KC',
        Position: 'QB',
        FantasyPositions: ['QB', 'SUPER_FLEX'],
        Number: 15,
        PhotoUrl: 'https://cdn.test/mahomes.png',
        TeamLogoUrl: 'https://cdn.test/kc.svg',
        ByeWeek: 10,
        Active: true,
        Updated: '2026-07-03T11:30:00.000Z',
        providerPayload: { private: true },
      },
      { now: NOW },
    )
    const metadata = buildNflRedraftPlayerMetadataFromIdentity(identity)

    expect(metadata).toMatchObject({
      modelVersion: 'nfl-redraft-player-metadata-v1',
      displayName: 'Patrick Mahomes',
      teamAbbr: 'KC',
      position: 'QB',
      fantasyPositions: ['QB', 'SUPER_FLEX'],
      jerseyNumber: 15,
      byeWeek: 10,
      activeStatus: 'active',
    })
    expect(metadata.headshot).toMatchObject({ url: 'https://cdn.test/mahomes.png', safeToRenderImage: true, fallbackKind: 'none' })
    expect(metadata.teamLogo).toMatchObject({ url: 'https://cdn.test/kc.svg', safeToRenderImage: true, fallbackKind: 'none' })
    expect(metadata.providerFreshness).toMatchObject({ status: 'available', stale: false, ageMinutes: 30 })
    expect(JSON.stringify(metadata)).not.toContain('PlayerID')
    expect(JSON.stringify(metadata)).not.toContain('providerPayload')
    expect(JSON.stringify(metadata)).not.toContain('sportsDataIoId')
    expect(JSON.stringify(metadata)).not.toContain('providerPlayerId')
  })

  it('uses honest fallback metadata for missing headshots, missing logos, and stale provider records', () => {
    const identity = normalizeSleeperPlayerIdentity(
      {
        player_id: '4046',
        full_name: 'Christian McCaffrey',
        team: 'SFO',
        position: 'RB',
        fantasy_positions: ['RB', 'FLEX'],
        active: true,
        metadata: { image_url: '/not-real.jpg' },
      },
      {
        now: NOW,
        fetchedAtIso: '2026-07-03T12:00:00.000Z',
        sourceUpdatedAtIso: '2026-07-01T08:00:00.000Z',
        fallback: true,
      },
    )
    const metadata = buildNflRedraftPlayerMetadataFromIdentity(identity)

    expect(metadata.headshot).toMatchObject({
      url: null,
      safeToRenderImage: false,
      fallbackUrl: null,
      fallbackKind: 'player-initials',
      fallbackLabel: 'CM',
    })
    expect(metadata.teamLogo).toMatchObject({
      url: null,
      safeToRenderImage: false,
      fallbackUrl: null,
      fallbackKind: 'team-text-badge',
      fallbackLabel: 'SF',
    })
    expect(metadata.providerFreshness.stale).toBe(true)
    expect(metadata.providerFallback.fallback).toBe(true)
  })

  it('wires canonical metadata through draft room and mock draft player rows', () => {
    const entry = {
      playerId: 'player-9',
      name: 'Legacy Receiver',
      position: 'WR',
      team: 'JAC',
      byeWeek: 12,
      yearsExp: 2,
      display: {
        playerId: 'player-9',
        displayName: 'Canonical Receiver',
        sport: 'NFL',
        assets: {
          headshotUrl: 'https://draft.test/player.png',
          teamLogoUrl: 'https://draft.test/jax.svg',
        },
        team: {
          teamId: 'jax',
          abbreviation: 'JAX',
          displayName: 'Jacksonville Jaguars',
          sport: 'NFL',
          logoUrl: 'https://draft.test/jax.svg',
        },
        stats: { byeWeek: 12 },
        metadata: {
          position: 'WR',
          teamAbbreviation: 'JAX',
          externalSourceId: 'provider-9',
        },
      },
    } as unknown as NormalizedDraftEntry

    const row = mapNormalizedDraftEntryToPlayerEntry(entry, {
      useAllFantasyAdp: true,
      aiAdpLookupMaps: { strict: new Map(), loose: new Map() },
    })

    expect(row.canonicalPlayerMetadata?.displayName).toBe('Canonical Receiver')
    expect(getDraftRoomDisplayName(row)).toBe('Canonical Receiver')
    expect(getDraftRoomDisplayTeam(row)).toBe('JAX')
    expect(getDraftRoomDisplayPosition(row)).toBe('WR')
    expect(getDraftRoomDisplayHeadshot(row)).toBe('https://draft.test/player.png')
    expect(JSON.stringify(row.canonicalPlayerMetadata)).not.toContain('provider-9')
  })

  it('makes roster, waiver, trade, matchup, team display, and player-card adapters consume canonical metadata first', () => {
    const metadata = canonicalMetadata()
    const row = wire(metadata)

    const waiver = adaptWaiverWirePlayer(row)
    const trade = tradeEvidenceFromUnifiedWire(row)
    const matchup = matchupContextFromUnifiedWire(row)
    const display = displayPlayerFromUnifiedRow(row)
    const rosterState: RosterStateMergeable = {
      starters: [{ id: row.id, name: 'Old', team: 'LAR', position: 'RB', opponent: '', gameTime: '', projection: 0, actual: null, status: 'healthy', slot: 'starters' }],
      bench: [],
      ir: [],
      taxi: [],
      devy: [],
    }
    const roster = mergeUnifiedIntoRosterState(rosterState, [row])

    expect(waiver.displayHeadshotUrl).toBe('https://canonical.test/player.png')
    expect(waiver.displayTeamLogoUrl).toBe('https://canonical.test/kc.svg')
    expect(waiver.displayByeWeek).toBe(10)
    expect(waiver.canonicalPlayerMetadata).toBe(metadata)
    expect(trade).toMatchObject({ name: 'Canonical Runner', position: 'QB', team: 'KC', headshotUrl: 'https://canonical.test/player.png' })
    expect(matchup).toMatchObject({ name: 'Canonical Runner', position: 'QB', team: 'KC', teamLogoUrl: 'https://canonical.test/kc.svg' })
    expect(display).toMatchObject({ name: 'Canonical Runner', position: 'QB', team: 'KC', imageUrl: 'https://canonical.test/player.png' })
    expect(roster.starters[0]).toMatchObject({
      name: 'Canonical Runner',
      team: 'KC',
      position: 'QB',
      headshotUrl: 'https://canonical.test/player.png',
      teamLogoUrl: 'https://canonical.test/kc.svg',
      canonicalPlayerMetadata: metadata,
    })
  })

  it('builds metadata from wire rows without provider payload leakage when deeper canonical data is absent', () => {
    const metadata = buildNflRedraftPlayerMetadataFromWire(
      wire(canonicalMetadata(), {
        nflRedraftPlayerMetadata: undefined,
        nflRedraft: undefined,
        name: 'Fallback Player',
        position: 'TE',
        team: 'NYG',
        headshotUrl: null,
        imageUrl: null,
        teamLogoUrl: null,
        lowConfidence: true,
      }),
    )

    expect(metadata).toMatchObject({
      displayName: 'Fallback Player',
      teamAbbr: 'NYG',
      position: 'TE',
    })
    expect(metadata?.headshot.url).toBeNull()
    expect(metadata?.headshot.fallbackKind).toBe('player-initials')
    expect(metadata?.teamLogo.fallbackKind).toBe('team-text-badge')
    expect(metadata?.providerFallback.fallback).toBe(true)
    expect(JSON.stringify(metadata)).not.toContain('providerIds')
  })
})
