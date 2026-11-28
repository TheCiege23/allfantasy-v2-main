/**
 * POST /api/leagues — shared handler (Next.js Route Handler).
 * Auth: session user → AppUser.id (never trust client commissioner id).
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  stripForbiddenCreateLeagueFields,
  validateCreatePayload,
} from '@/lib/league-creation/canonical/validateCreateLeague'
import type { CreateLeagueErrorResponse, CreateLeagueSuccessResponse } from '@/lib/league-creation/canonical/types'
import { resolveAppUserIdForLeagueCreate } from '@/lib/redraft-creation/resolve-app-user-for-league'
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { checkRetiredConcept } from '@/lib/league-creation/retiredConcepts'
import {
  isAllowedDraftTypeFromCatalog,
  getAllowedScoringPresetsFromCatalog,
  getAllowedSportsFromCatalog,
  getAllowedTeamCountsFromCatalog,
  getLeagueCreateOptionsCatalog,
} from '@/lib/league-creation/options-catalog'
import { buildFantasyLeagueLeadMetaEvent } from '@/lib/meta-funnel-events'
import { trackMetaServerEvent } from '@/lib/meta-capi'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  findPremiumCreateSettingKeys,
  hasAfCommissionerCreateEntitlement,
} from '@/lib/league-creation/canonical/premiumCreateSettingsGate'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { oddTeamCountNeedsAfCommissioner, oddTeamGateLeagueWord } from '@/lib/league/oddTeamLeagues'
import { fillTestLeagueWithPlaceholders } from '@/lib/demo-league/testLeagueFill'

const LOG_PREFIX = '[create-league-canonical]'

function log(event: string, payload: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, payload)
}

export async function postCreateLeague(req: Request): Promise<NextResponse<CreateLeagueSuccessResponse | CreateLeagueErrorResponse>> {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null; name?: string | null }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized', errors: [] }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON body',
        errors: [{ path: 'body', message: 'Request body must be valid JSON' }],
      },
      { status: 400 }
    )
  }

  const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  // Copying an imported league into a NEW league is retired (docs/league-import/
  // IN_PLACE_NATIVE_CONVERSION_PLAN.md §10): it made the second copy of the league the owner
  // rejected. An imported league is switched IN PLACE from its Commissioner tab instead. Refused
  // before anything is read or written, whatever the id, so the answer says nothing about it.
  if (rawObject.sourceLeagueId !== undefined) {
    return NextResponse.json({
      success: false,
      error: 'Copying an imported league is no longer available. Switch it to AllFantasy from its Commissioner tab instead.',
      errors: [{ path: 'sourceLeagueId', message: 'Copying an imported league is no longer available.', code: 'IMPORT_COPY_RETIRED' }],
    }, { status: 410 })
  }

  // "Create a test league" (demo flow): every open seat is filled with a placeholder AI
  // manager after creation, and the league is kept out of real-league analytics.
  const testLeague = rawObject.testLeague === true

  const { body: strippedBody, strippedKeys } = stripForbiddenCreateLeagueFields(raw)
  const sanitizedBody = strippedBody && typeof strippedBody === 'object'
    ? (({ testLeague: _testLeague, ...rest }) => rest)(strippedBody as Record<string, unknown>)
    : strippedBody
  if (strippedKeys.length > 0) {
    log('client_user_id_fields_stripped', { strippedKeys })
  }

  const validated = validateCreatePayload(sanitizedBody)
  if (!validated.ok) {
    return NextResponse.json(
      {
        success: false,
        error: validated.error,
        errors: validated.errors.map((e) => ({ path: e.path, message: e.message, code: e.code })),
      },
      { status: validated.status }
    )
  }

  const catalog = await getLeagueCreateOptionsCatalog()
  const normalizedConcept = normalizeConceptToFormat(validated.data.concept)

  // Defence in depth: `validateCreatePayload` already rejects retired concepts,
  // but this handler is the boundary for POST /api/leagues, so it refuses them
  // independently rather than trusting an upstream check. No write has happened
  // at this point — the transaction starts below.
  const retiredConcept = checkRetiredConcept(normalizedConcept?.formatId)
  if (retiredConcept) {
    return NextResponse.json(
      {
        success: false,
        error: retiredConcept.message,
        errors: [{ path: 'concept', message: retiredConcept.message, code: retiredConcept.code }],
      },
      { status: 400 }
    )
  }

  // An alias with its own catalog entry is validated against that entry, not its shell's: a Survivor
  // Guilly league is a redraft shell but offers only the sports and sizes its schedule can fit.
  const catalogConcept = normalizedConcept?.aliasTags.includes('idp')
    ? 'idp'
    : normalizedConcept?.aliasTags.includes('survivor_guillotine')
      ? 'survivor_guillotine'
      : normalizedConcept?.formatId ?? validated.data.concept

  const allowedSports = getAllowedSportsFromCatalog(catalog, catalogConcept)
  if (allowedSports.length > 0 && !allowedSports.includes(validated.data.sport)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Selected sport is not available for this concept',
        errors: [{ path: 'sport', message: `Sport ${validated.data.sport} is not valid for ${catalogConcept}` }],
      },
      { status: 400 }
    )
  }

  if (!isAllowedDraftTypeFromCatalog(catalog, catalogConcept, validated.data.draftType)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Selected draft type is not available for this concept',
        errors: [{ path: 'draftType', message: `Draft type ${validated.data.draftType} is not valid for ${catalogConcept}` }],
      },
      { status: 400 }
    )
  }

  const allowedScoringPresets = getAllowedScoringPresetsFromCatalog(catalog, catalogConcept, validated.data.sport)
  if (allowedScoringPresets.length > 0 && !allowedScoringPresets.includes(validated.data.scoringPreset)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Selected scoring preset is not available for this concept and sport',
        errors: [{ path: 'scoringPreset', message: `Scoring preset ${validated.data.scoringPreset} is not valid for ${catalogConcept}/${validated.data.sport}` }],
      },
      { status: 400 }
    )
  }

  const allowedTeamCounts = getAllowedTeamCountsFromCatalog(catalog, catalogConcept, validated.data.sport)
  if (allowedTeamCounts.length > 0 && !allowedTeamCounts.includes(validated.data.teamCount)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Selected team count is not available for this concept and sport',
        errors: [{ path: 'teamCount', message: `Team count ${validated.data.teamCount} is not valid for ${catalogConcept}/${validated.data.sport}` }],
      },
      { status: 400 }
    )
  }

  const resolvedUser = await resolveAppUserIdForLeagueCreate(session.user)
  if (!resolvedUser.ok) {
    return NextResponse.json(
      {
        success: false,
        error: 'Authenticated user not found in app_users',
        errors: [{ path: 'session', message: 'No matching AppUser for this session.' }],
      },
      { status: 403 }
    )
  }

  const premiumCreateKeys = findPremiumCreateSettingKeys(validated.data.conceptSetup)
  if (premiumCreateKeys.length > 0) {
    const entitlement = await new EntitlementResolver().resolveSnapshot(
      resolvedUser.appUserId,
      session.user.email,
    )

    if (!hasAfCommissionerCreateEntitlement(entitlement)) {
      return NextResponse.json(
        {
          success: false,
          error: 'AF Commissioner is required for advanced setup',
          errors: [
            {
              path: 'conceptSetup.advancedSetup',
              message: 'Upgrade to AF Commissioner before saving premium advanced setup.',
            },
          ],
        },
        { status: 403 },
      )
    }
  }

  // Odd redraft and keeper sizes are an AF Commissioner option (lib/league/oddTeamLeagues.ts).
  if (oddTeamCountNeedsAfCommissioner(catalogConcept, validated.data.teamCount)) {
    const hasPlan = await hasAfCommissionerPlan({ ...session.user, id: resolvedUser.appUserId })
    if (!hasPlan) {
      return NextResponse.json(
        {
          success: false,
          error: `AF Commissioner is required for an odd-team ${oddTeamGateLeagueWord(catalogConcept)}league`,
          errors: [
            {
              path: 'teamCount',
              message: `A ${validated.data.teamCount}-team ${oddTeamGateLeagueWord(catalogConcept)}league is part of AF Commissioner. Choose an even team count or upgrade.`,
              code: 'ODD_TEAM_COUNT_REQUIRES_AF_COMMISSIONER',
            },
          ],
        },
        { status: 403 },
      )
    }
  }

  const exec = await executeCanonicalLeagueCreation({
    appUserId: resolvedUser.appUserId,
    body: {
      ...validated.data,
      timezone: validated.data.timezone?.trim() || catalog.defaultTimezone || 'America/New_York',
    },
  })

  if (!exec.ok) {
    return NextResponse.json(exec.response, { status: exec.status })
  }

  if (testLeague) {
    // 🛑 NO META LEAD FOR A TEST LEAGUE. A conversion event teaches the ad optimiser who to buy,
    // and it cannot be taken back; a tester's throwaway league is not a lead.
    let filled = 0
    try {
      filled = (await fillTestLeagueWithPlaceholders(exec.response.league.id)).filled
    } catch (fillError) {
      console.warn(`${LOG_PREFIX} test league placeholder fill failed`, {
        leagueId: exec.response.league.id,
        error: fillError instanceof Error ? fillError.message : String(fillError),
      })
    }
    return NextResponse.json({ ...exec.response, testLeague: { placeholdersFilled: filled } })
  }

  const metaEvent = buildFantasyLeagueLeadMetaEvent({
    leagueId: exec.response.league.id,
    leagueName: exec.response.league.leagueName,
    sport: exec.response.league.sport,
    leagueType: exec.response.league.concept,
    draftType: exec.response.league.draftType,
  })
  await trackMetaServerEvent({
    eventName: metaEvent.eventName,
    eventId: metaEvent.eventId,
    customData: metaEvent.customData,
    email: session.user.email ?? null,
    userId: resolvedUser.appUserId,
    request: req,
    source: 'canonical_league_create',
  }).catch((metaError) => {
    console.warn('[create-league-canonical] Meta Lead failed', metaError)
  })

  return NextResponse.json({ ...exec.response, metaEvent })
}
