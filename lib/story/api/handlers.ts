/**
 * G15.13 — Story API handler cores.
 *
 * Pure-ish handlers with INJECTED dependencies (session, league access checks, the Story Engine,
 * an optional story feature gate) so they unit-test without Next plumbing or a DB. Route files are
 * thin wrappers that supply real deps. The StoryEngine is the ONLY source of story data — handlers
 * never touch prisma / provider / raw events, and never duplicate story-generation logic.
 *
 * Permission model:
 *   - member-readable:      what_happened_recently, activity_report, weekly_recap
 *   - commissioner-only:    commissioner_summary, health_narrative
 * Feature-gate denial surfaces as 402 (upgrade_required) / 403 (deny).
 */
import { STORY_SAFETY_NOTE } from '../storyGenerator'
import {
  ALL_STORY_TYPES,
  STORY_TYPES,
  type StoryDraft,
  type StorySection,
  type StoryType,
} from '../types'
import type { StoryEngine } from '../StoryEngine'
import {
  STORY_FEATURES,
  StoryFeatureError,
  defaultStoryFeatureGate,
  type IStoryFeatureGate,
  type FeatureGatePrincipal,
} from '../featureGate'

export type StoryAccessLevel = 'member' | 'commissioner'

/** Who may read each story type. Weekly recap is member-readable (it exposes no action-item meta). */
export const STORY_ACCESS: Record<StoryType, StoryAccessLevel> = {
  [STORY_TYPES.WHAT_HAPPENED_RECENTLY]: 'member',
  [STORY_TYPES.ACTIVITY_REPORT]: 'member',
  [STORY_TYPES.WEEKLY_RECAP]: 'member',
  [STORY_TYPES.COMMISSIONER_SUMMARY]: 'commissioner',
  [STORY_TYPES.HEALTH_NARRATIVE]: 'commissioner',
}

export function isStoryType(v: string | null | undefined): v is StoryType {
  return !!v && (ALL_STORY_TYPES as string[]).includes(v)
}

export interface ApiResult {
  status: number
  body: unknown
}

export type AccessResult = { ok: true } | { ok: false; status: number }

export interface StoryApiDeps {
  getUserId: () => Promise<string | null>
  assertMember: (leagueId: string, userId: string) => Promise<AccessResult>
  assertCommissioner: (leagueId: string, userId: string) => Promise<AccessResult>
  engine: Pick<StoryEngine, 'generateStory'>
  gate?: IStoryFeatureGate
}

/** Privacy-safe story preview DTO (no payloads / ids / tokens / hidden meta). */
export interface StoryPreviewDTO {
  type: StoryType
  title: string
  /** One-line lede. */
  summary: string
  sections: StorySection[]
  safetyNote: string
  status: StoryDraft['status']
  empty: boolean
  generatedAt: string
  /** Last recorded league activity, or null. */
  sourceFreshness: string | null
}

export interface StoryTypeDescriptor {
  type: StoryType
  title: string
  access: StoryAccessLevel
}

const ok = (data: unknown, meta?: Record<string, unknown>): ApiResult => ({ status: 200, body: meta ? { data, meta } : { data } })
const unauthorized = (): ApiResult => ({ status: 401, body: { error: 'unauthorized' } })
const accessDenied = (status: number): ApiResult => ({ status, body: { error: status === 404 ? 'not_found' : 'forbidden' } })
const badRequest = (msg: string): ApiResult => ({ status: 400, body: { error: 'bad_request', message: msg } })

async function guard(run: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof StoryFeatureError) {
      const status = err.decision === 'upgrade_required' ? 402 : 403
      return { status, body: { error: 'feature_unavailable', feature: err.feature, decision: err.decision } }
    }
    return { status: 500, body: { error: 'internal_error' } }
  }
}

/** Enforce the per-type access level (member vs commissioner). Returns the userId or an error result. */
async function authorize(leagueId: string, access: StoryAccessLevel, deps: StoryApiDeps): Promise<{ userId: string } | ApiResult> {
  const userId = await deps.getUserId()
  if (!userId) return unauthorized()
  const member = await deps.assertMember(leagueId, userId)
  if (!member.ok) return accessDenied(member.status)
  if (access === 'commissioner') {
    const comm = await deps.assertCommissioner(leagueId, userId)
    if (!comm.ok) return accessDenied(comm.status)
  }
  return { userId }
}

const isResult = (v: { userId: string } | ApiResult): v is ApiResult => 'status' in v

function toPreviewDTO(draft: StoryDraft): StoryPreviewDTO {
  return {
    type: draft.type,
    title: draft.title,
    summary: draft.headline,
    sections: draft.sections,
    safetyNote: STORY_SAFETY_NOTE,
    status: draft.status,
    empty: draft.empty,
    generatedAt: draft.generatedAt,
    sourceFreshness: draft.sourceFreshness,
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/stories/leagues/[leagueId]/types
 * Member-readable: lists the supported story types + their access level.
 */
export async function storyTypesHandler(leagueId: string, deps: StoryApiDeps): Promise<ApiResult> {
  const auth = await authorize(leagueId, 'member', deps)
  if (isResult(auth)) return auth
  const types: StoryTypeDescriptor[] = ALL_STORY_TYPES.map((type) => ({
    type,
    title: titleFor(type),
    access: STORY_ACCESS[type],
  }))
  return ok(types)
}

/**
 * GET /api/v1/stories/leagues/[leagueId]/preview?type=<storyType>
 * Per-type permission; feature-gated; returns a privacy-safe preview DTO.
 */
export async function storyPreviewHandler(leagueId: string, rawType: string | null, deps: StoryApiDeps): Promise<ApiResult> {
  if (!isStoryType(rawType)) return badRequest(`unknown story type: ${rawType ?? '(missing)'}`)
  const type = rawType
  const access = STORY_ACCESS[type]
  const auth = await authorize(leagueId, access, deps)
  if (isResult(auth)) return auth

  return guard(async () => {
    const principal: FeatureGatePrincipal = { userId: auth.userId }
    const gate = deps.gate ?? defaultStoryFeatureGate
    const decision = gate.decide(principal, STORY_FEATURES[type])
    if (decision !== 'allow') throw new StoryFeatureError(STORY_FEATURES[type], decision)
    const draft = await deps.engine.generateStory({ leagueId, type, principal })
    return ok(toPreviewDTO(draft))
  })
}

// keep title resolution local to the API (do not import generator internals beyond the safety note)
function titleFor(type: StoryType): string {
  switch (type) {
    case STORY_TYPES.WEEKLY_RECAP: return 'Weekly League Recap'
    case STORY_TYPES.COMMISSIONER_SUMMARY: return 'Commissioner Summary'
    case STORY_TYPES.ACTIVITY_REPORT: return 'League Activity Report'
    case STORY_TYPES.WHAT_HAPPENED_RECENTLY: return 'What Happened Recently'
    case STORY_TYPES.HEALTH_NARRATIVE: return 'League Health Narrative'
    default: return 'League Story'
  }
}
