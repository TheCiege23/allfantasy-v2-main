"use client"

import { AlertTriangle, Lock, Radio, ShieldAlert, Sparkles } from "lucide-react"
import {
  buildWorldCupKnockoutDangerZones,
  type BuildDangerZonesInput,
  type DangerSeverity,
  type DangerTag,
} from "@/lib/world-cup/worldCupKnockoutDangerZones"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

const SEVERITY_TONE: Record<DangerSeverity, string> = {
  High: "border-rose-400/45 bg-rose-500/[0.08]",
  Medium: "border-amber-300/40 bg-amber-300/[0.08]",
  Low: "border-white/15 bg-white/[0.04]",
}

const SEVERITY_KEY: Record<DangerSeverity, string> = {
  High: "wc.danger.severityHigh",
  Medium: "wc.danger.severityMedium",
  Low: "wc.danger.severityLow",
}

function TagIcon({ tag }: { tag: DangerTag }) {
  if (tag === "Already eliminated") return <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
  if (tag === "Live now") return <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
  return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
}

export default function WorldCupKnockoutDangerZonesCard(props: BuildDangerZonesInput) {
  const result = buildWorldCupKnockoutDangerZones(props)
  const isPro = Boolean(props.hasBracketBrainAi)
  // Hydration-safe: the language code originates from <html data-lang="...">
  // already emitted by the server-side language init script. SSR and the
  // first CSR render see the same locale.
  const { language } = useOptionalLanguage()
  const t = makeWcT(language)

  return (
    <section
      data-testid="world-cup-knockout-danger-zones"
      className="rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-4 backdrop-blur"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <Sparkles className="h-4 w-4 text-white/85" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
              {t("wc.danger.eyebrow")}
            </p>
            <h3 className="text-base font-black text-white sm:text-lg">
              {t("wc.danger.title")}
            </h3>
            <p className="mt-0.5 text-xs text-white/55">
              {t("wc.danger.subtitle")}
            </p>
          </div>
        </div>
        <span
          data-testid="world-cup-knockout-danger-zones-tier"
          className={
            isPro
              ? "shrink-0 rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90"
              : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/65"
          }
        >
          {isPro ? t("wc.danger.tierPro") : t("wc.danger.tierBasic")}
        </span>
      </div>

      {result.status === "no_entry" ? (
        <p
          data-testid="world-cup-knockout-danger-zones-empty"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/65"
        >
          {t("wc.danger.emptyNoEntry")}
        </p>
      ) : null}

      {result.status === "no_picks" || result.status === "no_risks" ? (
        <p
          data-testid={`world-cup-knockout-danger-zones-${result.status}`}
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/65"
        >
          {result.lockedLines?.[0] ??
            (result.status === "no_picks"
              ? t("wc.danger.emptyNoPicks")
              : t("wc.danger.emptyNoRisks"))}
        </p>
      ) : null}

      {result.status === "ready" && result.zones.length > 0 ? (
        <ul className="space-y-2">
          {result.zones.map((zone, idx) => (
            <li
              key={`${zone.matchId}:${idx}`}
              data-testid={`world-cup-knockout-danger-zones-zone-${idx}`}
              className={`rounded-xl border px-3 py-2.5 text-white/90 ${SEVERITY_TONE[zone.severity]}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <TagIcon tag={zone.tag} />
                <span className="text-xs font-black uppercase tracking-wider text-white">
                  {zone.label}
                </span>
                <span
                  data-testid={`world-cup-knockout-danger-zones-severity-${idx}`}
                  className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/75"
                >
                  {t(SEVERITY_KEY[zone.severity])} {t("wc.danger.severitySuffix")}
                </span>
                <span className="rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/75">
                  {zone.tag}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] font-bold text-white/75">
                {zone.roundLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/70">{zone.description}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {result.lockedLines && result.status === "ready" ? (
        <div className="mt-2 space-y-1">
          {result.lockedLines.map((line, idx) => (
            <p
              key={idx}
              data-testid={`world-cup-knockout-danger-zones-locked-${idx}`}
              className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-white/55"
            >
              <Lock className="mt-0.5 h-3 w-3 shrink-0 text-white/40" aria-hidden />
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-white/40">
        {t("wc.danger.footer")}
      </p>
    </section>
  )
}
