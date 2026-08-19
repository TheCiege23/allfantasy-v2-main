import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { requireVerifiedUser } from '@/lib/auth-guard';
import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import { buildLeagueInviteUrl } from '@/lib/viral-loop';
import { resolveEffectiveLeagueVariant } from '@/lib/league-creation/LeagueVariantResolver';
import { isSportEnabled } from '@/lib/feature-toggle';
import { isDraftTypeAllowedForSport } from '@/lib/sport-rules-engine';
import {
  isDraftTypeAllowedForFormat,
  isLeagueFormatAllowedForSport,
  resolveLeagueFormat,
} from '@/lib/league/format-engine';
import {
  DRAFT_TYPE_IDS,
  LEAGUE_TYPE_IDS,
  isDraftTypeAllowedForLeagueType,
  isLeagueTypeAllowedForSport,
} from '@/lib/league-creation-wizard/league-type-registry';
import { z } from 'zod';
import { SETTINGS_SNAPSHOT_VERSION, buildPresetKey } from '@/lib/league-contract';
import { stripForbiddenCreateLeagueFields, validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague';
import { resolveAppUserIdForLeagueCreate } from '@/lib/redraft-creation/resolve-app-user-for-league';
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation';
import { mapCanonicalSuccessToLegacyLeagueCreateResponse } from '@/lib/league-creation/canonical/createLeagueResponseShaping';
import { buildLegacyManualCanonicalCreatePayload } from '@/lib/league-creation/canonical/legacyManualToCanonicalCreateBody';
import { runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate } from '@/lib/league-creation/legacyWizardSpecialtyBootstraps';
import { assertImportCommissioner } from '@/lib/league-import/commissionerGate';
import { isCategoryPresetId } from '@/lib/category-scoring';
import { isAllowedIdpDraftType, supportsIdpLeagueSport } from '@/lib/sport-scope';
import { buildFantasyLeagueLeadMetaEvent } from '@/lib/meta-funnel-events';
import { trackMetaServerEvent } from '@/lib/meta-capi';
import {
  mergeConceptPresetSettings,
  resolveConceptPreset,
  type ConceptPresetResolution,
} from '@/lib/league-concepts/resolveConceptPreset';
import { normalizeRedraftSettingsSnapshot } from '@/lib/league-concepts/redraftDefaults';
import { normalizeKeeperSettingsSnapshot } from '@/lib/league-concepts/keeperDefaults';
import { normalizeDevySettingsSnapshot } from '@/lib/league-concepts/devyDefaults';
import {
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '@/lib/survivor/normalizeSurvivorSettings';

const createSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  platform: z.enum(['sleeper', 'espn', 'manual']),
  platformLeagueId: z.string().optional(),
  leagueSize: z.number().min(4).max(32).optional(),
  rosterSize: z.number().min(1).max(64).optional(),
  scoring: z.string().optional(),
  isDynasty: z.boolean().optional(),
  isSuperflex: z.boolean().optional(),
  sport: z.enum(['NFL', 'NHL', 'MLB', 'NBA', 'NCAAF', 'NCAAB', 'SOCCER']).optional(),
  leagueVariant: z.string().max(32).optional(),
  userId: z.string().optional(),
  /** Create league from full Sleeper import; requires sleeperLeagueId */
  createFromSleeperImport: z.boolean().optional(),
  sleeperLeagueId: z.string().optional(),
  /** League creation wizard: league type (redraft, dynasty, keeper, etc.) */
  league_type: z.string().max(32).optional(),
  /** Camel-case alias for wizard consumers */
  leagueType: z.string().max(32).optional(),
  /** League creation wizard: draft type (snake, linear, auction, slow_draft) */
  draft_type: z.string().max(32).optional(),
  /** Camel-case alias for wizard consumers */
  draftType: z.string().max(32).optional(),
  formatId: z.string().max(32).optional(),
  format: z.string().max(32).optional(),
  modifiers: z.array(z.string().max(32)).optional(),
  /** League creation wizard: merged into League.settings (AI, automation, privacy, draft defaults) */
  settings: z.record(z.unknown()).optional(),
  rosterSettings: z.record(z.unknown()).optional(),
  scoringSettings: z.record(z.unknown()).optional(),
  rules: z.record(z.unknown()).optional(),
  introVideo: z.record(z.unknown()).optional(),
  keeperSettings: z.record(z.unknown()).optional(),
  salaryCapSettings: z.record(z.unknown()).optional(),
  inviteSettings: z.record(z.unknown()).optional(),
  /** Soccer only: MLS vs European data pipeline (stored in `settings.soccer_pipeline`). */
  soccerPipeline: z.enum(['mls', 'euro']).optional(),
  /** Create League v2 unified flow — validated against `lib/league-creation-preset/scoring-presets`. */
  scoringPresetId: z.string().max(96).optional(),
  /** Scoring mode — 'points' (default), 'h2h_category', or 'roto'. Mirrors `settings.scoring_mode`. */
  scoringMode: z.enum(['points', 'h2h_category', 'roto']).optional(),
  /** Category preset id when scoringMode is 'h2h_category' or 'roto'. Validated against the category-scoring registry. */
  categoryPresetId: z.string().max(64).optional(),
});

async function trackFantasyLeagueLead(input: {
  request: Request;
  userId: string;
  email?: string | null;
  leagueId: string;
  leagueName: string;
  sport?: string | null;
  leagueType?: string | null;
  draftType?: string | null;
  source: string;
}) {
  const metaEvent = buildFantasyLeagueLeadMetaEvent({
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    sport: input.sport,
    leagueType: input.leagueType,
    draftType: input.draftType,
  });
  await trackMetaServerEvent({
    eventName: metaEvent.eventName,
    eventId: metaEvent.eventId,
    customData: metaEvent.customData,
    email: input.email ?? null,
    userId: input.userId,
    request: input.request,
    source: input.source,
  }).catch((metaError) => {
    console.warn('[league/create] Meta Lead failed:', metaError);
  });
  return metaEvent;
}

function isConceptPresetSport(sport: string | null | undefined): boolean {
  const normalized = String(sport ?? '').toUpperCase();
  return normalized === 'NFL' || normalized === 'NCAAF';
}

function asCreateSettingsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readEnabledConceptFlags(settings: Record<string, unknown> | undefined): string[] | null {
  const fromSettings = settings?.enabledConceptFeatureFlags;
  if (!Array.isArray(fromSettings)) return null;
  return fromSettings.filter((flag): flag is string => typeof flag === 'string' && flag.trim().length > 0);
}

function buildConceptPresetModifiers(args: {
  modifiers?: string[];
  isSuperflex?: boolean;
  isIdpRequested: boolean;
  leagueVariant?: string | null;
  requestedLeagueType?: string | null;
  requestedDraftType?: string | null;
}): string[] {
  return [
    ...(args.modifiers ?? []),
    args.isSuperflex ? 'superflex' : null,
    args.isIdpRequested ? 'idp' : null,
    args.leagueVariant ?? null,
    args.requestedLeagueType ?? null,
    args.requestedDraftType ?? null,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null };
  } | null;

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
  }

  const {
    name: nameInput,
    platform,
    platformLeagueId,
    leagueSize: leagueSizeInput,
    rosterSize: rosterSizeInput,
    scoring: scoringInput,
    isDynasty: isDynastyInput,
    isSuperflex,
    sport: sportInput,
    leagueVariant: leagueVariantFromBody,
    createFromSleeperImport,
    sleeperLeagueId,
    league_type: leagueTypeWizard,
    leagueType: leagueTypeWizardCamel,
    draft_type: draftTypeWizard,
    draftType: draftTypeWizardCamel,
    formatId: formatIdInput,
    format: formatInput,
    modifiers,
    settings: settingsWizard,
    rosterSettings,
    scoringSettings,
    rules,
    introVideo,
    keeperSettings,
    salaryCapSettings,
    inviteSettings,
    soccerPipeline: soccerPipelineInput,
    scoringPresetId: scoringPresetIdInput,
    scoringMode: scoringModeInput,
    categoryPresetId: categoryPresetIdInput,
  } = parsed.data;

  /**
   * Quick Create sets `leagueVariant` to the same string as `scoring`; that is not a real league variant.
   * Strip it so draft-rule lookups and modifier detection do not see a bogus "format" token.
   */
  const leagueVariantEffective =
    leagueVariantFromBody != null &&
    scoringInput != null &&
    String(leagueVariantFromBody).trim() === String(scoringInput).trim()
      ? undefined
      : leagueVariantFromBody;

  if (createFromSleeperImport && !sleeperLeagueId?.trim()) {
    return NextResponse.json({ error: 'sleeperLeagueId is required' }, { status: 400 });
  }

  let sport = sportInput ?? 'NFL';
  const normalizeWizardEnum = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    return normalized.length > 0 ? normalized : undefined;
  };
  const requestedLeagueType = normalizeWizardEnum(leagueTypeWizard ?? leagueTypeWizardCamel ?? formatIdInput ?? formatInput);
  const requestedDraftType = normalizeWizardEnum(draftTypeWizard ?? draftTypeWizardCamel);
  if (requestedLeagueType && !(LEAGUE_TYPE_IDS as string[]).includes(requestedLeagueType)) {
    return NextResponse.json(
      { error: `Unsupported league type: ${requestedLeagueType}` },
      { status: 400 }
    );
  }
  if (requestedDraftType && !(DRAFT_TYPE_IDS as string[]).includes(requestedDraftType)) {
    return NextResponse.json(
      { error: `Unsupported draft type: ${requestedDraftType}` },
      { status: 400 }
    );
  }
  if (!(await isSportEnabled(sport))) {
    return NextResponse.json(
      { error: `Sport ${sport} is currently disabled by platform configuration.` },
      { status: 403 }
    );
  }
  if (requestedLeagueType && !isLeagueFormatAllowedForSport(sport, requestedLeagueType)) {
    return NextResponse.json(
      {
        error: `${requestedLeagueType} leagues are not available for ${sport}.`,
      },
      { status: 400 }
    );
  }
  if (
    requestedLeagueType &&
    !isLeagueTypeAllowedForSport(requestedLeagueType as any, sport)
  ) {
    return NextResponse.json(
      {
        error: `${requestedLeagueType} leagues are not available for ${sport}.`,
      },
      { status: 400 }
    );
  }
  if (
    requestedLeagueType &&
    requestedDraftType &&
    !isDraftTypeAllowedForFormat(sport, requestedLeagueType, requestedDraftType)
  ) {
    return NextResponse.json(
      {
        error: `${requestedDraftType} draft is not valid for ${requestedLeagueType} leagues.`,
      },
      { status: 400 }
    );
  }
  if (
    requestedLeagueType &&
    requestedDraftType &&
    !isDraftTypeAllowedForLeagueType(requestedDraftType as any, requestedLeagueType as any)
  ) {
    return NextResponse.json(
      {
        error: `${requestedDraftType} draft is not valid for ${requestedLeagueType} leagues.`,
      },
      { status: 400 }
    );
  }
  if (
    requestedDraftType &&
    !isDraftTypeAllowedForSport(sport, requestedDraftType, leagueVariantEffective ?? null)
  ) {
    return NextResponse.json(
      {
        error: `${requestedDraftType} draft is not supported for ${sport}.`,
      },
      { status: 400 }
    );
  }
  const isIdpRequested =
    String(leagueVariantEffective ?? '').toUpperCase() === 'IDP' ||
    String(leagueVariantEffective ?? '').toUpperCase() === 'DYNASTY_IDP' ||
    String(requestedLeagueType ?? '').toLowerCase() === 'idp' ||
    String(requestedLeagueType ?? '').toLowerCase() === 'dynasty_idp';
  if (scoringPresetIdInput?.trim()) {
    const { isScoringPresetValidForContext } = await import('@/lib/league-creation-preset/scoring-presets');
    const lt = (requestedLeagueType ?? 'redraft') as import('@/lib/league-creation-wizard/types').LeagueTypeId;
    const ctx = {
      leagueType: lt,
      sport: sport as import('@/lib/create-league-v2/state').SupportedSport,
      idpSelected: isIdpRequested,
    };
    if (!isScoringPresetValidForContext(scoringPresetIdInput.trim(), ctx)) {
      return NextResponse.json(
        { error: 'Invalid scoring preset for this league concept and sport.' },
        { status: 400 }
      );
    }
  }
  if (isIdpRequested && !supportsIdpLeagueSport(sport)) {
    return NextResponse.json(
      { error: 'IDP leagues are supported only for NFL and NCAAF. Please select one of those sports.' },
      { status: 400 }
    );
  }
  if (isIdpRequested && requestedDraftType && !isAllowedIdpDraftType(requestedDraftType)) {
    return NextResponse.json(
      { error: 'IDP draft type must be one of: snake, linear, auction, offline, auto.' },
      { status: 400 }
    );
  }
  const isZombieLeagueType =
    String(leagueVariantEffective ?? '').toLowerCase() === 'zombie' ||
    String(requestedLeagueType ?? '').toLowerCase() === 'zombie';
  const isDevyRequested =
    String(leagueVariantEffective ?? '').toLowerCase() === 'devy_dynasty' ||
    String(requestedLeagueType ?? '').toLowerCase() === 'devy';
  const isC2CRequested =
    String(leagueVariantEffective ?? '').toLowerCase() === 'merged_devy_c2c' ||
    String(requestedLeagueType ?? '').toLowerCase() === 'c2c';
  /** Zombie uses scoring variants (PPR, IDP, etc.) on `leagueVariant` — never treat as Devy/C2C dynasty-only. */
  if (!isZombieLeagueType && (isDevyRequested || isC2CRequested) && isDynastyInput === false) {
    return NextResponse.json(
      { error: 'Devy and C2C (Merged Devy) leagues cannot be created as redraft. They are dynasty-only.' },
      { status: 400 }
    );
  }
  if (isDevyRequested) {
    const devySport = (sportInput ?? 'NFL').toString().toUpperCase();
    /** Devy is supported for NFL/NCAAF and NBA/NCAAB pipelines only (no MLB/NHL/Soccer). */
    if (!['NFL', 'NBA', 'NCAAF', 'NCAAB'].includes(devySport)) {
      return NextResponse.json(
        {
          error:
            'Devy leagues are available for NFL, NCAA Football, NBA, or NCAA Basketball prospect pipelines. Choose one of those sports.',
        },
        { status: 400 }
      );
    }
  }
  if (isC2CRequested) {
    const c2cSport = (sportInput ?? 'NFL').toString().toUpperCase();
    if (!['NFL', 'NBA', 'NCAAF', 'NCAAB'].includes(c2cSport)) {
      return NextResponse.json(
        {
          error:
            'Campus-to-Canton leagues are available for NFL, NCAA Football, NBA, or NCAA Basketball. Choose one of those sports.',
        },
        { status: 400 }
      );
    }
  }
  if (isZombieLeagueType && String(sport).toUpperCase() === 'SOCCER') {
    return NextResponse.json(
      { error: 'Zombie leagues are not available for Soccer. Choose another sport.' },
      { status: 400 }
    );
  }
  if (String(requestedLeagueType ?? '').toLowerCase() === 'survivor' && String(sport).toUpperCase() === 'SOCCER') {
    return NextResponse.json(
      { error: 'Survivor leagues are not available for Soccer. Choose another sport.' },
      { status: 400 }
    );
  }
  let name = nameInput;
  let leagueSize = leagueSizeInput;
  let rosterSize = rosterSizeInput;
  let scoring = scoringInput;
  let isDynasty = isDynastyInput;
  if (name == null || leagueSize == null || scoring == null || isDynasty == null) {
    const { getLeagueDefaults, getScoringDefaults } = await import('@/lib/sport-defaults/SportDefaultsRegistry');
    const leagueDef = getLeagueDefaults(sport as any);
    const scoringDef = getScoringDefaults(sport as any);
    if (name == null) name = leagueDef.default_league_name_pattern;
    if (leagueSize == null) leagueSize = leagueDef.default_team_count;
    if (scoring == null) {
      const isIdp = leagueVariantEffective && ['IDP', 'DYNASTY_IDP'].includes(leagueVariantEffective.toUpperCase());
      scoring = isIdp ? 'IDP' : scoringDef.scoring_format;
    }
    if (isDynasty == null) isDynasty = false;
  }

  try {
    // --- Sleeper full import path ---
    if (createFromSleeperImport && sleeperLeagueId?.trim()) {
      const verifiedAuth = await requireVerifiedUser();
      if (!verifiedAuth.ok) {
        return verifiedAuth.response;
      }

      const cleanSleeperId = sleeperLeagueId.trim();
      const importGate = await assertImportCommissioner({
        appUserId: verifiedAuth.userId,
        provider: 'sleeper',
        sourceLeagueId: cleanSleeperId,
      });
      if (!importGate.ok) {
        return NextResponse.json(
          { error: importGate.reason ?? 'Only the commissioner or co-commissioner can import this league.' },
          { status: 403 }
        );
      }
      const { runImportedLeagueNormalizationPipeline } = await import('@/lib/league-import/ImportedLeagueNormalizationPipeline');
      const result = await runImportedLeagueNormalizationPipeline({
        provider: 'sleeper',
        sourceId: cleanSleeperId,
        userId: verifiedAuth.userId,
      });
      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          {
            status:
              result.code === 'LEAGUE_NOT_FOUND'
                ? 404
                : result.code === 'UNAUTHORIZED'
                  ? 401
                  : result.code === 'CONNECTION_REQUIRED'
                    ? 400
                    : 500,
          }
        );
      }

      const { buildCanonicalImportBundle } = await import('@/lib/league-import/canonicalImportNormalizer');
      const { persistImportWithCanonicalAudit } = await import('@/lib/league-import/importPersistenceService');
      const { ImportedLeagueConflictError } = await import('@/lib/league-import/ImportedLeagueCommitService');

      let persisted:
        | {
            league: { id: string; name: string; sport: string };
            historicalBackfill: unknown;
            importRunId: string;
          }
        | null = null;
      try {
        const canonical = buildCanonicalImportBundle(result.normalized);
        const { persisted: p, runId } = await persistImportWithCanonicalAudit({
          userId: verifiedAuth.userId,
          provider: 'sleeper',
          normalized: result.normalized,
          canonical,
          allowUpdateExisting: false,
        });
        persisted = { ...p, importRunId: runId };
      } catch (error) {
        if (error instanceof ImportedLeagueConflictError) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        throw error;
      }

      const metaEvent = await trackFantasyLeagueLead({
        request: req,
        userId: verifiedAuth.userId,
        email: session?.user?.email ?? null,
        leagueId: persisted.league.id,
        leagueName: persisted.league.name,
        sport: persisted.league.sport,
        leagueType: 'imported',
        draftType: null,
        source: 'sleeper_import_league_create',
      });

      return NextResponse.json({
        league: persisted.league,
        historicalBackfill: persisted.historicalBackfill,
        importRunId: persisted.importRunId,
        metaEvent,
      });
    }

    /**
     * DEPRECATED ROUTE — POST /api/league/create: `platform=manual` native leagues delegate to the same pipeline as
     * POST /api/leagues (`executeCanonicalLeagueCreation`). Do not add a second Prisma `league.create` shell for manual leagues.
     */
    let conceptResolution: Extract<ConceptPresetResolution, { ok: true }> | null = null;
    if (isConceptPresetSport(sport)) {
      const resolved = resolveConceptPreset({
        sport,
        leagueType: requestedLeagueType ?? (isDynasty ? 'dynasty' : 'redraft'),
        scoringPreset: scoringPresetIdInput ?? scoring ?? null,
        draftType: requestedDraftType ?? 'snake',
        modifiers: buildConceptPresetModifiers({
          modifiers,
          isSuperflex,
          isIdpRequested,
          leagueVariant: leagueVariantEffective ?? null,
          requestedLeagueType,
          requestedDraftType,
        }),
        options: {
          allowAdmin:
            process.env.NODE_ENV !== 'production' &&
            ((body as { allowFutureConcepts?: unknown }).allowFutureConcepts === true ||
              (body as { adminConceptPreview?: unknown }).adminConceptPreview === true),
          enabledFeatureFlags: readEnabledConceptFlags(settingsWizard as Record<string, unknown> | undefined),
          userOverrides: asCreateSettingsRecord(settingsWizard?.conceptPresetOverrides),
        },
      });
      if (!resolved.ok) {
        return NextResponse.json(
          {
            success: false,
            error: resolved.message,
            code: resolved.code,
            requiredFeatureFlag: resolved.requiredFeatureFlag ?? null,
            conceptPreset: resolved.preset
              ? {
                  presetKey: resolved.preset.presetKey,
                  readiness: resolved.preset.readiness,
                  visibility: resolved.preset.visibility,
                  isLaunchReady: resolved.preset.isLaunchReady,
                  unsupportedReason: resolved.preset.unsupportedReason ?? null,
                }
              : null,
          },
          { status: resolved.status }
        );
      }
      conceptResolution = resolved;
    }

    if (platform === 'manual' && !createFromSleeperImport) {
      const { clampSurvivorCastSize } = await import('@/lib/league-creation-wizard/sport-team-limits');
      let effectiveLeagueSize = leagueSize as number;
      if (String(requestedLeagueType ?? '').toLowerCase() === 'survivor') {
        const sw = (settingsWizard ?? {}) as Record<string, unknown>;
        const raw =
          typeof sw.league_size === 'number'
            ? Number(sw.league_size)
            : typeof sw.survivor_creation_team_count === 'number'
              ? Number(sw.survivor_creation_team_count)
              : effectiveLeagueSize;
        effectiveLeagueSize = clampSurvivorCastSize(raw);
        const feeMode = String(sw.survivor_entry_fee_mode ?? 'free')
          .toLowerCase()
          .trim();
        if (feeMode === 'paid') {
          const centsRaw = sw.survivor_entry_fee_amount_cents;
          const cents = typeof centsRaw === 'number' ? centsRaw : Number(centsRaw);
          if (!Number.isFinite(cents) || cents < 1) {
            return NextResponse.json(
              {
                success: false,
                error:
                  'Paid Survivor leagues require a buy-in amount greater than zero (set by the commissioner).',
                errors: [{ path: 'survivor_entry_fee_amount_cents', message: 'Invalid buy-in amount' }],
              },
              { status: 400 }
            );
          }
        }
      }

      const isGuillotineEarly =
        String(leagueVariantEffective ?? '').toLowerCase() === 'guillotine' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'guillotine';
      if (isGuillotineEarly) {
        const { validateGuillotineCreation } = await import('@/lib/guillotine/GuillotineValidation');
        const sw = (settingsWizard ?? {}) as Record<string, unknown>;
        const teamCountFromSettings =
          typeof sw.teamCount === 'number'
            ? sw.teamCount
            : typeof sw.leagueSize === 'number'
              ? sw.leagueSize
              : undefined;
        const leagueSizeG = teamCountFromSettings ?? effectiveLeagueSize;
        const rosterMode = String(sw.roster_mode ?? sw.mode ?? 'redraft').toLowerCase().trim();
        const draftTypeGuillotine = (sw.requested_draft_type ?? sw.draft_type ?? requestedDraftType) as
          | string
          | undefined;
        const gResult = await validateGuillotineCreation({
          sport,
          teamCount: leagueSizeG,
          rosterMode,
          draftType: draftTypeGuillotine,
        });
        if (!gResult.valid) {
          return NextResponse.json(
            {
              success: false,
              error: gResult.error ?? 'Invalid guillotine league',
              errors: [{ path: 'guillotine', message: gResult.error ?? '' }],
            },
            { status: 400 }
          );
        }
      }

      const rawCanonical = buildLegacyManualCanonicalCreatePayload({
        sport,
        leagueName: name as string,
        teamCount: effectiveLeagueSize,
        requestedLeagueType,
        requestedDraftType,
        scoringPresetIdInput,
        soccerPipelineInput,
        settingsWizard: settingsWizard as Record<string, unknown> | undefined,
        isIdpRequested,
        legacyScoringLabel: scoring != null ? String(scoring) : undefined,
        preferDynastyConcept: isDynasty === true,
      });
      const sanitizedCanonical = stripForbiddenCreateLeagueFields(rawCanonical);
      const validatedCanonical = validateCreatePayload(sanitizedCanonical.body);
      if (!validatedCanonical.ok) {
        return NextResponse.json(
          {
            success: false,
            error: validatedCanonical.error,
            errors: validatedCanonical.errors.map((e) => ({
              path: e.path,
              message: e.message,
              code: e.code,
            })),
          },
          { status: validatedCanonical.status }
        );
      }
      const resolvedForCreate = await resolveAppUserIdForLeagueCreate({ id: userId });
      if (!resolvedForCreate.ok) {
        return NextResponse.json(
          {
            success: false,
            error: 'Authenticated user not found in app_users',
            errors: [{ path: 'session', message: 'No matching AppUser for this session.' }],
          },
          { status: 403 }
        );
      }
      const exec = await executeCanonicalLeagueCreation({
        appUserId: resolvedForCreate.appUserId,
        body: validatedCanonical.data,
      });
      if (!exec.ok) {
        return NextResponse.json(exec.response, { status: exec.status });
      }

      const leagueAfter = await prisma.league.findUnique({
        where: { id: exec.response.league.id },
      });
      if (!leagueAfter) {
        return NextResponse.json(
          {
            success: false,
            error: 'League not found after creation',
            errors: [{ path: 'database', message: 'Missing league row after canonical create' }],
          },
          { status: 500 }
        );
      }

      const leagueAfterSettings = asCreateSettingsRecord(leagueAfter.settings) ?? {};
      const conceptMergedLeagueSettings = conceptResolution
        ? mergeConceptPresetSettings(conceptResolution.settingsSnapshot, leagueAfterSettings)
        : leagueAfterSettings;
      if (conceptResolution) {
        await prisma.league.update({
          where: { id: leagueAfter.id },
          data: {
            settings: toPrismaJsonInput(conceptMergedLeagueSettings),
          },
        });
      }

      const initialMerged: Record<string, unknown> = {
        ...conceptMergedLeagueSettings,
        ...((settingsWizard ?? {}) as Record<string, unknown>),
      };

      const isGuillotine =
        String(leagueVariantEffective ?? '').toLowerCase() === 'guillotine' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'guillotine';
      const isSalaryCap =
        String(leagueVariantEffective ?? '').toLowerCase() === 'salary_cap' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'salary_cap';
      const isSurvivor =
        String(leagueVariantEffective ?? '').toLowerCase() === 'survivor' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'survivor';
      const isDevy =
        String(leagueVariantEffective ?? '').toLowerCase() === 'devy_dynasty' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'devy';
      const isC2C =
        String(leagueVariantEffective ?? '').toLowerCase() === 'merged_devy_c2c' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'c2c';
      const isBigBrother =
        String(leagueVariantEffective ?? '').toLowerCase() === 'big_brother' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'big_brother';
      const isZombie =
        String(leagueVariantEffective ?? '').toLowerCase() === 'zombie' ||
        String(requestedLeagueType ?? '').toLowerCase() === 'zombie';
      const effectiveDynasty = isGuillotine ? false : isDevy || isC2C ? true : isDynasty === true;

      await runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate({
        league: {
          id: leagueAfter.id,
          name: leagueAfter.name,
          sport: String(leagueAfter.sport),
          leagueSize: leagueAfter.leagueSize,
        },
        userId,
        name,
        sport,
        settingsWizard: settingsWizard as Record<string, unknown> | undefined,
        initialSettings: initialMerged,
        flags: {
          isGuillotine,
          isSalaryCap,
          isSurvivor,
          isZombie,
          isDevy,
          isBigBrother,
          isC2C,
          effectiveDynasty,
          isIdpRequested,
        },
        requestedDraftType,
      });

      const legacyBody = mapCanonicalSuccessToLegacyLeagueCreateResponse(exec.response, {
        createdVia: 'canonical_pipeline',
      });
      const metaEvent = await trackFantasyLeagueLead({
        request: req,
        userId: resolvedForCreate.appUserId,
        email: session?.user?.email ?? null,
        leagueId: legacyBody.league.id,
        leagueName: legacyBody.league.name,
        sport: legacyBody.league.sport,
        leagueType: legacyBody.league.concept,
        draftType: legacyBody.league.draftType,
        source: 'legacy_manual_canonical_league_create',
      });
      return NextResponse.json({ ...legacyBody, metaEvent }, {
        headers: {
          'X-Create-League-Pipeline': 'canonical',
          'X-Deprecated-Route': 'true',
        },
      });
    }

    // --- Native creation path (legacy Prisma shell — external platforms; manual uses canonical pipeline above) ---
    if (platformLeagueId && platform !== 'manual') {
      const existing = await (prisma as any).league.findFirst({
        where: {
          userId,
          platform,
          platformLeagueId,
        },
      });

      if (existing) {
        return NextResponse.json({ error: 'This league already exists in your account' }, { status: 409 });
      }
    }

    const { getCreationPayloadAndSettings } = await import('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator');
    const presetVariant =
      resolveEffectiveLeagueVariant({
        sport,
        leagueType: requestedLeagueType ?? null,
        requestedVariant: leagueVariantEffective ?? null,
      }).variant ?? undefined;
    const effectiveDynastyForCreation = isDevyRequested || isC2CRequested || (isDynasty === true);
    const {
      payload: creationPayload,
      initialSettings: initialSettingsFromOrchestrator,
    } = await getCreationPayloadAndSettings(
      sport as string,
      presetVariant,
      {
        superflex: isSuperflex ?? false,
        roster_mode: effectiveDynastyForCreation ? 'dynasty' : (isDynasty ? 'dynasty' : undefined),
      }
    );
    const initialSettings = {
      ...(initialSettingsFromOrchestrator as Record<string, unknown>),
    } as Record<string, unknown>;
    const formatResolution = resolveLeagueFormat({
      sport,
      leagueType: requestedLeagueType,
      draftType: requestedDraftType,
      leagueVariant: leagueVariantEffective,
      requestedModifiers: modifiers ?? [],
    });
    if (presetVariant === 'devy_dynasty' || presetVariant === 'merged_devy_c2c') {
      (initialSettings as Record<string, unknown>).roster_mode = 'dynasty';
    }
    if (presetVariant === 'devy_dynasty') {
      let dc = initialSettings.devyConfig as Record<string, unknown> | undefined;
      if (dc == null || typeof dc !== 'object') dc = {};
      if (!Array.isArray(dc.devyRounds) || (dc.devyRounds as unknown[]).length === 0) {
        dc.devyRounds = [1, 2, 3, 4];
      }
      initialSettings.devyConfig = dc;
    }
    if (presetVariant === 'merged_devy_c2c') {
      let cc = initialSettings.c2cConfig as Record<string, unknown> | undefined;
      if (cc == null || typeof cc !== 'object') cc = {};
      if (!Array.isArray(cc.collegeRounds) || (cc.collegeRounds as unknown[]).length === 0) {
        cc.collegeRounds = [1, 2, 3, 4, 5, 6];
      }
      initialSettings.c2cConfig = cc;
      let dc = initialSettings.devyConfig as Record<string, unknown> | undefined;
      if (dc == null || typeof dc !== 'object') dc = {};
      if (!Array.isArray(dc.devyRounds) || (dc.devyRounds as unknown[]).length === 0) {
        dc.devyRounds = [1, 2, 3, 4];
      }
      initialSettings.devyConfig = dc;
    }
    if (requestedLeagueType) initialSettings.league_type = requestedLeagueType;
    initialSettings.format_id = formatResolution.format.id;
    initialSettings.format_modifiers = formatResolution.modifiers;
    const requestedMockDraft = requestedDraftType === 'mock_draft';
    if (requestedDraftType) {
      initialSettings.draft_type = requestedMockDraft ? 'snake' : requestedDraftType;
      initialSettings.requested_draft_type = requestedDraftType;
    }
    if (requestedMockDraft) {
      initialSettings.mock_draft_enabled = true;
      initialSettings.mock_draft_type = 'mock_draft';
    }
    if (rosterSize != null && initialSettings.roster_size == null) initialSettings.roster_size = rosterSize;
    if (initialSettings.scoring_template_id == null) {
      initialSettings.scoring_template_id = formatResolution.scoring.scoringTemplateId;
    }
    if (initialSettings.scoring_format == null) {
      initialSettings.scoring_format = formatResolution.scoring.scoringFormat;
    }
    if (initialSettings.scoring_mode == null) {
      initialSettings.scoring_mode = formatResolution.scoring.defaultMode;
    }
    // Best ball: set flag so feature-flag validation and downstream logic see best ball mode
    if (String(requestedLeagueType ?? '').toLowerCase() === 'best_ball') {
      (initialSettings as Record<string, unknown>).best_ball = true;
    }
    // Standard redraft: ensure no dynasty-only settings leak in (defense in depth with validation)
    if (String(requestedLeagueType ?? '').toLowerCase() === 'redraft') {
      initialSettings.roster_mode = 'redraft';
      initialSettings.taxi_slots = 0;
      initialSettings.taxi = false;
      if (initialSettings.devyConfig && typeof initialSettings.devyConfig === 'object') {
        (initialSettings.devyConfig as Record<string, unknown>).enabled = false;
      }
      if (initialSettings.c2cConfig && typeof initialSettings.c2cConfig === 'object') {
        (initialSettings.c2cConfig as Record<string, unknown>).enabled = false;
      }
    }
    if (settingsWizard && typeof settingsWizard === 'object') {
      Object.assign(initialSettings, settingsWizard);
    }
    if (scoringPresetIdInput?.trim()) {
      (initialSettings as Record<string, unknown>).scoring_preset_id = scoringPresetIdInput.trim();
    }
    if (rosterSettings && typeof rosterSettings === 'object') {
      Object.assign(initialSettings, rosterSettings);
    }
    if (scoringSettings && typeof scoringSettings === 'object') {
      Object.assign(initialSettings, scoringSettings);
    }

    // Normalize category-scoring fields to the flat snake_case keys used by
    // `ScoringSettingsSnapshot.scoringMode` and `settings.category_preset_id`.
    // Top-level `scoringModeInput` wins over anything carried in
    // `scoringSettings`; `scoringSettings.scoringMode` (preset-derived) wins
    // over the default set earlier. Category preset id is validated here so
    // unknown ids never reach persistence.
    const preMergeScoringMode = scoringModeInput
      ?? (typeof initialSettings.scoringMode === 'string' ? initialSettings.scoringMode : undefined)
      ?? (typeof initialSettings.scoring_mode === 'string' ? initialSettings.scoring_mode : undefined);
    if (preMergeScoringMode === 'points' || preMergeScoringMode === 'h2h_category' || preMergeScoringMode === 'roto') {
      initialSettings.scoring_mode = preMergeScoringMode;
    }
    const preMergeCategoryPresetId = categoryPresetIdInput
      ?? (typeof initialSettings.categoryPresetId === 'string' ? initialSettings.categoryPresetId : undefined)
      ?? (typeof initialSettings.category_preset_id === 'string' ? initialSettings.category_preset_id : undefined);
    if (preMergeCategoryPresetId) {
      if (!isCategoryPresetId(preMergeCategoryPresetId)) {
        return NextResponse.json(
          { error: `Unsupported categoryPresetId: ${preMergeCategoryPresetId}` },
          { status: 400 },
        );
      }
      initialSettings.category_preset_id = preMergeCategoryPresetId;
    }
    // Clean up camelCase duplicates so the persisted settings snapshot uses
    // only the canonical snake_case keys.
    delete (initialSettings as Record<string, unknown>).scoringMode;
    delete (initialSettings as Record<string, unknown>).categoryPresetId;
    if (initialSettings.scoring_mode === 'h2h_category' || initialSettings.scoring_mode === 'roto') {
      if (!initialSettings.category_preset_id) {
        return NextResponse.json(
          { error: 'categoryPresetId is required when scoringMode is h2h_category or roto.' },
          { status: 400 },
        );
      }
    }
    if (rules && typeof rules === 'object') {
      Object.assign(initialSettings, rules);
    }
    if (introVideo && typeof introVideo === 'object') {
      initialSettings.intro_video = introVideo;
    }
    if (keeperSettings && typeof keeperSettings === 'object') {
      initialSettings.keeper_settings = keeperSettings;
    }
    if (salaryCapSettings && typeof salaryCapSettings === 'object') {
      initialSettings.salary_cap_settings = salaryCapSettings;
    }
    if (inviteSettings && typeof inviteSettings === 'object') {
      initialSettings.invite_settings = inviteSettings;
    }

    if (sport === 'SOCCER') {
      const fromSettings = (initialSettings as Record<string, unknown>).soccer_pipeline;
      const raw = soccerPipelineInput ?? fromSettings;
      const pipeline = raw === 'mls' || raw === 'euro' ? raw : 'euro';
      (initialSettings as Record<string, unknown>).soccer_pipeline = pipeline;
    }

    // Ensure sport/variant defaults from orchestrator payload are always present unless explicitly overridden.
    {
      const draftDefaults = creationPayload.draft;
      const waiverDefaults = creationPayload.waiver;

      if (initialSettings.draft_type == null) initialSettings.draft_type = draftDefaults.draft_type;
      if (initialSettings.draft_rounds == null) initialSettings.draft_rounds = draftDefaults.rounds_default;
      if (initialSettings.draft_timer_seconds == null) initialSettings.draft_timer_seconds = draftDefaults.timer_seconds_default;
      if (initialSettings.draft_pick_order_rules == null) initialSettings.draft_pick_order_rules = draftDefaults.pick_order_rules;
      if (initialSettings.draft_third_round_reversal == null) initialSettings.draft_third_round_reversal = draftDefaults.third_round_reversal ?? false;

      if (initialSettings.waiver_type == null) initialSettings.waiver_type = waiverDefaults.waiver_type;
      if (initialSettings.waiver_processing_days == null) initialSettings.waiver_processing_days = waiverDefaults.processing_days;
      if (initialSettings.faab_budget == null && waiverDefaults.FAAB_budget_default != null) {
        initialSettings.faab_budget = waiverDefaults.FAAB_budget_default;
      }
      if (initialSettings.waiver_processing_time_utc == null && waiverDefaults.processing_time_utc != null) {
        initialSettings.waiver_processing_time_utc = waiverDefaults.processing_time_utc;
      }
      if (initialSettings.waiver_claim_priority_behavior == null && waiverDefaults.claim_priority_behavior != null) {
        initialSettings.waiver_claim_priority_behavior = waiverDefaults.claim_priority_behavior;
      }
      if (initialSettings.waiver_game_lock_behavior == null && waiverDefaults.game_lock_behavior != null) {
        initialSettings.waiver_game_lock_behavior = waiverDefaults.game_lock_behavior;
      }
      if (
        String(requestedLeagueType ?? initialSettings.league_type ?? '').toLowerCase() === 'redraft' &&
        (sport === 'NFL' || sport === 'NCAAF')
      ) {
        const normalizedRedraftSettings = normalizeRedraftSettingsSnapshot({
          sport,
          draftType: requestedDraftType ?? initialSettings.requested_draft_type ?? initialSettings.draft_type,
          scoringPresetId:
            scoringPresetIdInput?.trim() ||
            (typeof initialSettings.scoring_preset_id === 'string' ? initialSettings.scoring_preset_id : null),
          teamCount: typeof leagueSize === 'number' ? leagueSize : null,
          settings: initialSettings,
        });
        Object.assign(initialSettings, normalizedRedraftSettings);
      }
      if (
        String(requestedLeagueType ?? initialSettings.league_type ?? '').toLowerCase() === 'keeper' &&
        (sport === 'NFL' || sport === 'NCAAF')
      ) {
        const normalizedKeeperSettings = normalizeKeeperSettingsSnapshot({
          sport,
          draftType: requestedDraftType ?? initialSettings.requested_draft_type ?? initialSettings.draft_type,
          scoringPresetId:
            scoringPresetIdInput?.trim() ||
            (typeof initialSettings.scoring_preset_id === 'string' ? initialSettings.scoring_preset_id : null),
          teamCount: typeof leagueSize === 'number' ? leagueSize : null,
          settings: initialSettings,
        });
        Object.assign(initialSettings, normalizedKeeperSettings);
      }
      if (
        String(requestedLeagueType ?? initialSettings.league_type ?? '').toLowerCase() === 'devy' &&
        (sport === 'NFL' || sport === 'NCAAF')
      ) {
        const normalizedDevySettings = normalizeDevySettingsSnapshot({
          sport,
          draftType: requestedDraftType ?? initialSettings.requested_draft_type ?? initialSettings.draft_type,
          scoringPresetId:
            scoringPresetIdInput?.trim() ||
            (typeof initialSettings.scoring_preset_id === 'string' ? initialSettings.scoring_preset_id : null),
          teamCount: typeof leagueSize === 'number' ? leagueSize : null,
          settings: initialSettings,
        });
        Object.assign(initialSettings, normalizedDevySettings);
      }
    }

    // Survivor: cast size 16/20/24 only — align Prisma `leagueSize` + settings JSON (wizard may send size only under settings).
    if (String(requestedLeagueType ?? '').toLowerCase() === 'survivor') {
      const { clampSurvivorCastSize } = await import('@/lib/league-creation-wizard/sport-team-limits');
      const raw =
        typeof (initialSettings as Record<string, unknown>).league_size === 'number'
          ? Number((initialSettings as Record<string, unknown>).league_size)
          : typeof (initialSettings as Record<string, unknown>).survivor_creation_team_count === 'number'
            ? Number((initialSettings as Record<string, unknown>).survivor_creation_team_count)
            : typeof leagueSize === 'number'
              ? leagueSize
              : 20;
      const cast = clampSurvivorCastSize(raw);
      leagueSize = cast;
      (initialSettings as Record<string, unknown>).league_size = cast;
      (initialSettings as Record<string, unknown>).survivor_creation_team_count = cast;
      (initialSettings as Record<string, unknown>).teamCount = cast;
      initialSettings.roster_mode = 'redraft';
      const feeMode = String((initialSettings as Record<string, unknown>).survivor_entry_fee_mode ?? 'free')
        .toLowerCase()
        .trim();
      if (feeMode === 'paid') {
        const centsRaw = (initialSettings as Record<string, unknown>).survivor_entry_fee_amount_cents;
        const cents = typeof centsRaw === 'number' ? centsRaw : Number(centsRaw);
        if (!Number.isFinite(cents) || cents < 1) {
          return NextResponse.json(
            { error: 'Paid Survivor leagues require a buy-in amount greater than zero (set by the commissioner).' },
            { status: 400 }
          );
        }
      }
    }

    const generatedInviteCode = (await import('crypto')).randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const resolvedInviteCode =
      typeof initialSettings.inviteCode === 'string' && initialSettings.inviteCode.trim()
        ? initialSettings.inviteCode.trim()
        : generatedInviteCode;
    initialSettings.inviteCode = resolvedInviteCode;
    if (!initialSettings.inviteLink) {
      initialSettings.inviteLink = buildLeagueInviteUrl(resolvedInviteCode, { params: { utm_campaign: 'league_invite' } });
    }
    const isGuillotineEarly =
      String(leagueVariantEffective ?? '').toLowerCase() === 'guillotine' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'guillotine';
    if (isGuillotineEarly) {
      const { validateGuillotineCreation, normalizeGuillotineRosterMode } = await import('@/lib/guillotine/GuillotineValidation');
      const teamCountFromSettings = typeof initialSettings.teamCount === 'number' ? initialSettings.teamCount : typeof initialSettings.leagueSize === 'number' ? initialSettings.leagueSize : undefined;
      if (teamCountFromSettings != null) leagueSize = teamCountFromSettings;
      const rosterMode = String(initialSettings.roster_mode ?? initialSettings.mode ?? 'redraft').toLowerCase().trim();
      const draftType = (initialSettings.requested_draft_type ?? initialSettings.draft_type ?? requestedDraftType) as string | undefined;
      const result = await validateGuillotineCreation({ sport, teamCount: leagueSize, rosterMode, draftType });
      if (!result.valid) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      const normalizedRosterMode = normalizeGuillotineRosterMode(rosterMode);
      (initialSettings as Record<string, unknown>).roster_mode = normalizedRosterMode;
      if (normalizedRosterMode === 'best_ball') (initialSettings as Record<string, unknown>).best_ball = true;
    }
    // Devy: validator expects `devy_slots` and non-empty `devy_rounds`; align aliases from the wizard payload.
    {
      const lt = String(initialSettings.league_type ?? (initialSettings as Record<string, unknown>).leagueType ?? '').toLowerCase();
      const isDevyCreate =
        lt === 'devy' || String(leagueVariantEffective ?? '').toLowerCase() === 'devy_dynasty';
      if (isDevyCreate) {
        const s = initialSettings as Record<string, unknown>;
        const fromCollege =
          typeof s.devy_college_slots_creation === 'number' && Number.isFinite(s.devy_college_slots_creation)
            ? s.devy_college_slots_creation
            : null;
        const existing =
          typeof s.devy_slots === 'number' && Number.isFinite(s.devy_slots)
            ? s.devy_slots
            : typeof s.devySlots === 'number' && Number.isFinite(s.devySlots)
              ? s.devySlots
              : null;
        const resolved = existing ?? fromCollege;
        if (resolved != null && resolved > 0) {
          s.devy_slots = Math.max(1, Math.floor(resolved));
        }
        const dr = s.devy_rounds ?? s.devyRounds;
        if (!Array.isArray(dr) || dr.length === 0) {
          const configuredRounds = Number(
            s.devy_draft_rounds ??
              ((s.devyConfig && typeof s.devyConfig === 'object')
                ? (s.devyConfig as Record<string, unknown>).devyDraftRounds
                : undefined) ??
              4,
          );
          const safeRounds = Number.isFinite(configuredRounds) && configuredRounds > 0 ? Math.floor(configuredRounds) : 4;
          s.devy_rounds = Array.from({ length: safeRounds }, (_, idx) => idx + 1);
        }
      }
    }

    // C2C: validator needs college rounds + pool size; align wizard `*_creation` aliases.
    {
      const lt = String(initialSettings.league_type ?? (initialSettings as Record<string, unknown>).leagueType ?? '').toLowerCase();
      const isC2cCreate =
        lt === 'c2c' || String(leagueVariantEffective ?? '').toLowerCase() === 'merged_devy_c2c';
      if (isC2cCreate) {
        const s = initialSettings as Record<string, unknown>;
        const fromCreation =
          typeof s.c2c_college_slots_creation === 'number' && Number.isFinite(s.c2c_college_slots_creation)
            ? s.c2c_college_slots_creation
            : null;
        const existing =
          typeof s.c2c_college_roster_size === 'number' && Number.isFinite(s.c2c_college_roster_size)
            ? s.c2c_college_roster_size
            : typeof s.c2cCollegeRosterSize === 'number' && Number.isFinite(s.c2cCollegeRosterSize)
              ? s.c2cCollegeRosterSize
              : null;
        const resolved = existing ?? fromCreation;
        if (resolved != null && resolved > 0) {
          s.c2c_college_roster_size = Math.max(1, Math.floor(resolved));
        }
        const cr = s.c2c_college_rounds ?? s.c2cCollegeRounds;
        if (!Array.isArray(cr) || cr.length === 0) {
          s.c2c_college_rounds = [1];
        }
      }
    }

    const { validateLeagueSettings } = await import('@/lib/league-settings-validation');
    const validation = validateLeagueSettings(initialSettings);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] ?? 'Invalid league configuration', errors: validation.errors },
        { status: 400 }
      );
    }
    const { validateLeagueFeatureFlags } = await import('@/lib/sport-defaults/SportFeatureFlagsService');
    const requestedFlags: Partial<Record<string, boolean>> = {
      supportsSuperflex: initialSettings.superflex === true,
      supportsBestBall: initialSettings.best_ball === true,
      supportsTePremium: initialSettings.te_premium === true,
      supportsKickers: initialSettings.use_kickers === true,
      supportsTeamDefense: initialSettings.use_team_defense === true,
      supportsIdp: isIdpRequested,
      supportsDevy: (initialSettings.devy === true || String(requestedLeagueType ?? leagueVariantEffective ?? '').toLowerCase() === 'devy' || String(leagueVariantEffective ?? '').toLowerCase() === 'devy_dynasty'),
      supportsTaxi: (initialSettings.taxi_slots as number) > 0 || initialSettings.taxi === true,
      supportsIr: (initialSettings.ir_slots as number) > 0 || initialSettings.ir === true,
      supportsBracketMode: initialSettings.bracket_mode === true,
      supportsDailyLineups: initialSettings.daily_lineups === true || initialSettings.lineup_lock === 'daily',
    };
    const flagValidation = await validateLeagueFeatureFlags(sport, requestedFlags as any);
    if (!flagValidation.valid && flagValidation.disallowed?.length) {
      return NextResponse.json(
        {
          error: `Sport ${sport} does not support: ${flagValidation.disallowed.join(', ')}`,
          disallowedFlags: flagValidation.disallowed,
        },
        { status: 400 }
      );
    }
    const isGuillotine =
      String(leagueVariantEffective ?? '').toLowerCase() === 'guillotine' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'guillotine';
    const isSalaryCap =
      String(leagueVariantEffective ?? '').toLowerCase() === 'salary_cap' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'salary_cap';
    const isSurvivor =
      String(leagueVariantEffective ?? '').toLowerCase() === 'survivor' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'survivor';
    const isDevy =
      String(leagueVariantEffective ?? '').toLowerCase() === 'devy_dynasty' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'devy';
    const isC2C =
      String(leagueVariantEffective ?? '').toLowerCase() === 'merged_devy_c2c' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'c2c';
    const isBigBrother =
      String(leagueVariantEffective ?? '').toLowerCase() === 'big_brother' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'big_brother';
    const isZombie =
      String(leagueVariantEffective ?? '').toLowerCase() === 'zombie' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'zombie';
    const effectiveDynasty = isGuillotine ? false : (isDevy || isC2C ? true : isDynasty);
    const resolvedVariant = isGuillotine ? 'guillotine' : isSalaryCap ? 'salary_cap' : isSurvivor ? 'survivor' : isC2C ? 'merged_devy_c2c' : isDevy ? 'devy_dynasty' : isBigBrother ? 'big_brother' : isZombie ? 'zombie' : isIdpRequested ? (effectiveDynasty ? 'DYNASTY_IDP' : 'IDP') : (leagueVariantEffective ?? null);
    // Canonical cross-module keys used by multi-sport services and downstream UIs.
    initialSettings.sport_type = sport;
    initialSettings.league_variant = resolvedVariant ?? null;
    try {
      const { tryGetSportConfig } = await import('@/lib/sportConfig');
      const scfg = tryGetSportConfig(sport as string);
      if (scfg) {
        initialSettings.sportConfig = {
          ...(typeof initialSettings.sportConfig === 'object' && initialSettings.sportConfig !== null
            ? (initialSettings.sportConfig as object)
            : {}),
          scoringPreset: scfg.sport === 'NFL' ? 'PPR' : 'CUSTOM',
          seasonWeeks: scfg.defaultSeasonWeeks,
          playoffStartWeek: scfg.defaultPlayoffStartWeek,
          playoffTeams: scfg.defaultPlayoffTeams,
          seededFromSportConfigAt: new Date().toISOString(),
        };
      }
    } catch {
      /* non-fatal */
    }
    const foundingSeason = new Date().getFullYear();
    if (effectiveDynasty) {
      (initialSettings as Record<string, unknown>).startup_season = foundingSeason;
    }
    const leagueTimezone =
      typeof (initialSettings as Record<string, unknown>).league_timezone === 'string' &&
      String((initialSettings as Record<string, unknown>).league_timezone).trim().length > 0
        ? String((initialSettings as Record<string, unknown>).league_timezone).trim()
        : 'America/New_York';

    const isSurvivorLeague =
      String(leagueVariantEffective ?? '').toLowerCase() === 'survivor' ||
      String(requestedLeagueType ?? '').toLowerCase() === 'survivor';
    const survivorTribeCountColumn =
      isSurvivorLeague &&
      typeof (initialSettings as Record<string, unknown>).survivor_suggested_tribe_count === 'number'
        ? Math.max(2, Math.min(4, Math.round(Number((initialSettings as Record<string, unknown>).survivor_suggested_tribe_count))))
        : 4;
    const survivorTribeNamingColumn =
      isSurvivorLeague &&
      String((initialSettings as Record<string, unknown>).survivor_tribe_name_mode ?? 'auto') === 'custom'
        ? 'custom'
        : 'auto';

    if (conceptResolution) {
      const mergedConceptSettings = mergeConceptPresetSettings(
        conceptResolution.settingsSnapshot,
        initialSettings as Record<string, unknown>
      );
      Object.assign(initialSettings, mergedConceptSettings);
    }
    const survivorFoundationSettings = isSurvivorLeague
      ? normalizeSurvivorFoundationSettings(initialSettings as Record<string, unknown>)
      : null;
    const survivorColumnPatch = survivorFoundationSettings
      ? buildSurvivorLeagueColumnPatch(survivorFoundationSettings)
      : null;
    if (survivorFoundationSettings) {
      Object.assign(
        initialSettings,
        buildSurvivorSettingsSnapshotPatch(survivorFoundationSettings as unknown as Record<string, unknown>),
      );
    }

    (initialSettings as Record<string, unknown>).snapshotVersion = SETTINGS_SNAPSHOT_VERSION;

    const presetKeyCanonical = scoringPresetIdInput?.trim()
      ? buildPresetKey({
          concept: String(requestedLeagueType ?? 'redraft'),
          sport,
          scoringPresetId: scoringPresetIdInput.trim(),
          draftType: String(requestedDraftType ?? 'snake'),
          teamCount: typeof leagueSize === 'number' ? leagueSize : undefined,
        })
      : undefined;

    const league = await (prisma as any).league.create({
      data: {
        userId: userId,
        isCommissioner: true,
        name,
        platform,
        platformLeagueId: platformLeagueId || `manual-${Date.now()}`,
        leagueSize,
        rosterSize: typeof rosterSize === 'number' ? rosterSize : undefined,
        scoring,
        isDynasty: effectiveDynasty,
        sport,
        leagueVariant: resolvedVariant,
        ...(requestedLeagueType ? { leagueType: requestedLeagueType } : {}),
        avatarUrl: isGuillotine ? '/guillotine/Guillotine.png' : undefined,
        timezone: leagueTimezone,
        settings: initialSettings,
        ...(presetKeyCanonical ? { presetKey: presetKeyCanonical } : {}),
        ...(scoringPresetIdInput?.trim() ? { scoringPresetId: scoringPresetIdInput.trim() } : {}),
        settingsSnapshotVersion: SETTINGS_SNAPSHOT_VERSION,
        syncStatus: platform === 'manual' ? 'manual' : 'pending',
        /** List rail shows `League.season`; redraft/survivor/etc. must not inherit Prisma's stale default (2024). */
        season: foundingSeason,
        ...(isSurvivorLeague && survivorColumnPatch
          ? {
              ...survivorColumnPatch,
              survivorTribeNaming: survivorTribeNamingColumn,
            }
          : {}),
      },
    });

    try {
      const { runPostCreateInitialization } = await import('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator');
      await runPostCreateInitialization(league.id, sport as string, resolvedVariant ?? leagueVariantEffective ?? undefined);
    } catch (err) {
      console.warn('[league/create] Bootstrap non-fatal:', err);
    }

    if (platform === 'manual') {
      try {
        const profile = await prisma.userProfile.findUnique({
          where: { userId: userId },
          select: { displayName: true, sleeperUsername: true },
        });
        const displayName =
          profile?.displayName?.trim() ||
          profile?.sleeperUsername?.trim() ||
          'Commissioner';
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const existingRoster = await tx.roster.findUnique({
            where: {
              leagueId_platformUserId: { leagueId: league.id, platformUserId: userId },
            },
          });
          let rosterId = existingRoster?.id;
          if (!rosterId) {
            const r = await tx.roster.create({
              data: {
                leagueId: league.id,
                platformUserId: userId,
                playerData: { draftPicks: [] },
              },
            });
            rosterId = r.id;
          }
          const hasTeam = await tx.leagueTeam.findFirst({
            where: { leagueId: league.id, claimedByUserId: userId },
          });
          if (!hasTeam) {
            const leagueName = String(name ?? 'League').trim();
            await tx.leagueTeam.create({
              data: {
                leagueId: league.id,
                externalId: rosterId,
                ownerName: displayName,
                teamName: `${displayName}'s Team`,
                claimedByUserId: userId,
                platformUserId: userId,
                isCommissioner: true,
                role: 'commissioner',
              },
            });
          }
        });
      } catch (err) {
        console.warn('[league/create] Commissioner team attach non-fatal:', err);
      }
    }
    try {
      const { generateLeagueConstitutionArtifact } = await import('@/lib/league/format-artifact-service');
      await generateLeagueConstitutionArtifact(league.id);
    } catch (err) {
      console.warn('[league/create] Constitution artifact bootstrap non-fatal:', err);
    }

    await runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate({
      league: {
        id: league.id,
        name: league.name,
        sport: String(league.sport),
        leagueSize: league.leagueSize,
      },
      userId,
      name,
      sport,
      settingsWizard: settingsWizard as Record<string, unknown> | undefined,
      initialSettings: initialSettings as Record<string, unknown>,
      flags: {
        isGuillotine,
        isSalaryCap,
        isSurvivor,
        isZombie,
        isDevy,
        isBigBrother,
        isC2C,
        effectiveDynasty,
        isIdpRequested,
      },
      requestedDraftType,
    });

    if (String(requestedLeagueType ?? '').toLowerCase() === 'keeper') {
      try {
        const { mapKeeperCreationFromWizard } = await import('@/lib/keeper/mapKeeperCreationFromWizard');
        const kp = mapKeeperCreationFromWizard({
          draftType: String(
            requestedDraftType ?? (initialSettings as Record<string, unknown>).draft_type ?? 'snake',
          ),
          settings: initialSettings as Record<string, unknown>,
          keeperSettings:
            keeperSettings && typeof keeperSettings === 'object'
              ? (keeperSettings as Record<string, unknown>)
              : undefined,
          conceptSetup: null,
        });
        await prisma.league.update({ where: { id: league.id }, data: kp.league });
        const ds = await prisma.draftSession.updateMany({
          where: { leagueId: league.id },
          data: {
            keeperConfig: kp.draftKeeperConfig as object,
            keeperSelections: [],
          },
        });
        if (ds.count === 0) {
          console.warn('[league/create] keeper: no DraftSession row to attach keeperConfig', league.id);
        }
      } catch (err) {
        console.warn('[league/create] keeper bootstrap sync non-fatal:', err);
      }
    }

    const metaEvent = await trackFantasyLeagueLead({
      request: req,
      userId,
      email: session?.user?.email ?? null,
      leagueId: league.id,
      leagueName: league.name,
      sport: league.sport,
      leagueType: String(leagueVariantEffective ?? requestedLeagueType ?? league.type ?? 'league'),
      draftType: String(requestedDraftType ?? (initialSettings as Record<string, unknown>).draft_type ?? ''),
      source: 'legacy_native_league_create',
    });

    return NextResponse.json({
      success: true,
      league: { id: league.id, name: league.name, sport: league.sport },
      metaEvent,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error('[league/create] Error:', errMsg, errStack);
    return NextResponse.json({ error: `Failed to create league: ${errMsg}` }, { status: 500 });
  }
}
