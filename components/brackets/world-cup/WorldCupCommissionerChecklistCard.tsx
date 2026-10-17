"use client"

import { useMemo, useState } from "react"
import { Check, ClipboardCheck, Copy, MessageSquare, Users } from "lucide-react"
import {
  buildWorldCupCommissionerChecklist,
  type BuildChecklistInput,
  type ChecklistEntryStatus,
} from "@/lib/world-cup/worldCupCommissionerChecklist"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

const STATUS_TONE: Record<ChecklistEntryStatus, string> = {
  Finalized: "border-emerald-300/40 bg-emerald-400/[0.08] text-white/90",
  "In progress": "border-amber-300/35 bg-amber-300/[0.08] text-white/80",
  "Needs picks": "border-rose-300/35 bg-rose-500/[0.08] text-white/85",
  Unknown: "border-white/15 bg-white/[0.04] text-white/75",
}

// Maps the deterministic English status label (kept stable on the
// result object for color-map continuity + test stability) to the
// translation key for the rendered label.
const STATUS_KEY: Record<ChecklistEntryStatus, string> = {
  Finalized: "wc.checklist.entryStatus.finalized",
  "In progress": "wc.checklist.entryStatus.inProgress",
  "Needs picks": "wc.checklist.entryStatus.needsPicks",
  Unknown: "wc.checklist.entryStatus.unknown",
}

export default function WorldCupCommissionerChecklistCard(props: BuildChecklistInput) {
  // Hydration-safe: locale comes from the global LanguageProviderClient.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  // Pass the locale into the helper so the reminder/member-fallback
  // text is generated in the commissioner's language.
  const result = useMemo(
    () =>
      buildWorldCupCommissionerChecklist({
        ...props,
        locale: language,
      }),
    [props, language]
  )
  const [copied, setCopied] = useState(false)

  async function copyReminder() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(result.reminderMessage)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section
      data-testid="world-cup-commissioner-checklist"
      className="rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-4 backdrop-blur"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <ClipboardCheck className="h-4 w-4 text-white/85" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
              {t("wc.checklist.eyebrow")}
            </p>
            <h3 className="text-base font-black text-white sm:text-lg">
              {t("wc.checklist.title")}
            </h3>
            <p className="mt-0.5 text-xs text-white/55">
              {t("wc.checklist.cardSubtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={copyReminder}
          data-testid="world-cup-commissioner-checklist-copy-reminder"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          {copied ? t("wc.checklist.copyReminderDone") : t("wc.checklist.copyReminderBtn")}
        </button>
      </div>

      {/* Summary counts */}
      <div
        data-testid="world-cup-commissioner-checklist-summary"
        className="grid gap-2 sm:grid-cols-4"
      >
        <StatCell label={t("wc.checklist.stat.total")} value={String(result.summary.totalEntries)} />
        <StatCell label={t("wc.checklist.stat.finalized")} value={String(result.summary.finalized)} tone="ready" />
        <StatCell label={t("wc.checklist.stat.inProgress")} value={String(result.summary.inProgress)} tone="warn" />
        <StatCell
          label={t("wc.checklist.stat.completion")}
          value={`${result.summary.percentComplete}%`}
          tone={result.summary.percentComplete === 100 ? "ready" : "warn"}
        />
      </div>

      {/* Empty / no-data states */}
      {result.status !== "ready" ? (
        <div
          data-testid={`world-cup-commissioner-checklist-${result.status}`}
          className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/65"
        >
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden />
          <span>
            {result.emptyLines?.[0] ?? t("wc.checklist.empty.fallback")}
          </span>
        </div>
      ) : null}

      {/* Rows */}
      {result.status === "ready" && result.rows.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {result.rows.map((row, idx) => (
            <li
              key={`${row.entryName}:${idx}`}
              data-testid={`world-cup-commissioner-checklist-row-${idx}`}
              className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between ${STATUS_TONE[row.status]}`}
            >
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wider text-white">
                  {row.entryName}
                </p>
                <p
                  data-testid={`world-cup-commissioner-checklist-row-${idx}-name`}
                  className="mt-0.5 text-[11px] text-white/75"
                >
                  {row.displayName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  data-testid={`world-cup-commissioner-checklist-row-${idx}-status`}
                  className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/85"
                >
                  {t(STATUS_KEY[row.status])}
                </span>
                {row.missingPicks > 0 ? (
                  <span className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/75">
                    {t("wc.checklist.missingPicks", { count: row.missingPicks })}
                  </span>
                ) : null}
                {row.status !== "Finalized" ? (
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/90">
                    {t("wc.checklist.needsReminderBadge")}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <details
        className="mt-3"
        data-testid="world-cup-commissioner-checklist-reminder-preview"
      >
        <summary className="cursor-pointer text-[11px] font-semibold text-white/45 hover:text-white/75">
          {t("wc.checklist.previewReminder")}
        </summary>
        <div className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs leading-5 text-white/80">
          {result.reminderMessage}
        </div>
      </details>

      <p className="mt-3 text-[11px] text-white/40">
        {t("wc.checklist.privacyNote")}
      </p>
    </section>
  )
}

function StatCell({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "ready" | "warn"
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="text-[11px] font-black uppercase tracking-widest text-white/45">
        {label}
      </div>
      <div
        className={`mt-0.5 text-lg font-black tabular-nums ${
          tone === "ready" ? "text-white/85" : tone === "warn" ? "text-white/75" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  )
}
