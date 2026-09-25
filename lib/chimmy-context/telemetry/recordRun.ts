/**
 * Phase 3A.2 Batch 2 — Chimmy context run telemetry writer.
 *
 * Fire-and-forget persistence helper for `chimmy_context_runs`. Designed to
 * be called from chat / intelligence routes without ever blocking or
 * surfacing failures into the request path.
 *
 * Contract:
 *  - All inputs are optional except `userId`, `surface`, `durationMs`.
 *  - The returned promise resolves to void; it NEVER rejects.
 *  - Prisma errors are swallowed and logged via `logAiFailure`.
 *  - Payload JSON fields are normalized + size-capped before insert.
 *  - No PII (emails, raw content) is written.
 */

import { prisma } from "@/lib/prisma"
import { logAiFailure } from "@/lib/error-tracking"

// ─── Public types ───────────────────────────────────────────────────────────

/** `chimmy_chat`: one question to /api/chat/chimmy — see ./chatQuestion.ts. */
export type ChimmyContextRunSurface = "chat" | "intelligence_api" | "context_api" | "chimmy_chat"

export type ChimmyRunProviderMeta = {
  name: string
  ok: boolean
  cached: boolean
  durationMs: number
}

export type ChimmyRunSectionMeta = {
  id: string
  rendered: boolean
  dropped: boolean
  truncated: boolean
}

export type ChimmyContextRunInput = {
  userId: string
  surface: ChimmyContextRunSurface
  durationMs: number
  leagueId?: string | null
  intent?: string | null
  canaryReason?: string | null
  rolloutBucket?: number | null
  approxPromptChars?: number | null
  urgencyLevel?: string | null
  recommendationSeverity?: string | null
  riskComposite?: number | null
  topRisk?: string | null
  providers?: ReadonlyArray<ChimmyRunProviderMeta> | null
  sections?: ReadonlyArray<ChimmyRunSectionMeta> | null
  errorMessage?: string | null
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const MAX_PROVIDERS = 32
const MAX_SECTIONS = 32
const MAX_STRING_LEN = 256

function clampInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 2_147_483_000) return 2_147_483_000
  return Math.trunc(value)
}

function clampString(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

export function summarizeProviderMeta(
  providers: ReadonlyArray<ChimmyRunProviderMeta> | null | undefined
): { rows: ChimmyRunProviderMeta[]; cacheHits: number; failures: number } {
  if (!Array.isArray(providers) || providers.length === 0) {
    return { rows: [], cacheHits: 0, failures: 0 }
  }
  const rows: ChimmyRunProviderMeta[] = []
  let cacheHits = 0
  let failures = 0
  for (const p of providers.slice(0, MAX_PROVIDERS)) {
    const name = clampString(p?.name, 64) ?? "unknown"
    const ok = Boolean(p?.ok)
    const cached = Boolean(p?.cached)
    const durationMs = clampInt(p?.durationMs) ?? 0
    if (cached) cacheHits += 1
    if (!ok) failures += 1
    rows.push({ name, ok, cached, durationMs })
  }
  return { rows, cacheHits, failures }
}

export function summarizeSectionMeta(
  sections: ReadonlyArray<ChimmyRunSectionMeta> | null | undefined
): ChimmyRunSectionMeta[] {
  if (!Array.isArray(sections) || sections.length === 0) return []
  const rows: ChimmyRunSectionMeta[] = []
  for (const s of sections.slice(0, MAX_SECTIONS)) {
    rows.push({
      id: clampString(s?.id, 48) ?? "unknown",
      rendered: Boolean(s?.rendered),
      dropped: Boolean(s?.dropped),
      truncated: Boolean(s?.truncated),
    })
  }
  return rows
}

// ─── Public writer ──────────────────────────────────────────────────────────

/**
 * Persist a single Chimmy context run. Fire-and-forget — callers SHOULD use
 * `void recordChimmyContextRun(...)` and MUST NOT `await` on the hot path.
 * Always resolves; never throws.
 */
export async function recordChimmyContextRun(
  input: ChimmyContextRunInput
): Promise<void> {
  try {
    const userId = clampString(input.userId, 64)
    if (!userId) return // hard guard: no userId, no row
    const surface = clampString(input.surface, 32)
    if (!surface) return

    const providerSummary = summarizeProviderMeta(input.providers)
    const sectionRows = summarizeSectionMeta(input.sections)

    await prisma.chimmyContextRun.create({
      data: {
        userId,
        surface,
        leagueId: clampString(input.leagueId, 64),
        intent: clampString(input.intent, 48),
        canaryReason: clampString(input.canaryReason, 16),
        rolloutBucket: clampInt(input.rolloutBucket),
        durationMs: clampInt(input.durationMs) ?? 0,
        approxPromptChars: clampInt(input.approxPromptChars),
        urgencyLevel: clampString(input.urgencyLevel, 16),
        recommendationSeverity: clampString(input.recommendationSeverity, 16),
        riskComposite: clampInt(input.riskComposite),
        topRisk: clampString(input.topRisk, 16),
        cacheHitCount: providerSummary.cacheHits,
        providerFailureCount: providerSummary.failures,
        providerMeta: providerSummary.rows.length > 0 ? providerSummary.rows : undefined,
        sectionMeta: sectionRows.length > 0 ? sectionRows : undefined,
        errorMessage: clampString(input.errorMessage, MAX_STRING_LEN),
      },
    })
  } catch (err) {
    try {
      logAiFailure(err, {
        tool: "ChimmyContextRun",
        endpoint: "telemetry/recordRun",
        provider: "prisma",
      })
    } catch {
      // logger itself failed — there is nothing safer to do.
    }
  }
}
