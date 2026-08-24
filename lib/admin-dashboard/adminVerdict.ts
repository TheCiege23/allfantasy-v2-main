import type { AdminCommandCenterMetrics, AdminMetric } from './AdminCommandCenterService'
import type { AdminProviderHealthStatus } from './AdminProviderHealthService'

/**
 * 29a — the verdict that leads the admin Command Center.
 *
 * ⚠ THIS IS THE POINT OF THE HANDOFF, NOT A DECORATION ON TOP OF IT. The old
 * admin page opened with a wall of numbers and left the operator to work out
 * whether anything was wrong. The fix is that the page answers that question
 * first — "all systems nominal", or "N things need you" with the single most
 * urgent one named — and only then shows the numbers. If a future change moves
 * this below the metric groups, the information-hierarchy fix is undone.
 *
 * ⚠ IT COMPUTES FROM ALREADY-FETCHED STATE. Nothing here queries. It reads the
 * same `AdminCommandCenterMetrics` the page already loads, so the verdict cannot
 * disagree with the panels underneath it — there is only one read.
 *
 * ⚠ "NOT TRACKED" IS NEVER AN ISSUE. An unmeasured metric is not a broken one.
 * Conflating the two is exactly the failure mode 29a calls out for money ($0 vs
 * NOT TRACKED), and it applies to the verdict too: a thing we do not measure
 * must not raise an alarm that sends an operator hunting for a fault that does
 * not exist.
 */

export type AdminIssueSeverity = 'critical' | 'warn'

export type AdminIssue = {
  id: string
  severity: AdminIssueSeverity
  /** What is wrong, in one line an operator can act on. */
  title: string
  /** What breaks because of it — the blast radius, not a restatement. */
  consequence: string
  /** Where in the page to go. An in-page anchor that exists. */
  anchor: string
}

export type AdminVerdict = {
  ok: boolean
  headline: string
  issues: AdminIssue[]
  /** The one to lead with. Null when nothing needs attention. */
  lead: AdminIssue | null
}

const SEVERITY_ORDER: Record<AdminIssueSeverity, number> = { critical: 0, warn: 1 }

/**
 * Which provider states are actually faults, and how bad. States absent from
 * this map are deliberate (`disabled`, `public_fallback`) or unmeasured
 * (`unknown`) and never raise an issue — see the loop below.
 */
const PROVIDER_FAULT: Partial<Record<AdminProviderHealthStatus, AdminIssueSeverity>> = {
  configured_failing: 'critical',
  missing_env: 'critical',
  not_production_ready: 'warn',
  scaffold_only: 'warn',
}

const PROVIDER_FAULT_LABEL: Partial<Record<AdminProviderHealthStatus, string>> = {
  configured_failing: 'configured but failing',
  missing_env: 'missing its environment variables',
  not_production_ready: 'not production ready',
  scaffold_only: 'scaffold only',
}

export function buildAdminVerdict(metrics: AdminCommandCenterMetrics): AdminVerdict {
  const issues: AdminIssue[] = []

  /*
   * Providers. `configured: false` is not automatically a fault — plenty of
   * providers are deliberately unconfigured — so only a provider that is
   * configured AND reporting a bad status counts. `consumedBy` turns the row
   * into a blast radius rather than a red dot.
   *
   * `disabled`, `public_fallback` and `unknown` are deliberate or unmeasured
   * states, not faults, and raising them here would teach the operator to
   * ignore the strip.
   */
  for (const provider of metrics.providerHealth) {
    if (!provider.configured) continue
    const severity = PROVIDER_FAULT[provider.status]
    if (!severity) continue
    const consumers = provider.consumedBy.length
      ? provider.consumedBy.join(', ')
      : 'no surface records a dependency on it'
    issues.push({
      id: `provider-${provider.id}`,
      severity,
      title: `${provider.name} — ${PROVIDER_FAULT_LABEL[provider.status] ?? provider.status}`,
      consequence: `Goes dark: ${consumers}.`,
      anchor: '#providers',
    })
  }

  /*
   * Crons. "partial" and "missing" are different things and are reported as
   * such — a job with some paths configured is a half-wired job, not an absent
   * one, and an operator chasing the wrong one wastes the trip.
   */
  for (const cron of metrics.productionReadiness.crons) {
    if (cron.status === 'configured') continue
    issues.push({
      id: `cron-${cron.id}`,
      severity: cron.status === 'missing' ? 'critical' : 'warn',
      title:
        cron.status === 'missing'
          ? `${cron.label} is not scheduled`
          : `${cron.label} is only partly scheduled`,
      consequence: cron.missing.length
        ? `Missing: ${cron.missing.join(', ')}.`
        : cron.note || 'Nothing runs on the schedule this job expects.',
      anchor: '#crons',
    })
  }

  /*
   * Environment. Only `critical` requirements raise an issue: the readiness
   * service already grades severity, and promoting a warning to an alarm here
   * would make the verdict cry wolf until the operator stops reading it.
   */
  for (const env of metrics.productionReadiness.env) {
    if (env.status === 'configured') continue
    if (env.severity !== 'critical') continue
    issues.push({
      id: `env-${env.id}`,
      severity: 'critical',
      title: `${env.label} is not configured`,
      consequence: env.note || 'A required secret or setting is absent in this environment.',
      anchor: '#env',
    })
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const n = issues.length
  return {
    ok: n === 0,
    headline: n === 0 ? 'All systems nominal' : n === 1 ? '1 thing needs you' : `${n} things need you`,
    issues,
    lead: issues[0] ?? null,
  }
}

/**
 * 29a's three peer groups. Peer meaning equal weight — People, Money and Right
 * now are three readings of the same system, not a hierarchy, so they render
 * side by side at the same size.
 *
 * The existing service already splits metrics into ten narrow buckets. Rather
 * than re-query anything, this folds those buckets into the three the handoff
 * asks for. Nothing is dropped: every bucket lands in exactly one group.
 */
export type AdminPeerGroup = {
  id: 'people' | 'money' | 'now'
  label: string
  hint: string
  metrics: AdminMetric[]
}

export function buildPeerGroups(metrics: AdminCommandCenterMetrics): AdminPeerGroup[] {
  return [
    {
      id: 'people',
      label: 'People',
      hint: 'Who is here and who arrived',
      metrics: [...metrics.users, ...metrics.traffic],
    },
    {
      id: 'money',
      label: 'Money',
      hint: 'What is being charged and what is unmeasured',
      /*
       * ⚠ A REAL ZERO AND AN UNMEASURED NUMBER ARE NOT THE SAME AND MUST NOT
       * RENDER THE SAME. `AdminMetric.tracked` already carries that
       * distinction; the group keeps both kinds and the renderer is
       * responsible for showing them differently. Filtering the untracked ones
       * out would be worse than showing $0.00 for both — it would make the gap
       * invisible instead of merely misleading.
       */
      metrics: [...metrics.subscriptions, ...metrics.tokens],
    },
    {
      id: 'now',
      label: 'Right now',
      hint: 'What the system is doing this minute',
      metrics: [...metrics.morning, ...metrics.health, ...metrics.integrity],
    },
  ]
}
