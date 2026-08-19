import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/get-current-user'
import {
  canAccessDecisionTelemetryDebugSurface,
  isDecisionTelemetryDebugSurfaceEnabled,
  normalizeDecisionTelemetryDebugFilters,
} from '@/lib/decision-os/core/telemetryDebugAccess'
import {
  listDecisionTelemetryDebugEvents,
  type DecisionTelemetryDebugEvent,
} from '@/lib/decision-os/core/telemetryDebugStore'

export const dynamic = 'force-dynamic'

function badgeClass(tone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate'): string {
  switch (tone) {
    case 'emerald':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
    case 'amber':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-100'
    case 'rose':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-100'
    case 'slate':
      return 'border-white/10 bg-white/5 text-white/70'
    default:
      return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
  }
}

function renderParityStatus(event: DecisionTelemetryDebugEvent): {
  label: string
  tone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate'
} {
  if (event.flags?.parity_passed === true) {
    return { label: 'Parity passed', tone: 'emerald' }
  }
  if (event.flags?.parity_failed === true) {
    return { label: 'Parity failed', tone: 'rose' }
  }
  if (event.flags?.ran === false) {
    return {
      label:
        typeof event.flags?.reason === 'string' && event.flags.reason.trim()
          ? `Skipped: ${event.flags.reason.trim()}`
          : 'Skipped',
      tone: 'amber',
    }
  }
  if (event.flags?.shadow === true) {
    return { label: 'Shadow event', tone: 'cyan' }
  }
  return { label: 'Issued', tone: 'slate' }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default async function DecisionOsTelemetryViewerPage({
  searchParams,
}: {
  searchParams?: {
    event?: string
    decisionType?: string
    userId?: string
    leagueId?: string
    decisionId?: string
    limit?: string
  }
}) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) notFound()

  const user = await getCurrentUser()
  if (!user?.id || !canAccessDecisionTelemetryDebugSurface(user.id)) notFound()

  const filters = normalizeDecisionTelemetryDebugFilters(searchParams ?? {})
  const events = listDecisionTelemetryDebugEvents(filters)
  const clearHref = '/dev/decision-os/telemetry'

  return (
    <main className="min-h-screen bg-[#050816] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl border border-cyan-500/20 bg-[#081125] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/75">
            Dev Telemetry
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Decision OS Telemetry Viewer
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
            Browser-safe local and staging view for shadow Decision OS debug events.
            This route is hidden unless debug telemetry is enabled and the signed-in
            user has dev-admin access.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-2.5 py-1 ${badgeClass('cyan')}`}>
                `DECISION_OS_DEBUG_TELEMETRY=true`
              </span>
              <span className={`rounded-full border px-2.5 py-1 ${badgeClass('slate')}`}>
                {events.length} visible events
              </span>
            </div>
            <form method="POST" action="/api/dev/decision-os/telemetry">
              <button
                type="submit"
                className="inline-flex h-8 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                Emit test event
              </button>
            </form>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#08101f] px-5 py-5">
          <form action={clearHref} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                Event
              </span>
              <input
                name="event"
                defaultValue={filters.event ?? ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="decision.shadow_parity"
              />
            </label>
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                Decision Type
              </span>
              <input
                name="decisionType"
                defaultValue={filters.decisionType ?? ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="commissioner.league.health"
              />
            </label>
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                Decision ID
              </span>
              <input
                name="decisionId"
                defaultValue={filters.decisionId ?? ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="dec-123"
              />
            </label>
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                User ID
              </span>
              <input
                name="userId"
                defaultValue={filters.userId ?? ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="user-123"
              />
            </label>
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                League ID
              </span>
              <input
                name="leagueId"
                defaultValue={filters.leagueId ?? ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="league-123"
              />
            </label>
            <label className="text-xs text-white/70">
              <span className="mb-1 block uppercase tracking-[0.16em] text-white/50">
                Limit
              </span>
              <input
                name="limit"
                defaultValue={Number.isFinite(filters.limit ?? NaN) ? String(filters.limit) : ''}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25"
                placeholder="100"
              />
            </label>
            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-black hover:bg-cyan-400"
              >
                Apply filters
              </button>
              <a
                href={clearHref}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/75 hover:bg-white/5"
              >
                Clear
              </a>
              <a
                href={`/api/dev/decision-os/telemetry${
                  Object.values(searchParams ?? {}).some(Boolean)
                    ? `?${new URLSearchParams(
                        Object.entries(searchParams ?? {}).flatMap(([key, value]) =>
                          typeof value === 'string' && value.trim() ? [[key, value]] : [],
                        ),
                      ).toString()}`
                    : ''
                }`}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/75 hover:bg-white/5"
              >
                Open JSON
              </a>
            </div>
          </form>
        </section>

        <section className="mt-6 space-y-3">
          {events.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#08101f] px-5 py-10 text-center text-sm text-white/60">
              No telemetry events matched the current filters yet. Trigger a shadow path,
              then refresh this page.
            </div>
          ) : null}

          {events.map((event) => {
            const parity = renderParityStatus(event)
            return (
              <article
                key={`${event.at}-${event.decision_id ?? 'no-id'}-${event.event}`}
                className="rounded-2xl border border-white/10 bg-[#08101f] px-5 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/75">
                      {event.event}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {event.decision_type}
                    </h2>
                    <p className="mt-1 text-xs text-white/50">
                      {formatTimestamp(event.at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(
                      parity.tone,
                    )}`}
                  >
                    {parity.label}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      Decision ID
                    </p>
                    <p className="mt-1 break-all text-sm text-white/85">
                      {event.decision_id ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      User ID
                    </p>
                    <p className="mt-1 break-all text-sm text-white/85">
                      {event.userId ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      League ID
                    </p>
                    <p className="mt-1 break-all text-sm text-white/85">
                      {event.leagueId ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/15 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      Shadow Flags
                    </p>
                    <p className="mt-1 text-sm text-white/85">
                      {event.flags?.shadow === true ? 'shadow' : 'n/a'}
                      {event.flags?.wrap_fidelity === true ? ' | wrap_fidelity' : ''}
                      {event.flags?.legacy_shadow_compared === true
                        ? ' | legacy_compared'
                        : ''}
                    </p>
                  </div>
                </div>

                <details className="mt-4 rounded-xl border border-white/8 bg-black/15 px-3 py-3">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-cyan-100">
                    Raw JSON
                  </summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-white/75">
                    {JSON.stringify(event, null, 2)}
                  </pre>
                </details>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
