"use client"

/**
 * PaymentTokenHealthPanel
 *
 * Renders Stripe webhook health and token ledger health data from
 * GET /api/admin/chimmy/health (stripeWebhookHealth + tokenLedgerHealth fields).
 *
 * Designed to be embedded in any admin UI page. Auto-fetches on mount with
 * a manual refresh button. Admin-gated at the API level — this component does
 * not perform its own auth check.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle, RefreshCw, XCircle } from "lucide-react"

// ---------------------------------------------------------------------------
// Types (matching app/api/admin/chimmy/health/route.ts response shape)
// ---------------------------------------------------------------------------
type StripeWebhookHealth = {
  ok: boolean
  errorCount: number
  tokenErrorCount: number
  oldestUnresolvedError: {
    eventId: string
    purchaseType: string | null
    processedAt: string | null
    errorSnippet: string
  } | null
  error?: string
}

type TokenLedgerHealth = {
  ok: boolean
  purchaseGrantsInWindow: number
  spendEntriesInWindow: number
  usersWithBalance: number
  error?: string
}

type HealthData = {
  ok: boolean
  accepted: boolean
  generatedAt: string
  windows: { short: number; long: number }
  stripeWebhookHealth?: StripeWebhookHealth
  tokenLedgerHealth?: TokenLedgerHealth
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" />
  return ok ? (
    <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
  ) : (
    <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
  )
}

function Row({
  label,
  value,
  ok,
}: {
  label: string
  value: React.ReactNode
  ok?: boolean | null
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2">
      <span className="text-xs text-white/55">{label}</span>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-white text-right">
        {ok !== undefined && <StatusIcon ok={ok ?? null} />}
        {value}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function PaymentTokenHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/chimmy/health", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.accepted) {
        setError("Access denied — admin account required")
        return
      }
      setHealth(data as HealthData)
      setLastChecked(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runCheck()
  }, [runCheck])

  const stripe = health?.stripeWebhookHealth
  const tokens = health?.tokenLedgerHealth
  const windowHours = health?.windows?.long ?? 48

  return (
    <div className="space-y-4" data-testid="payment-token-health-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-white">Payment &amp; Token Health</h2>
          {lastChecked && (
            <p className="text-[11px] text-white/35">Last checked: {lastChecked}</p>
          )}
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/70 hover:bg-white/[0.08] disabled:opacity-50"
          data-testid="payment-health-refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs text-rose-100">
          {error}
        </div>
      )}

      {loading && !health && (
        <div className="flex items-center justify-center py-8 text-white/30">
          <RefreshCw className="h-5 w-5 animate-spin" />
        </div>
      )}

      {health && (
        <div className="space-y-4">
          {/* Overall status */}
          <div
            className={[
              "flex items-center gap-2 rounded-lg border px-4 py-2.5",
              health.ok
                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : "border-rose-400/20 bg-rose-500/10 text-rose-200",
            ].join(" ")}
          >
            <StatusIcon ok={health.ok} />
            <span className="text-xs font-bold">
              {health.ok ? "All systems healthy" : "Issues detected — review below"}
            </span>
            <span className="ml-auto text-[10px] text-white/35">
              {windowHours}h window
            </span>
          </div>

          {/* Stripe webhook health */}
          {stripe && (
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-white/50">
                <StatusIcon ok={stripe.ok} />
                Stripe Webhook Health
              </h3>
              <Row
                label="Webhook errors in window"
                value={stripe.errorCount}
                ok={stripe.errorCount === 0}
              />
              <Row
                label="Token purchase errors"
                value={stripe.tokenErrorCount}
                ok={stripe.tokenErrorCount === 0}
              />
              {stripe.oldestUnresolvedError ? (
                <div className="mt-3 rounded-md border border-rose-400/20 bg-rose-400/5 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                    Oldest unresolved error
                  </p>
                  <p className="mt-1 text-[11px] text-white/60">
                    Event ID: <span className="font-mono text-white/80">{stripe.oldestUnresolvedError.eventId}</span>
                  </p>
                  {stripe.oldestUnresolvedError.purchaseType && (
                    <p className="text-[11px] text-white/60">
                      Type: {stripe.oldestUnresolvedError.purchaseType}
                    </p>
                  )}
                  {stripe.oldestUnresolvedError.processedAt && (
                    <p className="text-[11px] text-white/60">
                      At: {new Date(stripe.oldestUnresolvedError.processedAt).toLocaleString()}
                    </p>
                  )}
                  {stripe.oldestUnresolvedError.errorSnippet && (
                    <p className="mt-1 text-[10px] text-rose-200/70 font-mono break-all">
                      {stripe.oldestUnresolvedError.errorSnippet}
                    </p>
                  )}
                </div>
              ) : (
                <Row label="Unresolved errors" value="None" ok={true} />
              )}
              {stripe.error && (
                <p className="mt-2 text-[11px] text-amber-200">
                  Health check degraded: {stripe.error}
                </p>
              )}
            </section>
          )}

          {/* Token ledger health */}
          {tokens && (
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-white/50">
                <StatusIcon ok={tokens.ok} />
                Token Ledger Health
              </h3>
              <Row
                label={`Purchase grants (${windowHours}h)`}
                value={tokens.purchaseGrantsInWindow}
                ok={null}
              />
              <Row
                label={`Spend entries (${windowHours}h)`}
                value={tokens.spendEntriesInWindow}
                ok={null}
              />
              <Row
                label="Users with balance > 0"
                value={tokens.usersWithBalance}
                ok={null}
              />
              {tokens.error && (
                <p className="mt-2 text-[11px] text-amber-200">
                  Health check degraded: {tokens.error}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
