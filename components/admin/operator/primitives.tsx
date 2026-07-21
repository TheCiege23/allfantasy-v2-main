/**
 * Operator Command Center — shared presentational primitives.
 *
 * Intentionally NOT a "use client" module: everything here is pure/presentational
 * (no hooks, no event handlers) so it can be rendered from server components
 * (section pages) and re-used inside the client shell alike.
 *
 * Honesty contract: these primitives make it easy to render "Unknown",
 * "Not configured", "Partial", and "Planned" states, and hard to render a
 * fabricated green. There is deliberately no "fake sparkline" helper.
 */
import type { ReactNode } from "react"
import {
  Gauge,
  Boxes,
  AlertTriangle,
  Users,
  Trophy,
  DownloadCloud,
  Radio,
  Database,
  BrainCircuit,
  Bot,
  Workflow,
  ListOrdered,
  Megaphone,
  CreditCard,
  Coins,
  Receipt,
  Award,
  Gavel,
  ShieldAlert,
  ScrollText,
  Flag,
  Siren,
  LifeBuoy,
  Settings,
  HelpCircle,
  type LucideIcon,
} from "lucide-react"
import type { OperatorSectionStatus } from "@/lib/admin-dashboard/operatorNav"

// ── Icons ──────────────────────────────────────────────────────────────────────
const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  boxes: Boxes,
  "alert-triangle": AlertTriangle,
  users: Users,
  trophy: Trophy,
  "download-cloud": DownloadCloud,
  radio: Radio,
  database: Database,
  "brain-circuit": BrainCircuit,
  bot: Bot,
  workflow: Workflow,
  "list-ordered": ListOrdered,
  megaphone: Megaphone,
  "credit-card": CreditCard,
  coins: Coins,
  receipt: Receipt,
  award: Award,
  gavel: Gavel,
  "shield-alert": ShieldAlert,
  "scroll-text": ScrollText,
  flag: Flag,
  siren: Siren,
  "life-buoy": LifeBuoy,
  settings: Settings,
}

export function OperatorIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle
  return <Icon className={className} aria-hidden />
}

// ── Tone system ──────────────────────────────────────────────────────────────────
export type OperatorTone = "healthy" | "info" | "warn" | "critical" | "unknown" | "accent"

export const TONE_TEXT: Record<OperatorTone, string> = {
  healthy: "text-emerald-300",
  info: "text-sky-300",
  warn: "text-amber-300",
  critical: "text-rose-300",
  unknown: "text-slate-400",
  accent: "text-violet-300",
}

export const TONE_DOT: Record<OperatorTone, string> = {
  healthy: "bg-emerald-400",
  info: "bg-sky-400",
  warn: "bg-amber-400",
  critical: "bg-rose-500",
  unknown: "bg-slate-500",
  accent: "bg-violet-400",
}

const TONE_CHIP: Record<OperatorTone, string> = {
  healthy: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  unknown: "border-white/12 bg-white/[0.05] text-slate-300",
  accent: "border-violet-400/30 bg-violet-400/10 text-violet-200",
}

/**
 * Status dot that never relies on color alone — pairs the dot with a text label
 * for accessibility (spec: non-color severity indicators).
 */
export function StatusDot({ tone, label }: { tone: OperatorTone; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      {label ? <span className="text-xs font-semibold">{label}</span> : null}
    </span>
  )
}

export function StatusPill({
  tone,
  children,
  className = "",
}: {
  tone: OperatorTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_CHIP[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

const SECTION_STATUS_TONE: Record<OperatorSectionStatus, OperatorTone> = {
  live: "healthy",
  partial: "warn",
  planned: "unknown",
}

export function SectionStatusPill({ status }: { status: OperatorSectionStatus }) {
  const label = status === "live" ? "Live data" : status === "partial" ? "Partial" : "Planned"
  return (
    <StatusPill tone={SECTION_STATUS_TONE[status]}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[SECTION_STATUS_TONE[status]]}`} aria-hidden />
      {label}
    </StatusPill>
  )
}

// ── Freshness ────────────────────────────────────────────────────────────────────
export function DataFreshnessBadge({
  generatedAt,
  label = "Data freshness",
}: {
  generatedAt: string | Date | null
  label?: string
}) {
  if (!generatedAt) {
    return (
      <StatusPill tone="unknown" className="normal-case">
        {label}: unknown
      </StatusPill>
    )
  }
  const d = typeof generatedAt === "string" ? new Date(generatedAt) : generatedAt
  const text = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return (
    <StatusPill tone="info" className="normal-case">
      {label}: {text} ET
    </StatusPill>
  )
}

// ── Card / panel ─────────────────────────────────────────────────────────────────
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-[#0c1120]/80 p-4 shadow-[0_18px_60px_-46px_rgba(124,92,255,0.55)] sm:p-5 ${className}`}
    >
      {title || action ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/55">{eyebrow}</p>
            ) : null}
            {title ? <h3 className="text-sm font-black tracking-tight text-white">{title}</h3> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

/**
 * Health-row metric card. Renders a value with an honest tone. When `tracked`
 * is false the value is shown muted and treated as Unknown/Not-configured —
 * never as a healthy 0. No fabricated trend/sparkline.
 */
export function MetricCard({
  label,
  value,
  tone = "unknown",
  note,
  tracked = true,
}: {
  label: string
  value: ReactNode
  tone?: OperatorTone
  note?: ReactNode
  tracked?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c1120]/80 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <span className={`inline-block h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      </div>
      <p className={`mt-2 text-2xl font-black tracking-tight ${tracked ? "text-white" : "text-slate-500"}`}>
        {value}
      </p>
      {note ? <p className="mt-1 text-[11px] leading-4 text-slate-400">{note}</p> : null}
    </div>
  )
}

// ── Section chrome ───────────────────────────────────────────────────────────────
export function SectionHeader({
  title,
  description,
  status,
  action,
}: {
  title: string
  description?: string
  status?: OperatorSectionStatus
  action?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
          {status ? <SectionStatusPill status={status} /> : null}
        </div>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

/**
 * Placeholder for "planned" sections. States plainly that no data source is
 * wired yet and lists what will back it — instead of an empty/fake dashboard.
 */
export function SectionPlaceholder({
  title,
  description,
  willInclude,
  note,
}: {
  title: string
  description: string
  willInclude?: string[]
  note?: string
}) {
  return (
    <Panel className="border-dashed">
      <div className="flex flex-col items-start gap-3">
        <StatusPill tone="unknown">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden />
          Planned — not wired yet
        </StatusPill>
        <h3 className="text-lg font-black text-white">{title}</h3>
        <p className="max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        {willInclude && willInclude.length > 0 ? (
          <div className="w-full">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Will include</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {willInclude.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-violet-400/70" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {note ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">{note}</p>
        ) : null}
      </div>
    </Panel>
  )
}

export function PartialDataWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs leading-5 text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

/** Muted "Unknown" value — for metrics with no monitoring data. */
export function UnknownValue({ label = "Unknown" }: { label?: string }) {
  return <span className="text-slate-500">{label}</span>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/12 py-8 text-center text-xs text-slate-500">
      {children}
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────────────
export function TableScroll({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`border-b border-white/[0.05] px-3 py-2 align-middle text-slate-200 ${className}`}>{children}</td>
}

/** Small labelled key/value stat used inside panels. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: OperatorTone }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-black ${tone ? TONE_TEXT[tone] : "text-white"}`}>{value}</p>
    </div>
  )
}
