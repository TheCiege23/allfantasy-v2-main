"use client"
/**
 * Operator Command Center — left navigation.
 *
 * Grouped, keyboard-navigable nav driven entirely by OPERATOR_SECTIONS so the
 * sidebar can never drift from the section router. Each item carries an honest
 * status dot (live / partial / planned) so operators know what is real before
 * they click.
 */
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  OPERATOR_SECTIONS,
  OPERATOR_GROUP_LABELS,
  OPERATOR_BASE_PATH,
  operatorSectionHref,
  type OperatorSectionGroup,
  type OperatorSectionStatus,
} from "@/lib/admin-dashboard/operatorNav"
import type { OperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"
import { OperatorIcon, TONE_DOT } from "@/components/admin/operator/primitives"

const GROUP_ORDER: OperatorSectionGroup[] = ["command", "operations", "business", "governance"]

const STATUS_DOT: Record<OperatorSectionStatus, string> = {
  live: TONE_DOT.healthy,
  partial: TONE_DOT.warn,
  planned: TONE_DOT.unknown,
}

const STATUS_TITLE: Record<OperatorSectionStatus, string> = {
  live: "Live — backed by real data",
  partial: "Partial — some data wired, gaps labelled",
  planned: "Planned — not wired yet",
}

function isActive(pathname: string, href: string): boolean {
  if (href === OPERATOR_BASE_PATH) return pathname === OPERATOR_BASE_PATH
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function OperatorSidebar({
  environment,
  onNavigate,
}: {
  environment: OperatorEnvironment
  onNavigate?: () => void
}) {
  const pathname = usePathname() || OPERATOR_BASE_PATH

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/af-crest.png"
          alt="AllFantasy"
          width={34}
          height={34}
          className="h-[34px] w-[34px] rounded-lg border border-white/10 object-cover"
        />
        <div className="leading-tight">
          <p className="text-sm font-black tracking-tight text-white">ALLFANTASY</p>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300/70">Operator</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Operator sections">
        {GROUP_ORDER.map((group) => {
          const sections = OPERATOR_SECTIONS.filter((s) => s.group === group)
          if (sections.length === 0) return null
          const groupLabel = OPERATOR_GROUP_LABELS[group]
          return (
            <div key={group} className="mb-1.5">
              {groupLabel ? (
                <p className="px-3 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {groupLabel}
                </p>
              ) : (
                <div className="pt-1" />
              )}
              <ul className="space-y-0.5">
                {sections.map((section) => {
                  const href = operatorSectionHref(section)
                  const active = isActive(pathname, href)
                  return (
                    <li key={section.slug || "overview"}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition",
                          active
                            ? "bg-violet-500/15 text-white"
                            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
                        ].join(" ")}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-violet-400" aria-hidden />
                        ) : null}
                        <OperatorIcon
                          name={section.icon}
                          className={`h-[17px] w-[17px] shrink-0 ${active ? "text-violet-300" : "text-slate-500 group-hover:text-slate-300"}`}
                        />
                        <span className="flex-1 truncate">{section.label}</span>
                        {section.badge ? (
                          <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-200">
                            {section.badge}
                          </span>
                        ) : null}
                        <span
                          title={STATUS_TITLE[section.status]}
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[section.status]} ${
                            active ? "opacity-100" : "opacity-60"
                          }`}
                          aria-hidden
                        />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Environment footer */}
      <div className="border-t border-white/[0.06] px-4 py-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Environment</p>
            <p className="truncate text-xs font-bold text-slate-200">{environment.label}</p>
          </div>
          <Link
            href={`${OPERATOR_BASE_PATH}/system-settings`}
            onClick={onNavigate}
            className="text-[11px] font-bold text-violet-300 hover:text-violet-200"
          >
            Status
          </Link>
        </div>
      </div>
    </div>
  )
}
