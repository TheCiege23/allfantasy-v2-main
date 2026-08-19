/**
 * Cross-League Player Intelligence — REAL physical-database validation.
 *
 * Creates REAL rows in a REAL disposable Neon branch via Prisma, calls the REAL
 * `assembleCrossLeaguePlayerPortfolio` / `getChimmyCrossLeaguePlayerSummary` /
 * `getChimmyPlayerLookup` coordinators against that data, and reports what they
 * actually returned. NOT a mock/fixture-only exercise — no stubbed data, no
 * fabricated results.
 *
 * STRICTLY: refuses to run against the production host. Every unique value
 * created this run carries a randomized hex suffix so it never collides with
 * the ~20+ leftover fixture rows already on this shared non-prod branch.
 * Cleans up every row it created (and ONLY those rows) in a try/finally, even
 * on a mid-script failure.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/cross-league-player-physical-validation.ts
 *
 * (If bare `npx tsx` throws the `server-only` "cannot be imported from a
 * Client Component module" error, run via the repo's existing preload shim:
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/cross-league-player-physical-validation.ts )
 */
import crypto from 'node:crypto'
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'

const PROD_HOST_MARKER = 'ep-spring-tooth'

let failures = 0
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

// ── Capture ALL stdout for the secret-leak grep (step 4e) ──────────────────
const capturedLines: string[] = []
const origLog = console.log
console.log = (...args: unknown[]) => {
  capturedLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  origLog(...(args as []))
}

;(async () => {
  if (!hasDatabaseUrl()) {
    origLog('CROSS_LEAGUE_VALIDATION SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    origLog(`CROSS_LEAGUE_VALIDATION REFUSED — resolved host looks like PRODUCTION (${host}). Aborting.`)
    process.exit(0)
  }
  console.log(`Cross-League Player Intelligence physical validation — DB host: ${host}`)

  // Safety check passed — NOW it's safe to import repo modules.
  const { prisma } = await import('../lib/prisma')
  const { assembleCrossLeaguePlayerPortfolio, getChimmyCrossLeaguePlayerSummary, getChimmyPlayerLookup } = await import(
    '../lib/shared-services/league-hub/crossLeaguePlayerPortfolio'
  )

  const hex = crypto.randomBytes(4).toString('hex')
  console.log(`Fixture suffix: ${hex}`)

  const season = new Date().getFullYear()
  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

  // Captured ids for FK-safe cleanup.
  const createdIds = {
    playerIdentityMapIds: [] as string[],
    sportsPlayerIds: [] as string[],
    scheduleGameIds: [] as string[],
    rosterIds: [] as string[],
    leagueTeamIds: [] as string[],
    leagueIds: [] as string[],
    userProfileUserIds: [] as string[],
    appUserIds: [] as string[],
  }

  const starPlayerId = `sleeper-999${hex}`
  const starPlayerEspnId = `espn-777${hex}`
  const injuredPlayerId = `sleeper-888${hex}`
  const userBPlayerId = `sleeper-666${hex}`

  let starCanonicalId: string | null = null

  try {
    // ── AppUsers ───────────────────────────────────────────────────────────
    const userA = await prisma.appUser.create({
      data: { email: `crossleague-a-${hex}@test.allfantasy.local`, username: `xleague_a_${hex}` },
    })
    createdIds.appUserIds.push(userA.id)
    const userB = await prisma.appUser.create({
      data: { email: `crossleague-b-${hex}@test.allfantasy.local`, username: `xleague_b_${hex}` },
    })
    createdIds.appUserIds.push(userB.id)
    console.log(`Created userA=${userA.id} userB=${userB.id}`)

    const sleeperUserId = `900001234${hex}`
    await prisma.userProfile.create({ data: { userId: userA.id, sleeperUserId } })
    createdIds.userProfileUserIds.push(userA.id)

    // ── League A: sleeper, fresh sync, STARTER ──────────────────────────────
    const leagueA = await prisma.league.create({
      data: {
        userId: userA.id,
        platform: 'sleeper',
        platformLeagueId: `sleeperA-${hex}`,
        name: `XLeague Sleeper A ${hex}`,
        sport: 'NFL',
        season,
        lastSyncedAt: now,
        syncStatus: 'success',
      },
    })
    createdIds.leagueIds.push(leagueA.id)
    const rosterA = await prisma.roster.create({
      data: {
        leagueId: leagueA.id,
        platformUserId: sleeperUserId,
        playerData: {
          lineup_sections: {
            starters: [{ id: starPlayerId, name: 'Test Star Player', position: 'RB', team: 'BUF' }],
            bench: [],
            ir: [],
            taxi: [],
            devy: [],
          },
        },
      },
    })
    createdIds.rosterIds.push(rosterA.id)
    const teamA = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueA.id,
        externalId: `teamA-${hex}`,
        ownerName: 'Test User A',
        teamName: `A Squad ${hex}`,
        platformUserId: sleeperUserId,
        wins: 7,
        losses: 3,
        currentRank: 2,
      },
    })
    createdIds.leagueTeamIds.push(teamA.id)

    // ── League B: espn, fresh sync, BENCH — dedup test case ─────────────────
    const leagueB = await prisma.league.create({
      data: {
        userId: userA.id,
        platform: 'espn',
        platformLeagueId: `espnB-${hex}`,
        name: `XLeague ESPN B ${hex}`,
        sport: 'NFL',
        season,
        lastSyncedAt: now,
        syncStatus: 'success',
      },
    })
    createdIds.leagueIds.push(leagueB.id)
    const rosterB = await prisma.roster.create({
      data: {
        leagueId: leagueB.id,
        platformUserId: userA.id,
        playerData: {
          lineup_sections: {
            starters: [],
            bench: [{ id: starPlayerEspnId, name: 'Test Star Player', position: 'RB', team: 'BUF' }],
            ir: [],
            taxi: [],
            devy: [],
          },
        },
      },
    })
    createdIds.rosterIds.push(rosterB.id)
    const teamB = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueB.id,
        externalId: `teamB-${hex}`,
        ownerName: 'Test User A',
        teamName: `B Squad ${hex}`,
        platformUserId: userA.id,
        wins: 4,
        losses: 6,
        currentRank: 8,
      },
    })
    createdIds.leagueTeamIds.push(teamB.id)

    // Real PlayerIdentityMap row linking BOTH provider ids to one canonical player.
    const identityMap = await prisma.playerIdentityMap.create({
      data: {
        canonicalName: 'Test Star Player',
        normalizedName: 'teststarplayer',
        position: 'RB',
        currentTeam: 'BUF',
        sport: 'NFL',
        sleeperId: starPlayerId,
        espnId: starPlayerEspnId,
      },
    })
    createdIds.playerIdentityMapIds.push(identityMap.id)
    starCanonicalId = identityMap.id
    console.log(`Real canonical PlayerIdentityMap id for "Test Star Player": ${starCanonicalId}`)

    // ── League C: sleeper, STALE sync, IR — injury + stale-freshness test ──
    const leagueC = await prisma.league.create({
      data: {
        userId: userA.id,
        platform: 'sleeper',
        platformLeagueId: `sleeperC-${hex}`,
        name: `XLeague Sleeper C ${hex}`,
        sport: 'NFL',
        season,
        lastSyncedAt: threeDaysAgo,
        syncStatus: 'success',
      },
    })
    createdIds.leagueIds.push(leagueC.id)
    const rosterC = await prisma.roster.create({
      data: {
        leagueId: leagueC.id,
        platformUserId: sleeperUserId,
        playerData: {
          lineup_sections: {
            starters: [],
            bench: [],
            ir: [{ id: injuredPlayerId, name: 'Test Injured Player', position: 'WR', team: 'MIA' }],
            taxi: [],
            devy: [],
          },
        },
      },
    })
    createdIds.rosterIds.push(rosterC.id)
    const teamC = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueC.id,
        externalId: `teamC-${hex}`,
        ownerName: 'Test User A',
        teamName: `C Squad ${hex}`,
        platformUserId: sleeperUserId,
        wins: 5,
        losses: 5,
        currentRank: 6,
      },
    })
    createdIds.leagueTeamIds.push(teamC.id)

    // Real SportsPlayer row — injury enrichment proof.
    const sportsPlayer = await prisma.sportsPlayer.create({
      data: {
        sport: 'NFL',
        externalId: injuredPlayerId,
        sleeperId: injuredPlayerId,
        name: 'Test Injured Player',
        position: 'WR',
        team: 'MIA',
        status: 'IR',
        source: 'xleague_fixture_test',
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    })
    createdIds.sportsPlayerIds.push(sportsPlayer.id)

    // ── Real FantasyScheduleGame rows for BUF — bye-week derivation proof ──
    // resolveScheduleContext derives a bye week ONLY when exactly one week in
    // [minWeek,maxWeek] is present season-wide but absent from the team's own
    // rows. BUF plays every week 1-17 except week 7; a separate MIA@NYJ game
    // in week 7 (not involving BUF) puts week 7 into the season-wide week set
    // so it is detectable as BUF's single, real gap.
    const opponents = ['MIA', 'NYJ', 'NE', 'KC', 'DEN', 'LAC', 'CIN', 'BAL', 'PIT', 'CLE', 'HOU', 'IND', 'JAX', 'TEN', 'LV', 'LAR']
    const byeWeek = 7
    let oppIdx = 0
    for (let week = 1; week <= 17; week++) {
      if (week === byeWeek) {
        // Unrelated game (no BUF) so this week exists in the season-wide schedule.
        const row = await prisma.fantasyScheduleGame.create({
          data: {
            sport: 'NFL',
            season: String(season),
            week,
            homeTeam: 'MIA',
            awayTeam: 'NYJ',
            kickoffTime: new Date(now.getTime() + week * 7 * 24 * 60 * 60 * 1000),
            status: 'scheduled',
            providerGameId: `xleague-${hex}-wk${week}-noBUF`,
            source: 'xleague_fixture_test',
            fetchedAt: now,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        })
        createdIds.scheduleGameIds.push(row.id)
        continue
      }
      const opp = opponents[oppIdx % opponents.length]
      oppIdx++
      const homeIsBuf = week % 2 === 0
      const row = await prisma.fantasyScheduleGame.create({
        data: {
          sport: 'NFL',
          season: String(season),
          week,
          homeTeam: homeIsBuf ? 'BUF' : opp,
          awayTeam: homeIsBuf ? opp : 'BUF',
          kickoffTime: new Date(now.getTime() + week * 7 * 24 * 60 * 60 * 1000),
          status: 'scheduled',
          providerGameId: `xleague-${hex}-wk${week}`,
          source: 'xleague_fixture_test',
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      })
      createdIds.scheduleGameIds.push(row.id)
    }
    console.log(`Created ${createdIds.scheduleGameIds.length} FantasyScheduleGame rows (BUF bye intended = week ${byeWeek})`)

    // ── League D: userB, separate + unrelated — cross-user isolation proof ─
    const leagueD = await prisma.league.create({
      data: {
        userId: userB.id,
        platform: 'sleeper',
        platformLeagueId: `sleeperD-${hex}`,
        name: `XLeague B-Only D ${hex}`,
        sport: 'NFL',
        season,
        lastSyncedAt: now,
        syncStatus: 'success',
      },
    })
    createdIds.leagueIds.push(leagueD.id)
    const rosterD = await prisma.roster.create({
      data: {
        leagueId: leagueD.id,
        platformUserId: userB.id,
        playerData: {
          lineup_sections: {
            starters: [{ id: userBPlayerId, name: 'Test B Player', position: 'QB', team: 'DAL' }],
            bench: [],
            ir: [],
            taxi: [],
            devy: [],
          },
        },
      },
    })
    createdIds.rosterIds.push(rosterD.id)
    const teamD = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueD.id,
        externalId: `teamD-${hex}`,
        ownerName: 'Test User B',
        teamName: `D Squad ${hex}`,
        platformUserId: userB.id,
        wins: 9,
        losses: 1,
        currentRank: 1,
      },
    })
    createdIds.leagueTeamIds.push(teamD.id)

    console.log('Fixtures created. Running REAL coordinator calls...\n')

    // ── 4a. userA portfolio ──────────────────────────────────────────────
    const resultA = await assembleCrossLeaguePlayerPortfolio({ appUserId: userA.id })
    console.log('=== assembleCrossLeaguePlayerPortfolio(userA) — FULL RESULT ===')
    console.log(JSON.stringify(resultA, null, 2))

    check('userA connectedLeagueCount === 3', resultA.connectedLeagueCount === 3, `got ${resultA.connectedLeagueCount}`)

    const starItems = resultA.items.filter((i) => i.displayName === 'Test Star Player')
    check('exactly ONE item for "Test Star Player" (dedup across sleeper+espn ids)', starItems.length === 1, `got ${starItems.length} item(s)`)
    const starItem = starItems[0]
    if (starItem) {
      check('"Test Star Player" identityConfidence === verified', starItem.identityConfidence === 'verified', `got ${starItem.identityConfidence}`)
      check('canonicalPlayerId matches the real PlayerIdentityMap row id', starItem.canonicalPlayerId === starCanonicalId, `item=${starItem.canonicalPlayerId} map=${starCanonicalId}`)
      check('exposure.leagueCount === 2', starItem.exposure.leagueCount === 2, `got ${starItem.exposure.leagueCount}`)
      check('leagueAppearances.length === 2', starItem.leagueAppearances.length === 2, `got ${starItem.leagueAppearances.length}`)
      const starterApp = starItem.leagueAppearances.find((a) => a.canonicalLeagueId === leagueA.id)
      const benchApp = starItem.leagueAppearances.find((a) => a.canonicalLeagueId === leagueB.id)
      check('League A appearance rosterStatus === starter', starterApp?.rosterStatus === 'starter', `got ${starterApp?.rosterStatus}`)
      check('League B appearance rosterStatus === bench', benchApp?.rosterStatus === 'bench', `got ${benchApp?.rosterStatus}`)
      check(
        'bye week real + non-null (Test Star Player, team BUF)',
        starItem.schedule?.byeWeek != null,
        starItem.schedule ? `byeWeek=${starItem.schedule.byeWeek}` : 'schedule=null'
      )
    } else {
      check('"Test Star Player" identityConfidence === verified', false, 'no item found')
      check('exposure.leagueCount === 2', false, 'no item found')
      check('leagueAppearances.length === 2', false, 'no item found')
      check('League A appearance rosterStatus === starter', false, 'no item found')
      check('League B appearance rosterStatus === bench', false, 'no item found')
      check('bye week real + non-null (Test Star Player, team BUF)', false, 'no item found')
    }

    const injuredItem = resultA.items.find((i) => i.displayName === 'Test Injured Player')
    check('"Test Injured Player" item found', Boolean(injuredItem))
    if (injuredItem) {
      console.log(`Real injury object for "Test Injured Player": ${JSON.stringify(injuredItem.injury)}`)
      check(
        'injury reflects the real SportsPlayer.status="IR" row (via deriveAvailabilityCategory + AVAILABILITY_TO_INJURY_STATUS)',
        injuredItem.injury != null && injuredItem.injury.status !== 'unknown',
        `real mapped injury.status=${injuredItem.injury?.status ?? 'null'} (see report: 'IR' maps to 'out', never to the type's unreachable 'ir' value)`
      )
      const irApp = injuredItem.leagueAppearances.find((a) => a.canonicalLeagueId === leagueC.id)
      check('"Test Injured Player" leagueAppearances[0].rosterStatus === ir', irApp?.rosterStatus === 'ir', `got ${irApp?.rosterStatus}`)
      check('League C (stale sync) appearance syncFreshness.state === stale', irApp?.syncFreshness.state === 'stale', `got ${irApp?.syncFreshness.state}`)
    } else {
      check('injury reflects the real SportsPlayer.status="IR" row', false, 'no item found')
      check('"Test Injured Player" leagueAppearances[0].rosterStatus === ir', false, 'no item found')
      check('League C (stale sync) appearance syncFreshness.state === stale', false, 'no item found')
    }

    // ── 4b. userB portfolio — cross-user isolation proof ────────────────
    const resultB = await assembleCrossLeaguePlayerPortfolio({ appUserId: userB.id })
    console.log('\n=== assembleCrossLeaguePlayerPortfolio(userB) — FULL RESULT ===')
    console.log(JSON.stringify(resultB, null, 2))
    check('userB connectedLeagueCount === 1', resultB.connectedLeagueCount === 1, `got ${resultB.connectedLeagueCount}`)
    check('userB items contains ONLY "Test B Player"', resultB.items.length === 1 && resultB.items[0]?.displayName === 'Test B Player', `got ${resultB.items.map((i) => i.displayName).join(', ')}`)

    const resultBJson = JSON.stringify(resultB)
    const userALeakMarkers = [leagueA.name, leagueB.name, leagueC.name, 'Test Star Player', 'Test Injured Player', leagueA.id, leagueB.id, leagueC.id]
    const leaks = userALeakMarkers.filter((m) => m && resultBJson.includes(m))
    check('userB portfolio contains ZERO trace of userA data (leagues/players/ids)', leaks.length === 0, leaks.length ? `LEAKED: ${leaks.join(', ')}` : 'clean')

    // ── 4c. Chimmy summary ────────────────────────────────────────────────
    const chimmySummary = await getChimmyCrossLeaguePlayerSummary({ appUserId: userA.id })
    console.log('\n=== getChimmyCrossLeaguePlayerSummary(userA) — FULL RESULT ===')
    console.log(JSON.stringify(chimmySummary, null, 2))
    check(
      'Chimmy summary injuredPlayers includes "Test Injured Player"',
      chimmySummary.injuredPlayers.some((p) => p.displayName === 'Test Injured Player'),
      `injuredPlayers=${chimmySummary.injuredPlayers.map((p) => p.displayName).join(', ')}`
    )
    check('Chimmy summary has NO "items" key (narrower than full portfolio)', !('items' in (chimmySummary as Record<string, unknown>)))

    // ── 4d. Cross-user player-id probing rejection ──────────────────────
    let chimmyLookupB: unknown = 'NOT_RUN'
    if (starCanonicalId) {
      chimmyLookupB = await getChimmyPlayerLookup({ appUserId: userB.id, canonicalPlayerId: starCanonicalId })
    }
    console.log(`\ngetChimmyPlayerLookup(userB, userA's star-player canonicalPlayerId) => ${JSON.stringify(chimmyLookupB)}`)
    check('cross-user player-id probing via Chimmy lookup returns null', chimmyLookupB === null, `got ${JSON.stringify(chimmyLookupB)}`)

    // ── 4e. Secret-leak grep over full captured stdout ──────────────────
    const secretPattern = /token|secret|bearer|oauth|password/i
    const leakLines = capturedLines.filter((l) => secretPattern.test(l))
    check('no secrets (token/secret/Bearer/oauth/password) leaked in output', leakLines.length === 0, leakLines.length ? `${leakLines.length} suspicious line(s)` : 'clean')
  } finally {
    // ── Cleanup — FK-safe order, ONLY ids captured this run ──────────────
    console.log('\nCleaning up fixtures...')
    try {
      if (createdIds.playerIdentityMapIds.length) await prisma.playerIdentityMap.deleteMany({ where: { id: { in: createdIds.playerIdentityMapIds } } })
      if (createdIds.sportsPlayerIds.length) await prisma.sportsPlayer.deleteMany({ where: { id: { in: createdIds.sportsPlayerIds } } })
      if (createdIds.scheduleGameIds.length) await prisma.fantasyScheduleGame.deleteMany({ where: { id: { in: createdIds.scheduleGameIds } } })
      if (createdIds.rosterIds.length) await prisma.roster.deleteMany({ where: { id: { in: createdIds.rosterIds } } })
      if (createdIds.leagueTeamIds.length) await prisma.leagueTeam.deleteMany({ where: { id: { in: createdIds.leagueTeamIds } } })
      if (createdIds.leagueIds.length) await prisma.league.deleteMany({ where: { id: { in: createdIds.leagueIds } } })
      if (createdIds.userProfileUserIds.length) await prisma.userProfile.deleteMany({ where: { userId: { in: createdIds.userProfileUserIds } } })
      if (createdIds.appUserIds.length) await prisma.appUser.deleteMany({ where: { id: { in: createdIds.appUserIds } } })
      console.log('CLEANUP: done')
    } catch (cleanupErr) {
      console.error('CLEANUP FAILED — manual cleanup may be required for ids:', JSON.stringify(createdIds))
      console.error(cleanupErr instanceof Error ? cleanupErr.stack : cleanupErr)
      failures++
    }
    await prisma.$disconnect().catch(() => undefined)
  }

  console.log('\n=== FINAL PASS/FAIL SUMMARY ===')
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }
  console.log(`\nReal canonical id "Test Star Player" resolved to: ${starCanonicalId}`)
  console.log(failures === 0 ? 'CROSS_LEAGUE_VALIDATION_OK' : `CROSS_LEAGUE_VALIDATION_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
