"use client"

/**
 * CheckoutCoveragePanel
 *
 * Renders Stripe checkout-link coverage from
 * GET /api/admin/monetization/checkout-link-mapping.
 *
 * Shows which SKUs have a configured Payment Link URL and which are missing.
 * Designed to be embedded in any admin surface. Auth is enforced at the API
 * level — 401 responses are handled gracefully with an "access denied" state
 * rather than an unhandled error.
 */

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, RefreshCw, XCircle } from "lucide-react"

// ---------------------------------------------------------------------------
// Types (matching app/api/admin/monetization/checkout-link-mapping/route.ts)
// ---------------------------------------------------------------------------
type ProductCoverage = {
  sku: string
  title: string
  checkoutConfigured: boolean
  expectedPurchaseType: "subscription" | "tokens"
  mappedPurchaseType: string | null
  checkoutDestination?: string | null
  issue: string | null
}

type CoverageData = {
  summary: {
    totalProducts: number
    configuredProducts: number
    missingProducts: number
  }
  missingSkus: string[]
  products: ProductCoverage[]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
  return ok ? (
    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
  ) : (
    <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
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
export function CheckoutCoveragePanel() {
  const [data, setData] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/monetization/checkout-link-mapping", { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) {
        setError("Admin account required to view checkout coverage")
        return
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body as CoverageData)
      setLastChecked(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coverage check failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runCheck()
  }, [runCheck])

  const summary = data?.summary
  const allOk = summary ? summary.missingProducts === 0 : null
  const someOk =
    summary && summary.configuredProducts > 0 && summary.missingProducts > 0

  return (
    <div className="space-y-4" data-testid="checkout-coverage-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-white">Checkout Link Coverage</h2>
          {lastChecked && (
            <p className="text-[11px] text-white/35">Last checked: {lastChecked}</p>
          )}
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/70 hover:bg-white/[0.08] disabled:opacity-50"
          data-testid="checkout-coverage-refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error / access denied */}
      {error && (
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs text-rose-100" data-testid="checkout-coverage-error">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center py-8 text-white/30">
          <RefreshCw className="h-5 w-5 animate-spin" />
        </div>
      )}

      {/* Coverage data */}
      {data && (
        <div className="space-y-4">
          {/* Overall status banner */}
          <div
            data-testid="checkout-coverage-status-banner"
            className={[
              "flex items-center gap-2 rounded-lg border px-4 py-2.5",
              allOk
                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : someOk
                  ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
                  : "border-rose-400/20 bg-rose-500/10 text-rose-200",
            ].join(" ")}
          >
            <StatusIcon ok={allOk} />
            <span className="text-xs font-bold">
              {allOk
                ? "All checkout links configured"
                : someOk
                  ? `${summary!.missingProducts} SKU${summary!.missingProducts !== 1 ? "s" : ""} missing checkout links`
                  : `${summary!.missingProducts} SKU${summary!.missingProducts !== 1 ? "s" : ""} missing checkout links — checkout broken`}
            </span>
          </div>

          {/* Summary numbers */}
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-3 text-[11px] font-black uppercase tracking-wider text-white/50">
              Coverage Summary
            </h3>
            <Row label="Total products" value={summary!.totalProducts} ok={null} />
            <Row
              label="Links configured"
              value={summary!.configuredProducts}
              ok={summary!.configuredProducts === summary!.totalProducts}
            />
            <Row
              label="Links missing"
              value={summary!.missingProducts}
              ok={summary!.missingProducts === 0}
            />
          </section>

          {/* Missing SKU list */}
          {data.missingSkus.length > 0 && (
            <section className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-4" data-testid="checkout-coverage-missing-list">
              <h3 className="mb-3 text-[11px] font-black uppercase tracking-wider text-rose-300/80">
                Missing Checkout Links
              </h3>
              <ul className="space-y-1.5">
                {data.missingSkus.map((sku) => {
                  const product = data.products.find((p) => p.sku === sku)
                  return (
                    <li key={sku} className="flex items-start gap-2">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <div>
                        <p className="text-xs font-semibold text-white/80">
                          {product?.title ?? sku}
                        </p>
                        <p className="text-[10px] font-mono text-white/35">{sku}</p>
                        {product?.issue && (
                          <p className="text-[10px] text-rose-300/70">
                            {product.issue.replace(/_/g, " ")}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-[10px] text-white/30">
                Set the corresponding{" "}
                <span className="font-mono text-white/45">STRIPE_CHECKOUT_LINK_*</span>{" "}
                env vars in Vercel to resolve.
              </p>
            </section>
          )}

          {/* Expandable full product table */}
          <div>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white/40 hover:text-white/70"
              data-testid="checkout-coverage-toggle-all"
            >
              {showAll ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {showAll ? "Hide" : "Show"} all {summary!.totalProducts} products
            </button>

            {showAll && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03]">
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-white/40">
                        SKU / Product
                      </th>
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-white/40">
                        Type
                      </th>
                      <th className="px-3 py-2 text-center font-bold uppercase tracking-wider text-white/40">
                        Configured
                      </th>
                      <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-white/40">
                        Issue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <tr
                        key={p.sku}
                        className={`border-b border-white/5 ${
                          p.issue ? "bg-rose-400/5" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <p className="font-semibold text-white/80">{p.title}</p>
                          <p className="font-mono text-[10px] text-white/30">{p.sku}</p>
                        </td>
                        <td className="px-3 py-2 text-white/50">
                          {p.expectedPurchaseType}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {p.checkoutConfigured ? (
                            <CheckCircle className="mx-auto h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <XCircle className="mx-auto h-3.5 w-3.5 text-rose-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-rose-300/70">
                          {p.issue ? p.issue.replace(/_/g, " ") : (
                            <span className="text-white/25">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
