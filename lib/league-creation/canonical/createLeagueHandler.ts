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
import {
  getAllowedDraftTypesFromCatalog,
  getAllowedScoringPresetsFromCatalog,
  getAllowedSportsFromCatalog,
  getAllowedTeamCountsFromCatalog,
  getLeagueCreateOptionsCatalog,
} from '@/lib/league-creation/options-catalog'
import { normalizeDraftTypeForEngineValidation } from '@/lib/draft-types/draftTypeRegistry'
import { buildFantasyLeagueLeadMetaEvent } from '@/lib/meta-funnel-events'
import { trackMetaServerEvent } from '@/lib/meta-capi'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  findPremiumCreateSettingKeys,
  hasAfCommissionerCreateEntitlement,
} from '@/lib/league-creation/canonical/premiumCreateSettingsGate'

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

  const { body: sanitizedBody, strippedKeys } = stripForbiddenCreateLeagueFields(raw)
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
  const catalogConcept = normalizedConcept?.aliasTags.includes('idp')
    ? 'idp'
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

  const allowedDraftTypes = getAllowedDraftTypesFromCatalog(catalog, catalogConcept)
  const normalizedDraftType = normalizeDraftTypeForEngineValidation(validated.data.draftType)
  if (
    allowedDraftTypes.length > 0 &&
    !allowedDraftTypes.includes(validated.data.draftType) &&
    !allowedDraftTypes.includes(normalizedDraftType)
  ) {
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
