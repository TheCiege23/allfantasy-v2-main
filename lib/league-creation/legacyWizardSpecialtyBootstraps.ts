/**
 * Concept-specific tables and configs after a league row exists (legacy wizard / compatibility).
 * Shared by:
 * - POST /api/league/create after executeCanonicalLeagueCreation (canonical pipeline)
 * - POST /api/league/create legacy Prisma league.create path (deprecated shell — kept for non-manual platforms)
 */

export type LegacyWizardSpecialtyBootstrapArgs = {
  league: { id: string; name: string | null; sport: string; leagueSize: number | null }
  userId: string
  name: string | null | undefined
  sport: string
  settingsWizard: Record<string, unknown> | undefined
  initialSettings: Record<string, unknown>
  flags: {
    isGuillotine: boolean
    isSalaryCap: boolean
    isSurvivor: boolean
    isZombie: boolean
    isDevy: boolean
    isBigBrother: boolean
    isC2C: boolean
    effectiveDynasty: boolean
    isIdpRequested: boolean
  }
  requestedDraftType: string | undefined
}

export async function runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate(
  args: LegacyWizardSpecialtyBootstrapArgs
): Promise<void> {
  const {
    league,
    userId,
    name,
    sport,
    settingsWizard,
    initialSettings,
    flags,
    requestedDraftType,
  } = args
  const {
    isGuillotine,
    isSalaryCap,
    isSurvivor,
    isZombie,
    isDevy,
    isBigBrother,
    isC2C,
    effectiveDynasty,
    isIdpRequested,
  } = flags

  const normalizeC2CStartupDraftType = (
    draftTypeRaw: string | undefined
  ): 'snake' | 'linear' | 'auction' => {
    const d = String(draftTypeRaw ?? '').trim().toLowerCase()
    if (d.includes('auction')) return 'auction'
    if (d.includes('linear')) return 'linear'
    return 'snake'
  }

  try {
    const { upsertLeagueWaiverSettings } = await import('@/lib/waiver-wire')
    const { defaultProcessingDaysList } = await import('@/lib/waiver-wire/free-agent-unlock')
    const waiverProcessingDaysRaw = initialSettings.waiver_processing_days
    const waiverProcessingDays = Array.isArray(waiverProcessingDaysRaw)
      ? waiverProcessingDaysRaw
          .map((d) => (typeof d === 'number' ? d : Number(d)))
          .filter((d) => Number.isFinite(d))
      : []
    await upsertLeagueWaiverSettings(league.id, {
      waiverType: typeof initialSettings.waiver_type === 'string' ? initialSettings.waiver_type : undefined,
      processingDayOfWeek: waiverProcessingDays.length > 0 ? waiverProcessingDays[0] : undefined,
      // Daily sports run on every listed day; a single day (NFL) writes no list — unchanged.
      processingDays: defaultProcessingDaysList(waiverProcessingDays) ?? undefined,
      processingTimeUtc:
        typeof initialSettings.waiver_processing_time_utc === 'string'
          ? initialSettings.waiver_processing_time_utc
          : undefined,
      claimLimitPerPeriod:
        typeof initialSettings.waiver_max_claims_per_period === 'number'
          ? initialSettings.waiver_max_claims_per_period
          : initialSettings.waiver_max_claims_per_period === null
            ? null
            : undefined,
      faabBudget:
        typeof initialSettings.faab_budget === 'number'
          ? initialSettings.faab_budget
          : initialSettings.faab_budget === null
            ? null
            : undefined,
      tiebreakRule:
        typeof initialSettings.waiver_claim_priority_behavior === 'string'
          ? initialSettings.waiver_claim_priority_behavior
          : undefined,
      lockType:
        typeof initialSettings.waiver_game_lock_behavior === 'string'
          ? initialSettings.waiver_game_lock_behavior
          : undefined,
      instantFaAfterClear:
        typeof initialSettings.waiver_free_agent_unlock_behavior === 'string'
          ? initialSettings.waiver_free_agent_unlock_behavior.toLowerCase() === 'instant'
          : undefined,
    })
  } catch (err) {
    console.warn('[league/create] Waiver settings sync non-fatal:', err)
  }

  if (isGuillotine) {
    try {
      const { upsertGuillotineConfig } = await import('@/lib/guillotine/GuillotineLeagueConfig')
      await upsertGuillotineConfig(league.id, {})
    } catch (err) {
      console.warn('[league/create] Guillotine config bootstrap non-fatal:', err)
    }
  }

  if (isSalaryCap) {
    try {
      const { upsertSalaryCapConfig } = await import('@/lib/salary-cap/SalaryCapLeagueConfig')
      const sc = (settingsWizard ?? {}) as Record<string, unknown>
      const modeRaw = String(sc.salary_cap_mode ?? sc.mode ?? initialSettings.mode ?? 'dynasty').toLowerCase()
      const mode = modeRaw === 'bestball' || modeRaw === 'best_ball' ? 'bestball' : 'dynasty'
      const startupFromWizard =
        typeof sc.salary_cap_startup_cap === 'number' && Number.isFinite(sc.salary_cap_startup_cap)
          ? sc.salary_cap_startup_cap
          : typeof sc.startupCap === 'number' && Number.isFinite(sc.startupCap)
            ? sc.startupCap
            : undefined
      await upsertSalaryCapConfig(league.id, {
        mode,
        ...(startupFromWizard != null ? { startupCap: startupFromWizard } : {}),
        ...(sc.futureDraftType != null && { futureDraftType: String(sc.futureDraftType) }),
        ...(sc.startupDraftType != null && { startupDraftType: String(sc.startupDraftType) === 'snake' ? 'snake' : 'auction' }),
        ...(sc.draftMode != null && sc.startupDraftType == null && { startupDraftType: String(sc.draftMode) === 'snake' ? 'snake' : 'auction' }),
      })
    } catch (err) {
      console.warn('[league/create] Salary cap config bootstrap non-fatal:', err)
    }
  }

  if (isSurvivor) {
    try {
      const { upsertSurvivorConfig } = await import('@/lib/survivor/SurvivorLeagueConfig')
      const { getOrCreateExileLeague } = await import('@/lib/survivor/SurvivorExileEngine')
      const mode = String(
        (initialSettings as Record<string, unknown>).mode ?? settingsWizard?.mode ?? 'redraft'
      ).toLowerCase()
      const sw = initialSettings as Record<string, unknown>
      const suggestedTribes =
        typeof sw.survivor_suggested_tribe_count === 'number' && Number.isFinite(sw.survivor_suggested_tribe_count)
          ? Math.max(2, Math.min(4, Math.round(Number(sw.survivor_suggested_tribe_count))))
          : null
      const teamCount = typeof league.leagueSize === 'number' ? league.leagueSize : 20
      const tribeCount =
        suggestedTribes ??
        (typeof sw.tribeCount === 'number' && Number.isFinite(sw.tribeCount)
          ? Math.max(2, Math.min(4, Math.round(Number(sw.tribeCount))))
          : 4)
      const tribeSize = Math.max(1, Math.ceil(teamCount / tribeCount))
      const tribeFormation = String(sw.tribeFormation ?? 'random')
      const seasonThemeRaw = sw.survivor_season_theme_label
      const seasonThemeLabel =
        typeof seasonThemeRaw === 'string' && seasonThemeRaw.trim().length > 0
          ? String(seasonThemeRaw).trim()
          : null
      const challengesSystemRun = sw.survivor_challenges_system_run !== false
      const { normalizeSurvivorFoundationSettings } = await import('@/lib/survivor/survivorSettings')
      const foundation = normalizeSurvivorFoundationSettings({ ...sw, defaultTeamCount: teamCount, tribeCount })
      await upsertSurvivorConfig(league.id, {
        mode: mode === 'bestball' ? 'bestball' : 'redraft',
        tribeCount,
        tribeSize,
        tribeFormation,
        mergeTrigger: foundation.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week',
        mergeWeek: foundation.mergeWeek,
        mergePlayerCount: foundation.mergeActivePlayerCount,
        exileReturnEnabled: foundation.exileIslandEnabled,
        exileReturnTokens: foundation.exileReturnTokens,
        idolCount: foundation.idolCount,
        selfVoteDisallowed: !foundation.selfVotesAllowed,
        seasonThemeLabel,
        challengesSystemRun,
      })
      if (foundation.exileIslandEnabled) await getOrCreateExileLeague(league.id).catch((err) => {
        console.warn('[league/create] Survivor exile bootstrap non-fatal:', err)
      })
      try {
        const { seedSurvivorFaqToLeagueChat } = await import('@/lib/survivor/survivorFaq')
        const faqResult = await seedSurvivorFaqToLeagueChat({
          leagueId: league.id,
          commissionerUserId: userId,
        })
        if (!faqResult.ok) {
          console.warn('[league/create] Survivor FAQ not seeded:', faqResult.error)
        }
      } catch (faqErr) {
        console.warn('[league/create] Survivor FAQ seed non-fatal:', faqErr)
      }
      try {
        const { runSurvivorLeagueBootstrap } = await import('@/lib/survivor/survivorLeagueBootstrap')
        const bootstrap = await runSurvivorLeagueBootstrap(league.id)
        if (bootstrap.warnings.length) {
          console.warn('[league/create] Survivor bootstrap warnings:', bootstrap.warnings)
        }
      } catch (bootErr) {
        console.warn('[league/create] Survivor league bootstrap non-fatal:', bootErr)
      }
      try {
        const { getOrCreateDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
        await getOrCreateDraftSession(league.id)
      } catch (draftErr) {
        console.warn('[league/create] Survivor draft session shell non-fatal:', draftErr)
      }
    } catch (err) {
      console.warn('[league/create] Survivor config bootstrap non-fatal:', err)
    }
  }

  if (isZombie) {
    try {
      const { upsertZombieLeagueConfig } = await import('@/lib/zombie/ZombieLeagueConfig')
      const { createZombieLeague } = await import('@/lib/zombie/setupEngine')
      const zw = (settingsWizard ?? {}) as Record<string, unknown>
      const whispererSelection =
        zw.zombie_whisperer_selection === 'veteran_priority' ? 'veteran_priority' : 'random'
      const universeId =
        typeof zw.zombie_universe_id === 'string' && zw.zombie_universe_id.trim()
          ? String(zw.zombie_universe_id).trim()
          : null
      const levelId =
        typeof zw.zombie_level_id === 'string' && zw.zombie_level_id.trim()
          ? String(zw.zombie_level_id).trim()
          : null
      await upsertZombieLeagueConfig(league.id, { whispererSelection, universeId })
      await createZombieLeague(
        {
          leagueId: league.id,
          name: name ?? null,
          sport: String(sport),
          teamCount: typeof league.leagueSize === 'number' ? league.leagueSize : 12,
          isPaid: false,
          buyInAmount: null,
          whispererSelectionMode: whispererSelection,
          namingMode: 'hybrid',
          isSingleLeague: !universeId,
        },
        universeId,
        levelId,
      )
    } catch (err) {
      console.warn('[league/create] Zombie config bootstrap non-fatal:', err)
    }
  }

  if (isDevy) {
    try {
      const { upsertDevyConfig } = await import('@/lib/devy/DevyLeagueConfig')
      const s = settingsWizard as Record<string, unknown> | undefined
      const devyCollege =
        typeof s?.devy_college_slots_creation === 'number' && Number.isFinite(s.devy_college_slots_creation)
          ? s.devy_college_slots_creation
          : typeof s?.devy_slot_count === 'number'
            ? s.devy_slot_count
            : undefined
      const devyTaxi =
        typeof s?.devy_taxi_slots_creation === 'number' && Number.isFinite(s.devy_taxi_slots_creation)
          ? s.devy_taxi_slots_creation
          : typeof s?.devy_taxi_slots === 'number'
            ? s.devy_taxi_slots
            : undefined
      await upsertDevyConfig(league.id, {
        devySlotCount: devyCollege,
        devyIRSlots: typeof s?.devy_ir_slots === 'number' ? s.devy_ir_slots : undefined,
        taxiSize: devyTaxi,
        collegeSports: Array.isArray(s?.devy_college_sports)
          ? (s?.devy_college_sports as string[]).filter(Boolean)
          : undefined,
      })
    } catch (err) {
      console.warn('[league/create] Devy config bootstrap non-fatal:', err)
    }
  }

  if (isBigBrother) {
    try {
      const { upsertBigBrotherConfig } = await import('@/lib/big-brother/BigBrotherLeagueConfig')
      await upsertBigBrotherConfig(league.id, {})
      try {
        const { runBigBrotherLeagueBootstrap } = await import('@/lib/big-brother/bigBrotherLeagueBootstrap')
        const bbBoot = await runBigBrotherLeagueBootstrap(league.id)
        if (!bbBoot.weekOneCycle.ok && bbBoot.weekOneCycle.error) {
          console.warn('[league/create] Big Brother week-1 cycle:', bbBoot.weekOneCycle.error)
        }
      } catch (bootErr) {
        console.warn('[league/create] Big Brother league bootstrap non-fatal:', bootErr)
      }
    } catch (err) {
      console.warn('[league/create] Big Brother config bootstrap non-fatal:', err)
    }
  }

  if (isC2C) {
    try {
      const { upsertC2CConfig } = await import('@/lib/merged-devy-c2c/C2CLeagueConfig')
      const s = settingsWizard as Record<string, unknown> | undefined
      const startupDraftType = normalizeC2CStartupDraftType(requestedDraftType)
      const c2cCollegeRoster =
        typeof s?.c2c_college_slots_creation === 'number' && Number.isFinite(s.c2c_college_slots_creation)
          ? s.c2c_college_slots_creation
          : typeof s?.c2c_college_roster_size === 'number'
            ? s.c2c_college_roster_size
            : 20
      const c2cTaxi =
        typeof s?.c2c_taxi_slots_creation === 'number' && Number.isFinite(s.c2c_taxi_slots_creation)
          ? s.c2c_taxi_slots_creation
          : undefined
      await upsertC2CConfig(league.id, {
        startupFormat: (s?.c2c_startup_mode as string) ?? 'merged',
        mergedStartupDraft: (s?.c2c_startup_mode as string) !== 'separate',
        separateStartupCollegeDraft: (s?.c2c_startup_mode as string) === 'separate',
        startupDraftType,
        standingsModel: (s?.c2c_standings_model as string) ?? 'unified',
        collegeSports: Array.isArray(s?.c2c_college_sports)
          ? (s?.c2c_college_sports as string[]).filter(Boolean)
          : undefined,
        collegeScoringSystem: (s?.c2c_scoring_system as string) ?? 'ppr',
        mixProPlayers: s?.c2c_mix_pro_players !== false,
        bestBallPro: s?.c2c_best_ball_pro !== false,
        bestBallCollege: Boolean(s?.c2c_best_ball_college),
        taxiSize: c2cTaxi,
        collegeRosterSize: c2cCollegeRoster,
        rookieDraftRounds: typeof s?.c2c_rookie_draft_rounds === 'number' ? s.c2c_rookie_draft_rounds : 4,
        collegeDraftRounds: typeof s?.c2c_college_draft_rounds === 'number' ? s.c2c_college_draft_rounds : 6,
      })
    } catch (err) {
      console.warn('[league/create] C2C config bootstrap non-fatal:', err)
    }
  }

  if (effectiveDynasty) {
    try {
      const { upsertDynastyConfig } = await import('@/lib/dynasty-core/DynastySettingsService')
      const s = settingsWizard as Record<string, unknown> | undefined
      const taxiFromCreate =
        typeof s?.dynasty_taxi_slots_creation === 'number' && Number.isFinite(s.dynasty_taxi_slots_creation)
          ? s.dynasty_taxi_slots_creation
          : undefined
      await upsertDynastyConfig(league.id, {
        ...(taxiFromCreate != null ? { taxiSlots: taxiFromCreate } : {}),
      })
    } catch (err) {
      console.warn('[league/create] Dynasty config bootstrap non-fatal:', err)
    }
  }

  if (isIdpRequested) {
    try {
      const { upsertIdpLeagueConfig } = await import('@/lib/idp')
      const s = settingsWizard as Record<string, unknown> | undefined
      await upsertIdpLeagueConfig(league.id, {
        positionMode: typeof s?.idp_position_mode === 'string' ? s.idp_position_mode : undefined,
        rosterPreset: typeof s?.idp_roster_preset === 'string' ? s.idp_roster_preset : undefined,
        scoringPreset: typeof s?.idp_scoring_preset === 'string' ? s.idp_scoring_preset : undefined,
        draftType: requestedDraftType,
      })
    } catch (err) {
      console.warn('[league/create] IDP config bootstrap non-fatal:', err)
    }
  }
}
