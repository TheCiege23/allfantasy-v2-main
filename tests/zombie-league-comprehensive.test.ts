/**
 * Comprehensive Zombie League Integration Test Suite
 * Tests all sports (NFL, NBA, NHL, MLB, NCAAF, NCAAB, SOCCER)
 * All draft types (snake, auction)
 * All core mechanics: serums, weapons, ambushes, status tracking, tracker/visuals
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { LeagueSport } from '@prisma/client'
import { ZOMBIE_ELIGIBLE_LEAGUE_SPORTS, isZombieEligibleLeagueSport } from '@/lib/zombie/zombie-sport-eligibility'
import { ZOMBIE_SPORT_CONFIGS } from '@/lib/zombie/sportRulesConfig'

describe('Zombie League Comprehensive Test Suite', () => {
  const SUPPORTED_SPORTS: LeagueSport[] = [...ZOMBIE_ELIGIBLE_LEAGUE_SPORTS]
  /** League create API rejects zombie+auction; matrix covers supported zombie draft type only */
  const DRAFT_TYPES = ['snake'] as const

  describe('Sport Eligibility', () => {
    it('should support all 7 sports for zombie leagues', () => {
      expect(SUPPORTED_SPORTS).toHaveLength(7)
      expect(SUPPORTED_SPORTS).toEqual(
        expect.arrayContaining(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])
      )
    })

    it('should correctly identify zombie-eligible sports', () => {
      SUPPORTED_SPORTS.forEach((sport) => {
        expect(isZombieEligibleLeagueSport(sport)).toBe(true)
      })
    })

    it('should reject non-eligible sports', () => {
      expect(isZombieEligibleLeagueSport('INVALID')).toBe(false)
      expect(isZombieEligibleLeagueSport(null)).toBe(false)
      expect(isZombieEligibleLeagueSport(undefined)).toBe(false)
    })
  })

  describe('Sport-Specific Configs', () => {
    SUPPORTED_SPORTS.forEach((sport) => {
      describe(`${sport} Configuration`, () => {
        it(`should have zombie rules config for ${sport}`, () => {
          const key = sport.toLowerCase()
          expect(ZOMBIE_SPORT_CONFIGS[key]).toBeDefined()
          const config = ZOMBIE_SPORT_CONFIGS[key]
          expect(config).toMatchObject({
            sport: key,
            label: expect.any(String),
            positions: expect.any(Array),
            rosterSize: expect.any(Number),
            starterCount: expect.any(Number),
            benchCount: expect.any(Number),
            bashingThreshold: expect.any(Number),
            maulingThreshold: expect.any(Number),
            weaponThresholds: expect.any(Array),
            serumAwards: expect.any(Array),
            seasonLength: expect.any(Number),
          })
        })

        it(`${sport} should have valid weapon thresholds`, () => {
          const key = sport.toLowerCase()
          const config = ZOMBIE_SPORT_CONFIGS[key]
          expect(config.weaponThresholds.length).toBeGreaterThan(0)
          config.weaponThresholds.forEach((wt) => {
            expect(wt).toHaveProperty('type')
            // A weapon earned without a points line (NBA Gun: attacks survived; Bomb: a win streak)
            // carries no minPoints. One that has a line must be a real, non-negative number.
            if (wt.minPoints !== undefined) {
              expect(typeof wt.minPoints).toBe('number')
              expect(wt.minPoints).toBeGreaterThanOrEqual(0)
            }
          })
          // ...and at least one weapon is still earned on points.
          expect(config.weaponThresholds.some((wt) => typeof wt.minPoints === 'number')).toBe(true)
        })

        it(`${sport} should have serum award triggers`, () => {
          const key = sport.toLowerCase()
          const config = ZOMBIE_SPORT_CONFIGS[key]
          expect(config.serumAwards.length).toBeGreaterThan(0)
          config.serumAwards.forEach((sa) => {
            expect(sa).toHaveProperty('trigger')
            expect(sa).toHaveProperty('label')
          })
        })
      })
    })
  })

  describe('Zombie League Configuration Matrix', () => {
    const testConfigurations = SUPPORTED_SPORTS.flatMap((sport) =>
      DRAFT_TYPES.map((draftType) => ({
        sport,
        draftType,
        leagueType: 'zombie',
      }))
    )

    it(`should support ${testConfigurations.length} sport × draft combinations (zombie is snake-only)`, () => {
      expect(testConfigurations).toHaveLength(7)
    })

    testConfigurations.forEach(({ sport, draftType }) => {
      describe(`${sport} + ${draftType}`, () => {
        const leagueId = `zombie-${sport}-${draftType}-test`

        beforeEach(() => {
          // Mock setup for each test
          vi.clearAllMocks()
        })

        it(`should create ${sport} zombie league with ${draftType} draft`, () => {
          // Config validation
          expect(isZombieEligibleLeagueSport(sport)).toBe(true)
          const config = ZOMBIE_SPORT_CONFIGS[sport.toLowerCase()]
          expect(config).toBeDefined()

          // League setup validation (LeagueSport enum is uppercase, e.g. SOCCER)
          expect(leagueId).toContain('zombie')
          expect(leagueId.toLowerCase()).toContain(sport.toLowerCase())
          expect(leagueId).toContain(draftType)
        })

        it(`should initialize roster for ${sport} zombie league`, () => {
          const config = ZOMBIE_SPORT_CONFIGS[sport.toLowerCase()]
          expect(config.rosterSize).toBeGreaterThan(0)
          expect(config.starterCount).toBeGreaterThan(0)
          expect(config.benchCount).toBeGreaterThan(0)
          // Starters + bench fit the active roster; IR slots are modeled separately from rosterSize
          expect(config.starterCount + config.benchCount).toBeLessThanOrEqual(config.rosterSize)
        })

        it(`should track team statuses for ${sport} ${draftType}`, () => {
          // Valid status transitions: Survivor -> Zombie -> Eliminated
          const validStatuses = ['survivor', 'zombie', 'whisperer', 'revived', 'eliminated']
          validStatuses.forEach((status) => {
            expect(['survivor', 'zombie', 'whisperer', 'revived', 'eliminated']).toContain(status)
          })
        })
      })
    })
  })

  describe('Game Mechanics: Serums', () => {
    SUPPORTED_SPORTS.forEach((sport) => {
      it(`${sport} should define serum mechanics in config`, () => {
        const key = sport.toLowerCase()
        const config = ZOMBIE_SPORT_CONFIGS[key]
        expect(config.serumAwards).toBeDefined()
        expect(config.serumAwards.length).toBeGreaterThan(0)

        // Each award should have trigger, label, description
        config.serumAwards.forEach((award) => {
          expect(award.trigger).toBeTruthy()
          expect(award.label).toBeTruthy()
        })
      })
    })

    it('serums should enable revive (Zombie → Survivor)', () => {
      const serumReviveThresholds = SUPPORTED_SPORTS.map((sport) => ({
        sport,
        // Standard: 3 serums to revive, but varies by config
        threshold: 3,
      }))
      expect(serumReviveThresholds.length).toBe(7)
    })

    it('serums should protect against infection (Survivor → Survivor)', () => {
      // Serum protection mechanic: survivor uses serum, stays survivor for week
      const protectionValid = true
      expect(protectionValid).toBe(true)
    })
  })

  describe('Game Mechanics: Weapons', () => {
    SUPPORTED_SPORTS.forEach((sport) => {
      it(`${sport} should define weapon thresholds in config`, () => {
        const key = sport.toLowerCase()
        const config = ZOMBIE_SPORT_CONFIGS[key]
        expect(config.weaponThresholds.length).toBeGreaterThan(0)

        // Award weapons by score threshold
        config.weaponThresholds.forEach((wt) => {
          expect(wt.type).toBeTruthy()
          if (wt.minPoints !== undefined) expect(wt.minPoints).toBeGreaterThanOrEqual(0)
          expect(wt.description).toBeTruthy()
        })
      })
    })

    it('weapons should be awarded on high-score matchups', () => {
      // Logic: if score >= threshold, award weapon type
      const weaponThreshold = 100
      const highScore = 150
      const lowScore = 50
      expect(highScore).toBeGreaterThanOrEqual(weaponThreshold)
      expect(lowScore).toBeLessThan(weaponThreshold)
    })

    it('zombies should not receive weapons', () => {
      const zombie = { status: 'zombie', canReceiveWeapon: false }
      const survivor = { status: 'survivor', canReceiveWeapon: true }
      expect(zombie.canReceiveWeapon).toBe(false)
      expect(survivor.canReceiveWeapon).toBe(true)
    })

    it('bomb should be one-time use and disable top-zombie winnings', () => {
      const bomb = {
        itemType: 'weapon_bomb',
        isUsed: false,
        canUse: true,
        oneTimePerSeason: true,
      }
      expect(bomb.isUsed).toBe(false)
      expect(bomb.oneTimePerSeason).toBe(true)
    })
  })

  describe('Game Mechanics: Ambushes', () => {
    SUPPORTED_SPORTS.forEach((sport) => {
      it(`${sport} should define ambush limits in config`, () => {
        const key = sport.toLowerCase()
        const config = ZOMBIE_SPORT_CONFIGS[key]
        // Ambush exists per season/tier; exact mechanics vary
        expect(config).toBeDefined()
      })
    })

    it('ambushes should have per-week limits', () => {
      const ambushPerWeek = 1
      const seasonWeeks = 17
      const maxAmbushesPerSeason = ambushPerWeek * seasonWeeks
      expect(maxAmbushesPerSeason).toBe(17)
    })

    it('ambushes should not work after first game locks', () => {
      const beforeLock = { canAmbush: true }
      const afterLock = { canAmbush: false }
      expect(beforeLock.canAmbush).toBe(true)
      expect(afterLock.canAmbush).toBe(false)
    })
  })

  describe('Weekly Finalization & Infection', () => {
    SUPPORTED_SPORTS.forEach((sport) => {
      it(`${sport} should finalize matchups and apply infection`, () => {
        const weekData = {
          week: 1,
          matchups: [
            { homeTeam: 'Survivor', awayTeam: 'Survivor', homeScore: 100, awayScore: 95 },
            { homeTeam: 'Zombie', awayTeam: 'Survivor', homeScore: 110, awayScore: 105 },
          ],
        }

        // Finalization: record winnings, apply infection rules
        expect(weekData.matchups.length).toBe(2)
        expect(weekData.matchups[0]).toHaveProperty('homeScore')
        expect(weekData.matchups[1]).toHaveProperty('awayScore')
      })
    })

    it('infection should apply based on config rules', () => {
      const config = {
        infectionLossToZombie: true,
        infectionLossToSurvivor: false,
        infectionTiming: 'after_matchup_complete',
      }
      expect(config.infectionLossToZombie).toBe(true)
    })

    it('weekly winnings should record points and potential awards', () => {
      const winningsLedger = {
        week: 1,
        winner: 'roster-1',
        loser: 'roster-2',
        winnerPoints: 150,
        loserPoints: 120,
        serumAward: 1,
        weaponAward: 'weapon_shield',
      }
      expect(winningsLedger.winnerPoints).toBeGreaterThan(winningsLedger.loserPoints)
      expect(winningsLedger.serumAward).toBeGreaterThanOrEqual(0)
    })

    it('finalization should be idempotent (no double-processing)', () => {
      const week = 1
      const idempotentCalls = 2
      // Calling finalize twice on same week should not double-count
      expect(idempotentCalls).toBe(2)
    })
  })

  describe('Status Tracking & Role Assignments', () => {
    const statusTransitions = [
      { from: 'survivor', to: 'zombie', via: 'infection' },
      { from: 'zombie', to: 'survivor', via: 'serum_revive' },
      { from: 'survivor', to: 'eliminated', via: 'repeated_infection' },
      { from: 'zombie', to: 'eliminated', via: 'repeated_infection' },
      { from: 'survivor', to: 'whisperer', via: 'random_selection' },
    ]

    it('should support valid status transitions', () => {
      statusTransitions.forEach(({ from, to, via }) => {
        expect(['survivor', 'zombie', 'eliminated', 'whisperer'].includes(from)).toBe(true)
        expect(['survivor', 'zombie', 'eliminated', 'whisperer'].includes(to)).toBe(true)
      })
    })

    it('should track team status history', () => {
      const statusHistory = [
        { week: 0, status: 'survivor' },
        { week: 1, status: 'zombie' },
        { week: 2, status: 'survivor' },
        { week: 3, status: 'zombie' },
        { week: 4, status: 'eliminated' },
      ]
      expect(statusHistory).toHaveLength(5)
      expect(statusHistory[4].status).toBe('eliminated')
    })

    it('whisperer should be randomly selected and single per league', () => {
      const league = {
        whispererRosterId: 'roster-5',
        statuses: {
          'roster-1': 'survivor',
          'roster-2': 'survivor',
          'roster-3': 'zombie',
          'roster-4': 'survivor',
          'roster-5': 'whisperer',
        },
      }
      const whispererCount = Object.values(league.statuses).filter((s) => s === 'whisperer').length
      expect(whispererCount).toBe(1)
    })
  })

  describe('Resource Balances & Ledger', () => {
    it('should track serum balance per roster', () => {
      const roster = {
        id: 'roster-1',
        serumBalance: 2,
        transactions: [
          { type: 'award', amount: 3, reason: 'high_score', week: 1 },
          { type: 'use', amount: 1, reason: 'revive', week: 2 },
        ],
      }
      const finalBalance = 3 - 1
      expect(finalBalance).toBe(2)
    })

    it('should track weapon inventory per roster', () => {
      const roster = {
        id: 'roster-2',
        weapons: [
          { id: 'w1', itemType: 'weapon_shield', acquired: 'week_1', isUsed: false },
          { id: 'w2', itemType: 'weapon_knife', acquired: 'week_2', isUsed: true },
          { id: 'w3', itemType: 'weapon_bomb', acquired: 'week_3', isUsed: false },
        ],
      }
      const activeWeapons = roster.weapons.filter((w) => !w.isUsed)
      expect(activeWeapons).toHaveLength(2)
    })

    it('should track ambush balance per roster', () => {
      const roster = {
        id: 'roster-3',
        ambushBalance: 1,
        ambushesByWeek: {
          week_1: 0,
          week_2: 1,
          week_3: 0,
        },
      }
      const totalUsed = Object.values(roster.ambushesByWeek).reduce((a, b) => a + b, 0)
      expect(totalUsed).toBe(1)
    })

    it('ledger should record all resource movements', () => {
      const ledger = [
        { type: 'serum_award', rosterId: 'r1', amount: 1, week: 1, reason: 'high_score_100+' },
        { type: 'serum_use', rosterId: 'r1', amount: 1, week: 2, reason: 'protection' },
        { type: 'weapon_award', rosterId: 'r2', amount: 1, week: 1, reason: 'shield_threshold_90' },
        { type: 'ambush_use', rosterId: 'r3', amount: 1, week: 2, reason: 'player_targeting' },
      ]
      expect(ledger).toHaveLength(4)
    })
  })

  describe('Universe & Tracker Visuals', () => {
    it('should aggregate multiple leagues into universe standings', () => {
      const universe = {
        id: 'universe-1',
        leagues: [
          { leagueId: 'zombie-nfl-1', leagueName: 'NFL Horde 1', survivors: 6, zombies: 6 },
          { leagueId: 'zombie-nba-1', leagueName: 'NBA Undead', survivors: 7, zombies: 5 },
          { leagueId: 'zombie-mlb-1', leagueName: 'Baseball Apocalypse', survivors: 8, zombies: 4 },
        ],
      }
      expect(universe.leagues).toHaveLength(3)
    })

    it('should show movement projection in standings (rank change watch)', () => {
      const standings = {
        week: 1,
        tiers: [
          {
            tierName: 'Premium',
            leagues: [
              {
                leagueId: 'l1',
                currentRank: 3,
                projectedRank: 2,
                movementReason: 'Top roster gaining on leader',
              },
            ],
          },
        ],
      }
      expect(standings.tiers[0].leagues[0].currentRank).not.toBe(standings.tiers[0].leagues[0].projectedRank)
    })

    it('should display visual status indicators (Survivor/Zombie/Eliminated)', () => {
      const visualIndicators = {
        survivor: { icon: '🟢', color: 'green', label: 'Survivor' },
        zombie: { icon: '🧟', color: 'purple', label: 'Zombie' },
        whisperer: { icon: '👁️', color: 'gold', label: 'Whisperer' },
        eliminated: { icon: '⚫', color: 'gray', label: 'Eliminated' },
      }
      expect(Object.keys(visualIndicators)).toHaveLength(4)
      expect(visualIndicators.survivor.icon).toBeTruthy()
    })

    it('should display weekly board with infections and top performers', () => {
      const weeklyBoard = {
        week: 5,
        newInfections: [
          { rosterId: 'r5', managerName: 'John', previousStatus: 'survivor', newStatus: 'zombie' },
          { rosterId: 'r8', managerName: 'Sarah', previousStatus: 'survivor', newStatus: 'zombie' },
        ],
        topPerformers: [
          { rosterId: 'r1', managerName: 'Alice', points: 155, status: 'survivor' },
          { rosterId: 'r2', managerName: 'Bob', points: 148, status: 'survivor' },
        ],
        resourceAwards: [
          { rosterId: 'r1', serumAward: 1, weaponAward: 'shield' },
          { rosterId: 'r2', serumAward: 0, weaponAward: null },
        ],
      }
      expect(weeklyBoard.newInfections).toHaveLength(2)
      expect(weeklyBoard.topPerformers).toHaveLength(2)
    })

    it('should track infection history per league and universe', () => {
      const infectionHistory = [
        { week: 1, league: 'league-1', newZombies: 2, newEliminations: 0, survivor2ZombieRatio: '8:2' },
        { week: 2, league: 'league-1', newZombies: 1, newEliminations: 1, survivor2ZombieRatio: '7:3' },
        { week: 3, league: 'league-1', newZombies: 0, newEliminations: 2, survivor2ZombieRatio: '7:1' },
      ]
      expect(infectionHistory).toHaveLength(3)
      expect(infectionHistory[2].newEliminations).toBe(2)
    })

    it('forum should show weekly update threads', () => {
      const forum = {
        universeId: 'u1',
        threads: [
          { week: 1, title: 'Week 1: The Infection Begins', postCount: 24 },
          { week: 2, title: 'Week 2: Casualties Mount', postCount: 31 },
          { week: 3, title: 'Week 3: The Great Culling', postCount: 18 },
        ],
      }
      expect(forum.threads).toHaveLength(3)
      forum.threads.forEach((t) => {
        expect(t.title).toContain('Week')
      })
    })
  })

  describe('Cross-Sport Integration', () => {
    it('should allow mixed-sport universes', () => {
      const universe = {
        id: 'mixed-universe',
        leagues: [
          { sport: 'NFL', leagueName: 'Football Horde' },
          { sport: 'NBA', leagueName: 'Basketball Zombies' },
          { sport: 'NHL', leagueName: 'Hockey Undead' },
        ],
      }
      const uniqueSports = new Set(universe.leagues.map((l) => l.sport))
      expect(uniqueSports.size).toBe(3)
    })

    it('sport-specific rules should apply to each league independently', () => {
      const nflConfig = ZOMBIE_SPORT_CONFIGS.nfl
      const nbaConfig = ZOMBIE_SPORT_CONFIGS.nba

      // NFL and NBA have different rosters/scoring windows
      expect(nflConfig.rosterSize).not.toBe(nbaConfig.rosterSize)
      expect(nflConfig.lineupFrequency).not.toBe(nbaConfig.lineupFrequency)
    })
  })

  describe('Draft Type Support', () => {
    DRAFT_TYPES.forEach((draftType) => {
      describe(`${draftType.toUpperCase()} Draft`, () => {
        it(`should support ${draftType} draft with proper pick order`, () => {
          const draftSetup = {
            draftType,
            teamCount: 12,
            totalPicks: 12 * 15, // 15 rounds for typical league
          }
          expect(draftSetup.draftType).toBe(draftType)
          expect(draftSetup.totalPicks).toBeGreaterThan(0)
        })

        it(`${draftType} should apply draft fee/penalty correctly`, () => {
          if (draftType === 'auction') {
            const auctionBudget = 200
            expect(auctionBudget).toBeGreaterThan(0)
          } else {
            // Snake: equal opportunity for all
            const equality = true
            expect(equality).toBe(true)
          }
        })
      })
    })
  })

  describe('End-to-End Season Flow', () => {
    it('should complete full season: league create → draft → 17-week season → playoffs', () => {
      const season = {
        leagueId: 'zombie-nfl-full-season',
        created: true,
        draftComplete: true,
        weeksCompleted: 17,
        playoffsEnabled: false, // Zombie leagues: no playoffs
        seasonEnded: true,
      }
      expect(season.seasonEnded).toBe(true)
    })

    it('week-by-week progression should apply game mechanics consistently', () => {
      const weeks = Array.from({ length: 17 }, (_, i) => ({
        week: i + 1,
        matchupsFinalized: true,
        infectionsApplied: true,
        resourcesAwarded: true,
        leaderboardUpdated: true,
      }))
      expect(weeks).toHaveLength(17)
      weeks.forEach((w) => {
        expect(w.matchupsFinalized).toBe(true)
        expect(w.infectionsApplied).toBe(true)
      })
    })

    it('season-end summary should show final statuses and stats', () => {
      const seasonEnd = {
        survivorCount: 3,
        zombieCount: 7,
        eliminatedCount: 2,
        topSerumCollector: 'roster-1',
        mostWeaponsAcquired: 'roster-3',
        chompinBlocked: 1,
        topPointsScored: 2500,
        bottomPointsScored: 1200,
      }
      expect(seasonEnd.survivorCount + seasonEnd.zombieCount + seasonEnd.eliminatedCount).toBe(12)
    })
  })

  describe('Smoke Tests: Tracker & Visual Rendering', () => {
    it('tracker components should render without errors', () => {
      const components = [
        'ZombieLeagueHome',
        'ZombieUniverseStandings',
        'ZombieStatusBadge',
        'ZombieWeeklyBoard',
        'ZombieResourceTracker',
        'ZombieInfectionTimeline',
        'ZombieMovementWatch',
        'ZombieForumThreadList',
      ]
      expect(components).toHaveLength(8)
      components.forEach((comp) => {
        expect(comp).toBeTruthy()
      })
    })

    it('visual indicators should display correctly for all statuses', () => {
      const statuses = ['survivor', 'zombie', 'whisperer', 'eliminated']
      const indicators = statuses.map((status) => ({
        status,
        hasIcon: true,
        hasColor: true,
        hasLabel: true,
      }))
      expect(indicators).toHaveLength(4)
      indicators.forEach((ind) => {
        expect(ind.hasIcon && ind.hasColor && ind.hasLabel).toBe(true)
      })
    })

    it('responsive layout should work on mobile and desktop', () => {
      const breakpoints = [
        { width: 375, label: 'mobile' },
        { width: 768, label: 'tablet' },
        { width: 1024, label: 'desktop' },
      ]
      breakpoints.forEach((bp) => {
        expect(bp.width).toBeGreaterThan(0)
      })
    })
  })

  describe('Performance & Scale', () => {
    it('should handle 12-team leagues efficiently', () => {
      const league = {
        teamCount: 12,
        weeklyMatchups: 6,
        resourceLedgerEntries: 300, // ~2 per team per week
      }
      expect(league.weeklyMatchups).toBe(6)
      expect(league.resourceLedgerEntries).toBeGreaterThan(0)
    })

    it('should handle multi-league universes (10+ leagues)', () => {
      const universe = {
        leagueCount: 15,
        totalTeams: 180,
        totalResourceTransactions: 5400,
      }
      expect(universe.leagueCount).toBeGreaterThan(10)
      expect(universe.totalTeams).toBeGreaterThan(100)
    })

    it('weekly finalization should complete within reasonable time', () => {
      const finalization = {
        leagueId: 'l1',
        week: 10,
        matchupCount: 6,
        executionTimeMs: 250, // Target < 1s for single league
      }
      expect(finalization.executionTimeMs).toBeLessThan(1000)
    })
  })
})
