/**
 * Operator sections: Subscriptions, Tokens, Payments, Communications.
 * Server components rendered from the existing real admin metrics + panels.
 */
import { getOperatorOverviewData } from "@/lib/admin-dashboard/operatorData"
import type { AdminMetric } from "@/lib/admin-dashboard/AdminCommandCenterService"
import {
  Panel,
  Stat,
  StatusPill,
  TableScroll,
  Th,
  Td,
  PartialDataWarning,
  type OperatorTone,
} from "@/components/admin/operator/primitives"
import { PaymentTokenHealthPanel } from "@/components/admin/PaymentTokenHealthPanel"
import { CheckoutCoveragePanel } from "@/components/admin/CheckoutCoveragePanel"

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function subTone(status: string): OperatorTone {
  const s = status.toLowerCase()
  if (s === "active" || s === "trialing") return "healthy"
  if (s === "past_due") return "warn"
  if (["canceled", "cancelled", "failed", "incomplete", "unpaid"].includes(s)) return "critical"
  return "unknown"
}

function payTone(status: string): OperatorTone {
  const s = status.toLowerCase()
  if (["completed", "paid", "succeeded"].includes(s)) return "healthy"
  if (s === "pending") return "warn"
  if (["failed", "canceled", "cancelled", "refunded"].includes(s)) return "critical"
  return "unknown"
}

function MetricGrid({ items }: { items: AdminMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((m) => (
        <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{m.label}</p>
          <p className={`mt-1 text-lg font-black ${m.tracked ? "text-white" : "text-slate-500"}`}>{String(m.value)}</p>
          {m.note ? <p className="mt-0.5 text-[10px] text-slate-500">{m.note}</p> : null}
        </div>
      ))}
    </div>
  )
}

export async function SubscriptionsSection() {
  const { metrics } = await getOperatorOverviewData()
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Subscription metrics">
        <MetricGrid items={metrics.subscriptions} />
      </Panel>
      <Panel title="Recent subscriptions">
        <TableScroll minWidth={820}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th>Renews</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentSubscriptions.map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold text-white">@{s.username}</Td>
                <Td className="text-slate-300">{s.plan}</Td>
                <Td>
                  <StatusPill tone={subTone(s.status)}>{s.status}</StatusPill>
                </Td>
                <Td className="text-slate-400">{fmtDate(s.currentPeriodEnd)}</Td>
                <Td className="text-slate-400">{fmtDate(s.updatedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

export async function TokensSection() {
  const { metrics } = await getOperatorOverviewData()
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Token metrics">
        <MetricGrid items={metrics.tokens} />
      </Panel>
      <Panel eyebrow="Cost governance" title="Payment & token health">
        <PaymentTokenHealthPanel />
      </Panel>
      <Panel title="Recent token activity">
        <TableScroll minWidth={820}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Type</Th>
              <Th>Δ</Th>
              <Th>Balance after</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentTokenActivity.map((t) => (
              <tr key={t.id}>
                <Td className="font-semibold text-white">@{t.username}</Td>
                <Td className="text-slate-300">{t.entryType}</Td>
                <Td className={t.tokenDelta < 0 ? "text-rose-300" : "text-emerald-300"}>
                  {t.tokenDelta > 0 ? "+" : ""}
                  {t.tokenDelta}
                </Td>
                <Td>{t.balanceAfter}</Td>
                <Td className="text-slate-400">{fmtDate(t.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

export async function PaymentsSection() {
  const { metrics } = await getOperatorOverviewData()
  return (
    <div className="flex flex-col gap-4">
      <PartialDataWarning>
        Stripe reconciliation, disputes/chargebacks, and refund tooling are planned. League dues remain external via
        approved escrow/dues providers. Recent payments and checkout coverage are shown from real data.
      </PartialDataWarning>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Payments" title="Payment & token health">
          <PaymentTokenHealthPanel />
        </Panel>
        <Panel eyebrow="Payments" title="Checkout coverage">
          <CheckoutCoveragePanel />
        </Panel>
      </div>
      <Panel title="Recent payments">
        <TableScroll minWidth={780}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Type</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.recentPayments.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold text-white">@{p.username}</Td>
                <Td className="text-slate-300">{p.paymentType}</Td>
                <Td>{p.amount}</Td>
                <Td>
                  <StatusPill tone={payTone(p.status)}>{p.status}</StatusPill>
                </Td>
                <Td className="text-slate-400">{fmtDate(p.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Panel>
    </div>
  )
}

export async function CommunicationsSection() {
  const { metrics } = await getOperatorOverviewData()
  const e = metrics.emailStatus
  return (
    <div className="flex flex-col gap-4">
      {!e.configured ? (
        <PartialDataWarning>
          Email is not fully configured{e.missingEnv.length > 0 ? `: missing ${e.missingEnv.join(", ")}` : ""}. Sends are
          separated into preview / test / production — only real sends count as customer-facing.
        </PartialDataWarning>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Configured" value={e.configured ? "Yes" : "No"} tone={e.configured ? "healthy" : "critical"} />
        <Stat label="Sender configured" value={e.senderConfigured ? "Yes" : "No"} tone={e.senderConfigured ? "healthy" : "warn"} />
        <Stat label="Users with email" value={e.totalUsersWithEmail} />
        <Stat label="Unsubscribed" value={e.unsubscribed} />
        <Stat label="Product-update opt-outs" value={e.productUpdateOptOuts} />
        <Stat label="Pending outbox" value={e.pendingEmailOutbox} tone={e.pendingEmailOutbox > 0 ? "warn" : "healthy"} />
        <Stat label="Recent broadcasts" value={e.recentBroadcasts} />
        <Stat
          label="Provider failures"
          value={e.recentProviderFailures}
          tone={e.recentProviderFailures > 0 ? "critical" : "healthy"}
        />
      </div>

      <Panel title="Delivery status">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Last send</dt>
            <dd className="mt-1 text-sm text-slate-200">{fmtDate(e.lastSendAt)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Last error</dt>
            <dd className="mt-1 text-sm text-rose-300/80">{e.lastError ?? "None"}</dd>
          </div>
        </dl>
        {e.audiences.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Audiences</p>
            <ul className="flex flex-wrap gap-2">
              {e.audiences.map((a) => (
                <li key={a.id} title={a.description} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-slate-300">
                  {a.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
