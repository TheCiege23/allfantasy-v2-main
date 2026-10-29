/**
 * NFL / NCAAF default lineup at the league-CREATION layer.
 *
 * The owner's authority (2026-10-20): a new NFL or NCAAF league starts with QB, RB, RB, WR, WR, TE,
 * FLEX (RB/WR/TE), K and a team defense — NCAAF without the team defense, since no college team
 * defense exists to draft (redraftTeamDefenseEnabled). ffb371161 cut several registries to
 * QB, RB, WR, WR, TE, DEF while lib/league-concepts/redraftDefaults.ts went back to the full lineup;
 * this file pins every one of those registries to redraftDefaults AND checks what a real create writes.
 *
 * Defaults only: nothing here touches an existing league's saved settings.
 */
import { describe, expect, it, vi } from 'vitest'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import {
  getCanonicalRedraftStarterSlots,
  normalizeRedraftRosterSlotKey,
  redraftTeamDefenseEnabled,
} from '@/lib/league-concepts/redraftDefaults'
import { getDraftDefaults, getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { NFL_CONFIG } from '@/lib/sportConfig/configs/nfl'
import { NCAAF_CONFIG } from '@/lib/sportConfig/configs/ncaaf'

const FULL_NFL = { QB: 1, RB: 2, WR: 2, TE: 1, FLX: 1, K: 1, DEF: 1 }
const { DEF: _noCollegeDefense, ...FULL_NCAAF } = FULL_NFL
const EXPECTED = { NFL: FULL_NFL, NCAAF: FULL_NCAAF } as const

/** Normalize a slot map or slot list to the contract's FLX / DEF vocabulary, dropping zero counts. */
function normalized(slots: Record<string, number> | string[]): Record<string, number> {
  const entries: Array<[string, number]> = Array.isArray(slots)
    ? slots.map((slot) => [slot, 1] as [string, number])
    : Object.entries(slots)
  const out: Record<string, number> = {}
  for (const [raw, count] of entries) {
    if (!count) continue
    const key = normalizeRedraftRosterSlotKey(raw)
    out[key] = (out[key] ?? 0) + Number(count)
  }
  return out
}

// Copied from __tests__/create-canonical-league-transaction-contract.test.ts: a fake Prisma tx that
// records what createCanonicalLeagueInTransaction writes.
function buildTx() {
  let rosterCreateCount = 0
  let teamCreateCount = 0
  const tx = {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ displayName: 'Creator Name', xpLevel: 9, legacyCareerLevel: null }),
    },
    appUser: {
      findUnique: vi.fn().mockResolvedValue({ username: 'creator_user', email: 'creator@test.local' }),
    },
    league: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'league-1' }),
    },
    leagueSettings: {
      create: vi.fn().mockResolvedValue({ id: 'ls-1' }),
    },
    leagueWaiverSettings: {
      create: vi.fn().mockResolvedValue({ id: 'lws-1' }),
    },
    scoringSettingsSnapshot: {
      create: vi.fn().mockResolvedValue({ id: 'score-1' }),
    },
    guillotineLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'g-1' }),
    },
    idpLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'idp-1' }),
    },
    dynastyLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'dynasty-1' }),
    },
    devyLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'devy-1' }),
    },
    c2CLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'c2c-1' }),
    },
    redraftLeagueExtendedSettings: {
      create: vi.fn().mockResolvedValue({ id: 'ext-1' }),
    },
    redraftLeagueDraftProfile: {
      create: vi.fn().mockResolvedValue({ id: 'dp-1' }),
    },
    redraftLeagueHomepageState: {
      create: vi.fn().mockResolvedValue({ id: 'home-1' }),
    },
    redraftLeagueSportIntegration: {
      create: vi.fn().mockResolvedValue({ id: 'si-1' }),
    },
    redraftLeagueChatRoom: {
      create: vi.fn().mockResolvedValue({ id: 'chat-1' }),
    },
    roster: {
      create: vi.fn().mockImplementation(async (args?: any) => {
        rosterCreateCount += 1
        return {
          id: `roster-${rosterCreateCount}`,
          platformUserId: args?.data?.platformUserId ?? `platform-${rosterCreateCount}`,
        }
      }),
    },
    leagueTeam: {
      create: vi.fn().mockImplementation(async () => {
        teamCreateCount += 1
        return { id: `team-${teamCreateCount}` }
      }),
    },
    redraftLeagueMember: {
      create: vi.fn().mockResolvedValue({ id: 'member-1' }),
    },
    leagueEntrySlot: {
      createMany: vi.fn().mockResolvedValue({ count: 12 }),
    },
    draftSession: {
      create: vi.fn().mockResolvedValue({ id: 'ds-1' }),
    },
    leagueInvite: {
      create: vi.fn().mockResolvedValue({ id: 'invite-1', token: 'JOIN12345' }),
    },
    findLeagueListing: {
      upsert: vi.fn().mockResolvedValue({ id: 'listing-1' }),
    },
  }

  return tx
}

for (const sport of ['NFL', 'NCAAF'] as const) {
  const scoringPreset = sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'

  describe(`${sport} default lineup`, () => {
    it('redraftDefaults is the authority this file asserts against', () => {
      expect(getCanonicalRedraftStarterSlots({ defenseEnabled: redraftTeamDefenseEnabled(sport) })).toEqual(
        EXPECTED[sport],
      )
    })

    it('every registry that restates default starters agrees with redraftDefaults', () => {
      expect(normalized(getRosterDefaults(sport).starter_slots)).toEqual(EXPECTED[sport])
      expect(normalized(getRedraftSportConfig(sport).starterSlots)).toEqual(EXPECTED[sport])
      const config = sport === 'NFL' ? NFL_CONFIG : NCAAF_CONFIG
      const configStarters = Object.fromEntries(
        config.defaultRosterSlots
          .filter((slot) => !slot.requiresToggle)
          .map((slot) => [slot.key, slot.defaultCount]),
      )
      expect(normalized(configStarters)).toEqual(EXPECTED[sport])
    })

    it('draft rounds cover the draftable default roster (starters + bench)', () => {
      const starters = Object.values(EXPECTED[sport]).reduce((a, b) => a + b, 0)
      const bench = getRosterDefaults(sport).bench_slots
      expect(getDraftDefaults(sport).rounds_default).toBe(starters + bench)
      expect(getRedraftSportConfig(sport).defaultDraftRounds).toBe(starters + bench)
    })

    it('getLeagueDefaults (the foundation-defaults layer) yields the full lineup for a redraft league', () => {
      const defaults = getLeagueDefaults({
        sport,
        format: 'redraft',
        draftType: 'snake',
        managerCount: 12,
        scoringPreset,
      })
      const rosterSettings = defaults.rosterSettings as Record<string, unknown>
      expect(normalized(rosterSettings.starterSlots as Record<string, number>)).toEqual(EXPECTED[sport])
    })

    it('a real canonical create writes the full lineup into the new league settings', async () => {
      const leagueName = `${sport} Default Lineup`
      const body = {
        concept: 'redraft',
        sport,
        teamCount: 12,
        draftType: 'snake',
        scoringPreset,
        leagueName,
        language: 'en',
        tradeReviewMode: 'commissioner',
      } as any
      const engine = runPresetEngine({
        concept: 'redraft',
        sport,
        teamCount: 12,
        draftType: 'snake',
        scoringPreset,
        leagueName,
        commissionerId: 'app-user-1',
      })
      const tx = buildTx()
      await createCanonicalLeagueInTransaction(tx as any, 'app-user-1', body, engine as any)

      const settings = tx.league.create.mock.calls[0]?.[0]?.data?.settings as Record<string, any>
      expect(normalized(settings.starter_slots)).toEqual(EXPECTED[sport])
      expect(normalized(settings.starter_slot_order)).toEqual(EXPECTED[sport])
      expect(normalized(settings.rosterSettings.starterSlots)).toEqual(EXPECTED[sport])
    })
  })
}
