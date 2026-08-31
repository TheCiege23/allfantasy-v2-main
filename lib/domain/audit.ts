/**
 * Commissioner OS · the audit writer. T-007.
 *
 * The concrete `WriteAudit` adapter the mutation wrapper calls at step 8. It
 * takes `tx`, never a client — invariant 3: "audit rows are written inside the
 * transaction they describe". A writer holding its own connection would commit
 * independently, so a rolled-back mutation would leave a record of something
 * that never happened. That is worse than no audit, because it is confidently
 * wrong.
 */

import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import type { AuditDraft, WriteAudit } from './ports'
import { isPlatformReadScope } from './platformRead'

/**
 * Keys whose VALUES are replaced with a marker before an audit row is written.
 *
 * ⚠ REDACTION HAPPENS HERE, NOT AT EVERY CALL SITE. `CLAUDE.md` says never
 * write provider credentials into audit `before`/`after` payloads — and a rule
 * like that, enforced by everyone remembering it, holds until the first hurried
 * integration. Audit payloads are the least-inspected data in any system: a
 * token written here is a token nobody notices for a year, sitting in a table
 * whose whole design goal is that it is never modified or deleted.
 *
 * Matched case-insensitively against the KEY, on the reasoning that a field
 * called `apiKey` holds a key whatever its value looks like. Value-shape
 * detection (entropy, vendor prefixes) is the secret scanner's job and belongs
 * at the push boundary, not here.
 */
export const REDACTED_KEY_PATTERN =
  /(password|passwd|secret|token|apikey|api_key|authorization|auth|credential|cookie|session|privatekey|private_key|clientsecret|client_secret|rsc_token|hash|salt)/i

export const REDACTION_MARKER = '[redacted]'

/**
 * Deep-copy a value, replacing sensitive values with a marker.
 *
 * Depth-limited: a cyclic or pathologically nested payload must not turn an
 * audit write — which runs inside the caller's transaction, holding its row
 * locks — into a stack overflow or a hang. Exceeding the limit yields a marker
 * rather than throwing, because failing the audit fails the mutation, and a
 * deeply-nested payload is not a reason to refuse a legitimate write.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[too deep]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1))
  if (value instanceof Date) return value

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEY_PATTERN.test(key) ? REDACTION_MARKER : redactSensitive(v, depth + 1)
  }
  return out
}

/**
 * The row this writes, as a plain object.
 *
 * Split out from the write so it is testable without a database — every field
 * mapping and every redaction rule is asserted against this rather than
 * inferred from a mock's call arguments.
 */
export function buildAuditRow(ctx: ActorContext, draft: AuditDraft) {
  return {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    // Denormalised, not joined — the trail must outlive the person.
    actorLabel: ctx.actorLabel,
    platformRole: ctx.platformRole,
    tenantRole: ctx.tenantRole,
    leagueRole: ctx.leagueRole,
    // T-105. Read from the ambient cross-tenant scope, NOT from a parameter and
    // NOT from the actor's role.
    //
    // ⚠ NOT FROM THE ROLE: a platform admin doing ordinary work inside their own
    // tenant is not a cross-tenant read, and marking it as one would flood the
    // operator-facing disclosure list until it means nothing — which is worse
    // than not disclosing, because it looks like disclosure.
    //
    // ⚠ NOT FROM A PARAMETER: this flag drives a disclosure a DPA is read
    // against. A flag every call site must remember to pass is one that will be
    // missing from exactly the row somebody later needs, and the failure is
    // silent — an unmarked row looks like ordinary activity.
    isPlatformRead: isPlatformReadScope(),

    action: draft.action,
    resourceType: draft.resourceType,
    resourceId: draft.resourceId,
    leagueId: draft.leagueId ?? ctx.onBehalfOfLeagueId ?? null,
    onBehalfOfLeagueId: ctx.onBehalfOfLeagueId ?? null,

    before: draft.before === undefined ? null : redactSensitive(draft.before),
    after: draft.after === undefined ? null : redactSensitive(draft.after),
    metadata: draft.metadata === undefined ? null : redactSensitive(draft.metadata),

    reason: ctx.reason ?? null,
    requestId: ctx.requestId,
  }
}

/**
 * ⚠ THE CAST EXISTS BECAUSE THE GENERATED CLIENT IS STALE.
 * `AuditEvent` is in `schema.prisma` but not in this checkout's generated
 * client, so `tx.auditEvent` does not typecheck. Regenerating mutates a
 * `node_modules` shared by ~9 concurrent sessions, which is not a side effect
 * T-007 should have.
 *
 * Delete the cast — and this comment — in the commit that runs
 * `prisma generate`. It is narrow on purpose: it names exactly the one method
 * used, so it cannot quietly become a general escape from the client's types.
 */
type AuditCapableTx = {
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
}

/** The `WriteAudit` implementation. */
export function createAuditWriter(): WriteAudit {
  return async (tx: Tx, ctx: ActorContext, draft: AuditDraft): Promise<void> => {
    const data = buildAuditRow(ctx, draft)
    await (tx as unknown as AuditCapableTx).auditEvent.create({ data })
  }
}
