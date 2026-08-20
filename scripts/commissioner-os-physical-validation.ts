/**
 * Commissioner OS — REAL physical-database validation (Commissioner OS League-Specific Intelligence
 * Wiring phase, verification pass).
 *
 * Creates REAL fixture rows (AppUser/League/LeagueTeam/LeagueSeason/RivalryRecord/RivalryEvent/
 * DramaEvent/DraftGrade) in a disposable, non-production Neon branch via Prisma, then calls the REAL
 * production coordinator functions (`assembleCommissionerOsContext`, `assembleCommissionerOsRecommendations`,
 * `getChimmyCommissionerOsSummary`) against that data and prints exactly what they return. Nothing here
 * is mocked or fabricated — only what the real functions actually returned is reported.
 *
 * STRICTLY follows the safety pattern in `scripts/decision-os-commissioner-conformance.ts`: refuses to run
 * without DATABASE_URL, refuses the production host marker, and only imports Prisma/repo modules AFTER
 * that check passes.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/commissioner-os-physical-validation.ts
 *
 * Cleans up every row it creates (and only those rows) in a final try/finally, regardless of outcome.
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import { assertNonProductionDbTarget, describeDbTarget } from './_db-target-identity'



// ── Captured stdout (for the final secret-leak grep) ───────────────────────────────────────────
const capturedLines: string[] = []
const origLog = console.log
function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  capturedLines.push(line)
  origLog(...(args as []))
}

let failures = 0
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

;(async () => {
  if (!hasDatabaseUrl()) {
    origLog('COMMISSIONER_OS_PHYSICAL_VALIDATION SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run.')
    process.exit(0)
  }
  const dbTargetUrl = resolveDatabaseUrl()
  const host = describeDbTarget(dbTargetUrl)
  assertNonProductionDbTarget({
    script: 'commissioner-os-physical-validation',
    url: dbTargetUrl,
    action: 'runs physical-validation queries',
    exitCode: 0,
  })
  log(`Commissioner OS physical validation — DB host: ${host}`)

  const { prisma } = await import('../lib/prisma')
  const { assembleCommissionerOsContext } = await import('../lib/shared-services/league-hub/commissionerOsContext')
  const { assembleCommissionerOsRecommendations, getChimmyCommissionerOsSummary } = await import(
    '../lib/shared-services/league-hub/commissionerOsRecommendations'
  )

  const crypto = await import('node:crypto')
  const runId = crypto.randomBytes(4).toString('hex')
  log(`Run id: ${runId}`)

  // Track every id we create, for FK-safe cleanup at the end.
  const created = {
    rivalryEventIds: [] as string[],
    rivalryRecordIds: [] as string[],
    dramaEventIds: [] as string[],
    draftGradeIds: [] as string[],
    leagueSeasonIds: [] as string[],
    leagueTeamIds: [] as string[],
    leagueIds: [] as string[],
    appUserIds: [] as string[],
  }

  const CURRENT_SEASON = 2026
  const PRIOR_SEASON = 2025

  try {
    // ── AppUsers ───────────────────────────────────────────────────────────────────────────────
    const commissionerUser = await prisma.appUser.create({
      data: {
        email: `commissioner.${runId}@osfixture.test`,
        username: `commissioner_${runId}`,
        displayName: `Commissioner Fixture ${runId}`,
      },
    })
    created.appUserIds.push(commissionerUser.id)

    const normalManagerUser = await prisma.appUser.create({
      data: {
        email: `manager.${runId}@osfixture.test`,
        username: `manager_${runId}`,
        displayName: `Normal Manager Fixture ${runId}`,
      },
    })
    created.appUserIds.push(normalManagerUser.id)

    log(`Created AppUsers: commissioner=${commissionerUser.id} normalManager=${normalManagerUser.id}`)

    // ── League A — Healthy League (ESPN, attestation commissioner) ───────────────────────────────
    const leagueA = await prisma.league.create({
      data: {
        userId: commissionerUser.id,
        platform: 'espn',
        platformLeagueId: `espn-${runId}-a`,
        name: `Healthy League ${runId}`,
        sport: 'NFL',
        season: CURRENT_SEASON,
        isDynasty: false,
        lastSyncedAt: new Date(),
        syncStatus: 'success',
        settings: {
          commissionerVerification: { method: 'attestation', appUserId: commissionerUser.id },
        },
      },
    })
    created.leagueIds.push(leagueA.id)

    const teamA1 = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueA.id,
        externalId: `${runId}-teamA1`,
        ownerName: 'Commish Manager',
        teamName: 'Dynasty Destroyers',
        claimedByUserId: commissionerUser.id,
        isCommissioner: true,
      },
    })
    created.leagueTeamIds.push(teamA1.id)

    const teamA2 = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueA.id,
        externalId: `${runId}-teamA2`,
        ownerName: 'Normal Manager',
        teamName: 'Rival Raiders',
        claimedByUserId: normalManagerUser.id,
        isCommissioner: false,
      },
    })
    created.leagueTeamIds.push(teamA2.id)

    const seasonA = await prisma.leagueSeason.create({
      data: {
        leagueId: leagueA.id,
        season: PRIOR_SEASON,
        platformLeagueId: `espn-${runId}-a-${PRIOR_SEASON}`,
        championTeamId: teamA1.id,
        championName: 'Dynasty Destroyers',
        runnerUpName: 'Rival Raiders',
      },
    })
    created.leagueSeasonIds.push(seasonA.id)

    const rivalryA = await prisma.rivalryRecord.create({
      data: {
        leagueId: leagueA.id,
        sport: 'NFL',
        managerAId: commissionerUser.id,
        managerBId: normalManagerUser.id,
        rivalryScore: 72,
        rivalryTier: 'Blood Feud',
      },
    })
    created.rivalryRecordIds.push(rivalryA.id)

    const rivalryEventDefs = [
      { eventType: 'h2h_matchup', season: PRIOR_SEASON - 1, description: 'Regular season nail-biter.' },
      { eventType: 'playoff_matchup', season: PRIOR_SEASON, description: 'Playoff semifinal rematch.' },
      { eventType: 'upset_win', season: PRIOR_SEASON, description: 'Underdog upset in week 12.' },
    ]
    for (const ev of rivalryEventDefs) {
      const row = await prisma.rivalryEvent.create({
        data: { rivalryId: rivalryA.id, eventType: ev.eventType, season: ev.season, description: ev.description },
      })
      created.rivalryEventIds.push(row.id)
    }

    const dramaDefs = [
      {
        dramaType: 'trade_shocker',
        headline: 'Blockbuster trade rocks the league',
        summary: 'A stunning multi-player trade shifts the balance of power.',
        dramaScore: 85,
        relatedManagerIds: [commissionerUser.id, normalManagerUser.id],
        relatedTeamIds: [teamA1.id, teamA2.id],
      },
      {
        dramaType: 'upset',
        headline: 'Underdog pulls off stunning upset',
        summary: 'Rival Raiders topple the league leader in a shocking result.',
        dramaScore: 55,
        relatedManagerIds: [normalManagerUser.id],
        relatedTeamIds: [teamA2.id],
      },
      {
        dramaType: 'streak',
        headline: 'Dynasty Destroyers extend win streak to five',
        summary: 'A dominant stretch run puts the league on notice.',
        dramaScore: 40,
        relatedManagerIds: [commissionerUser.id],
        relatedTeamIds: [teamA1.id],
      },
    ]
    for (const d of dramaDefs) {
      const row = await prisma.dramaEvent.create({
        data: {
          leagueId: leagueA.id,
          sport: 'NFL',
          season: CURRENT_SEASON,
          dramaType: d.dramaType,
          headline: d.headline,
          summary: d.summary,
          relatedManagerIds: d.relatedManagerIds,
          relatedTeamIds: d.relatedTeamIds,
          dramaScore: d.dramaScore,
        },
      })
      created.dramaEventIds.push(row.id)
    }

    const draftGradeDefs = [
      { rosterId: teamA1.id, grade: 'A', score: 92.5 },
      { rosterId: teamA2.id, grade: 'C', score: 65.0 },
    ]
    for (const g of draftGradeDefs) {
      const row = await prisma.draftGrade.create({
        data: {
          leagueId: leagueA.id,
          season: String(CURRENT_SEASON),
          rosterId: g.rosterId,
          grade: g.grade,
          score: g.score,
          breakdown: { note: 'fixture-generated for physical validation', runId },
        },
      })
      created.draftGradeIds.push(row.id)
    }

    log(`League A (Healthy, ESPN) created: ${leagueA.id}`)

    // ── League B — Low-Activity / Stale League (MFL) ──────────────────────────────────────────────
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const leagueB = await prisma.league.create({
      data: {
        userId: commissionerUser.id,
        platform: 'mfl',
        platformLeagueId: `mfl-${runId}-b`,
        name: `Stale League ${runId}`,
        sport: 'NFL',
        season: CURRENT_SEASON,
        isDynasty: false,
        lastSyncedAt: threeDaysAgo,
        syncStatus: 'success',
        settings: {
          commissionerVerification: { method: 'attestation', appUserId: commissionerUser.id },
        },
      },
    })
    created.leagueIds.push(leagueB.id)

    const teamB1 = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueB.id,
        externalId: `${runId}-teamB1`,
        ownerName: 'Commish Manager',
        teamName: 'Stale Squad',
        claimedByUserId: commissionerUser.id,
        isCommissioner: true,
      },
    })
    created.leagueTeamIds.push(teamB1.id)

    const teamB2 = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueB.id,
        externalId: `${runId}-teamB2`,
        ownerName: 'Normal Manager',
        teamName: 'Ghost Town',
        claimedByUserId: normalManagerUser.id,
        isCommissioner: false,
      },
    })
    created.leagueTeamIds.push(teamB2.id)

    log(`League B (Stale, MFL) created: ${leagueB.id} — no rivalry/drama/draft rows (deliberate)`)

    // ── League C — Snapshot-Only League (Fantrax) ────────────────────────────────────────────────
    const leagueC = await prisma.league.create({
      data: {
        userId: commissionerUser.id,
        platform: 'fantrax',
        platformLeagueId: `fantrax-${runId}-c`,
        name: `Snapshot League ${runId}`,
        sport: 'NFL',
        season: CURRENT_SEASON,
        isDynasty: false,
        lastSyncedAt: new Date(),
        syncStatus: 'success',
        settings: {
          commissionerVerification: { method: 'attestation', appUserId: commissionerUser.id },
        },
      },
    })
    created.leagueIds.push(leagueC.id)

    const teamC1 = await prisma.leagueTeam.create({
      data: {
        leagueId: leagueC.id,
        externalId: `${runId}-teamC1`,
        ownerName: 'Commish Manager',
        teamName: 'Snapshot Squad',
        claimedByUserId: commissionerUser.id,
        isCommissioner: true,
      },
    })
    created.leagueTeamIds.push(teamC1.id)

    log(`League C (Snapshot-only, Fantrax) created: ${leagueC.id}`)

    // ── REAL calls ─────────────────────────────────────────────────────────────────────────────
    log('\n========== (a) League A — assembleCommissionerOsRecommendations (commissioner) ==========')
    const resA = await assembleCommissionerOsRecommendations({ appUserId: commissionerUser.id, canonicalLeagueId: leagueA.id })
    log(JSON.stringify(resA, null, 2))
    check('League A: accessDenied === false', resA.accessDenied === false)
    check('League A: domainStatus present', Object.keys(resA.domainStatus).length > 0, JSON.stringify(resA.domainStatus))
    for (const rec of resA.bundle.commissioner) {
      log(
        `  [A] domain=${rec.domain} type=${rec.type} title="${rec.title}" priority=${rec.priority} governanceSeverity=${rec.governanceSeverity ?? 'n/a'} sourceHistoryConfidence=${rec.sourceHistoryConfidence ?? 'n/a'} hasCopyReadyContent=${Boolean(rec.copyReadyContent && rec.copyReadyContent.length > 0)}`
      )
    }
    check('League A: rivalries domain ok (has real history)', resA.domainStatus.rivalries === 'ok', String(resA.domainStatus.rivalries))
    check('League A: draft domain ok (has real DraftGrade rows)', resA.domainStatus.draft === 'ok', String(resA.domainStatus.draft))
    const rivalryRec = resA.bundle.commissioner.find((r) => r.type === 'rivalry_spotlight')
    check(
      'League A: rivalry recommendation sourceHistoryConfidence === complete (3+ events)',
      rivalryRec?.sourceHistoryConfidence === 'complete',
      `got=${rivalryRec?.sourceHistoryConfidence}`
    )
    const storylineRecs = resA.bundle.commissioner.filter((r) => r.type.startsWith('storyline_'))
    check('League A: storyline recommendations from real DramaEvent rows', storylineRecs.length > 0, `count=${storylineRecs.length}`)

    log('\n========== (b) League B — assembleCommissionerOsRecommendations (commissioner) ==========')
    const resB = await assembleCommissionerOsRecommendations({ appUserId: commissionerUser.id, canonicalLeagueId: leagueB.id })
    log(JSON.stringify(resB, null, 2))
    check('League B: accessDenied === false', resB.accessDenied === false)
    for (const rec of resB.bundle.commissioner) {
      log(
        `  [B] domain=${rec.domain} type=${rec.type} title="${rec.title}" priority=${rec.priority} governanceSeverity=${rec.governanceSeverity ?? 'n/a'} sourceHistoryConfidence=${rec.sourceHistoryConfidence ?? 'n/a'} hasCopyReadyContent=${Boolean(rec.copyReadyContent && rec.copyReadyContent.length > 0)}`
      )
    }
    check('League B: rivalries domain unsupported (no RivalryRecord rows)', resB.domainStatus.rivalries === 'unsupported', String(resB.domainStatus.rivalries))
    check('League B: draft domain unsupported (no DraftGrade rows)', resB.domainStatus.draft === 'unsupported', String(resB.domainStatus.draft))
    check('League B: storylines domain unsupported (no DramaEvent rows)', resB.domainStatus.storylines === 'unsupported', String(resB.domainStatus.storylines))
    const bCriticalHigh = resB.bundle.commissioner.filter((r) => r.priority === 'critical' || r.priority === 'high')
    check('League B: no critical/high items survive stale-suppression', bCriticalHigh.length === 0, `count=${bCriticalHigh.length}`)

    log('\n========== (c) League C — assembleCommissionerOsContext (commissioner) ==========')
    const ctxC = await assembleCommissionerOsContext({ appUserId: commissionerUser.id, canonicalLeagueId: leagueC.id })
    log(JSON.stringify(ctxC, null, 2))
    check('League C: context resolved (non-null)', ctxC !== null)
    check('League C: isSnapshotOnly === true (Fantrax)', ctxC?.isSnapshotOnly === true, `got=${ctxC?.isSnapshotOnly}`)
    const resC = await assembleCommissionerOsRecommendations({ appUserId: commissionerUser.id, canonicalLeagueId: leagueC.id })
    log(JSON.stringify(resC, null, 2))
    const integrityRecsC = resC.bundle.commissioner.filter((r) => r.domain === 'commissioner' && r.type === 'integrity_review_recommended')
    check('League C: integrity domain empty (snapshot-only suppression)', integrityRecsC.length === 0, `count=${integrityRecsC.length}`)

    log('\n========== (d) League A — normal manager (MUST be denied) ==========')
    const resDenied = await assembleCommissionerOsRecommendations({ appUserId: normalManagerUser.id, canonicalLeagueId: leagueA.id })
    log(JSON.stringify(resDenied, null, 2))
    check('(d) normal manager DENIED on League A', resDenied.accessDenied === true, `accessDenied=${resDenied.accessDenied}`)

    log('\n========== (e) Nonexistent league — normal manager (MUST also be denied identically) ==========')
    const resNonexistent = await assembleCommissionerOsRecommendations({
      appUserId: normalManagerUser.id,
      canonicalLeagueId: 'nonexistent-league-id-xyz',
    })
    log(JSON.stringify(resNonexistent, null, 2))
    check('(e) nonexistent league DENIED identically', resNonexistent.accessDenied === true, `accessDenied=${resNonexistent.accessDenied}`)
    check(
      '(e) denial shape identical to (d) (no existence leak)',
      JSON.stringify({ ...resNonexistent, generatedAt: null }) === JSON.stringify({ ...resDenied, generatedAt: null }),
      'compared bundle+domainStatus+accessDenied ignoring generatedAt'
    )

    log('\n========== (f) getChimmyCommissionerOsSummary — League A, commissioner ==========')
    const chimmy = await getChimmyCommissionerOsSummary({ appUserId: commissionerUser.id, canonicalLeagueId: leagueA.id })
    log(JSON.stringify(chimmy, null, 2))
    check('(f) Chimmy summary resolved (non-null)', chimmy !== null)

    // ── Secret-leak scan over ALL captured stdout from this run ──────────────────────────────────
    const SUSPICIOUS_PATTERNS = [/token/i, /secret/i, /bearer/i, /oauth/i, /api[_-]?key/i, /password/i]
    const hits: { pattern: string; line: string }[] = []
    for (const line of capturedLines) {
      for (const pat of SUSPICIOUS_PATTERNS) {
        if (pat.test(line)) {
          hits.push({ pattern: pat.source, line: line.slice(0, 300) })
        }
      }
    }
    // Report but don't auto-fail on trivial false-positive matches (e.g. the word "password" appearing
    // in a schema disclosure) — inspect and report explicitly instead of asserting blindly.
    log('\n========== Secret-leak scan over captured stdout ==========')
    if (hits.length === 0) {
      log('No suspicious substrings (token/secret/bearer/oauth/api key/password) found in captured output.')
    } else {
      log(`Found ${hits.length} suspicious match(es) — inspect below:`)
      for (const h of hits) log(`  pattern=${h.pattern} line="${h.line}"`)
    }
    check('No secrets leaked in captured output', hits.length === 0, `${hits.length} suspicious hit(s)`)

    // ── Final PASS/FAIL summary ────────────────────────────────────────────────────────────────
    log('\n================ FINAL PASS/FAIL SUMMARY ================')
    const summaryChecks: { n: string; ok: boolean }[] = [
      {
        n: '(1) Health scores/bands differ between League A and B',
        ok: JSON.stringify(resA.bundle.commissioner.find((r) => r.type === 'league_health_score')) !==
          JSON.stringify(resB.bundle.commissioner.find((r) => r.type === 'league_health_score')),
      },
      {
        n: '(2) Engagement recommendation sets differ between A and B',
        ok:
          JSON.stringify(resA.bundle.commissioner.filter((r) => r.type.startsWith('engagement_') || r.type === 'mission_control_action')) !==
          JSON.stringify(resB.bundle.commissioner.filter((r) => r.type.startsWith('engagement_') || r.type === 'mission_control_action')),
      },
      { n: '(3) Commissioner-only access enforced (normal manager denied on League A)', ok: resDenied.accessDenied === true },
      { n: '(4) Nonexistent league also denied identically', ok: resNonexistent.accessDenied === true },
      {
        n: '(5) Rivalries domain reflects real history in A vs unsupported in B',
        ok: resA.domainStatus.rivalries === 'ok' && resB.domainStatus.rivalries === 'unsupported',
      },
      {
        n: '(6) Storylines domain reflects real DramaEvent rows in A vs empty/unsupported in B',
        ok: resA.domainStatus.storylines === 'ok' && resB.domainStatus.storylines === 'unsupported',
      },
      {
        n: '(7) Draft domain reflects real DraftGrade rows in A vs unsupported in B',
        ok: resA.domainStatus.draft === 'ok' && resB.domainStatus.draft === 'unsupported',
      },
      { n: '(8) Stale League B suppresses/downgrades any critical/high-priority claims', ok: bCriticalHigh.length === 0 },
      {
        n: '(9) League C correctly resolves as snapshot-only with integrity suppressed',
        ok: ctxC?.isSnapshotOnly === true && integrityRecsC.length === 0,
      },
      { n: '(10) No secrets leaked anywhere in output', ok: hits.length === 0 },
    ]
    for (const c of summaryChecks) {
      log(`${c.ok ? '[PASS]' : '[FAIL]'} ${c.n}`)
      if (!c.ok) failures++
    }

    log(`\nTotal detailed checks failed: ${results.filter((r) => !r.ok).length}`)
    log(failures === 0 ? 'COMMISSIONER_OS_PHYSICAL_VALIDATION_OK' : `COMMISSIONER_OS_PHYSICAL_VALIDATION_FAILED (${failures} checks failed)`)
  } catch (err) {
    log('FATAL ERROR DURING VALIDATION:')
    log(err instanceof Error ? (err.stack ?? err.message) : String(err))
    failures++
  } finally {
    // ── Cleanup: delete only what THIS run created, in FK-safe order ─────────────────────────────
    log('\n========== CLEANUP ==========')
    try {
      if (created.rivalryEventIds.length) {
        await prisma.rivalryEvent.deleteMany({ where: { id: { in: created.rivalryEventIds } } })
      }
      if (created.rivalryRecordIds.length) {
        await prisma.rivalryRecord.deleteMany({ where: { id: { in: created.rivalryRecordIds } } })
      }
      if (created.dramaEventIds.length) {
        await prisma.dramaEvent.deleteMany({ where: { id: { in: created.dramaEventIds } } })
      }
      if (created.draftGradeIds.length) {
        await prisma.draftGrade.deleteMany({ where: { id: { in: created.draftGradeIds } } })
      }
      if (created.leagueSeasonIds.length) {
        await prisma.leagueSeason.deleteMany({ where: { id: { in: created.leagueSeasonIds } } })
      }
      if (created.leagueTeamIds.length) {
        await prisma.leagueTeam.deleteMany({ where: { id: { in: created.leagueTeamIds } } })
      }
      if (created.leagueIds.length) {
        await prisma.league.deleteMany({ where: { id: { in: created.leagueIds } } })
      }
      if (created.appUserIds.length) {
        await prisma.appUser.deleteMany({ where: { id: { in: created.appUserIds } } })
      }
      origLog(
        `Cleanup deleted: rivalryEvents=${created.rivalryEventIds.length} rivalryRecords=${created.rivalryRecordIds.length} dramaEvents=${created.dramaEventIds.length} draftGrades=${created.draftGradeIds.length} leagueSeasons=${created.leagueSeasonIds.length} leagueTeams=${created.leagueTeamIds.length} leagues=${created.leagueIds.length} appUsers=${created.appUserIds.length}`
      )
      origLog('CLEANUP: done')
    } catch (cleanupErr) {
      origLog('CLEANUP FAILED — manual intervention may be required for run id:', runId)
      origLog(cleanupErr instanceof Error ? (cleanupErr.stack ?? cleanupErr.message) : String(cleanupErr))
      failures++
    }
    await prisma.$disconnect().catch(() => undefined)
  }

  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL (outer)', e instanceof Error ? e.stack : e)
  process.exit(1)
})
