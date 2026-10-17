"use client"

import { useMemo, useState } from "react"
import { Check, Copy, Share2 } from "lucide-react"
import type { WorldCupLeaderboardRow } from "@/lib/world-cup/types"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

type InviteShare = {
  kind: "invite"
  poolName: string
  inviteUrl: string
  inviteCode?: string | null
}

type LeaderboardShare = {
  kind: "leaderboard"
  poolName: string
  leaderboard: WorldCupLeaderboardRow[]
}

type BracketShare = {
  kind: "bracket"
  poolName: string
  entryName: string
  rank?: number | null
  totalScore: number
  championName?: string | null
  isComplete: boolean
}

type RecapShare = {
  kind: "recap"
  poolName: string
  recapBody: string
}

type Props = (InviteShare | LeaderboardShare | BracketShare | RecapShare) & {
  className?: string
}

const POWERED_BY = "Powered by AllFantasy."

function cleanShareText(text: string) {
  return text
    .replace(/\bDFS\b/gi, "fantasy")
    .replace(/\bbetting\b/gi, "prediction")
    .replace(/\bwager(?:ing|s|ed)?\b/gi, "prediction")
    .replace(/\bsportsbook\b/gi, "sports platform")
    .replace(/\bodds\b/gi, "projection")
    .replace(/\s+\n/g, "\n")
    .trim()
}

function buildShareText(props: Props) {
  if (props.kind === "invite") {
    return cleanShareText([
      `Join my World Cup Bracket Pool on AllFantasy: ${props.poolName}.`,
      props.inviteCode ? `Invite code: ${props.inviteCode}` : null,
      props.inviteUrl,
      POWERED_BY,
    ].filter(Boolean).join("\n"))
  }

  if (props.kind === "leaderboard") {
    const rows = props.leaderboard.slice(0, 5)
    return cleanShareText([
      `Current pool leaderboard: ${props.poolName}.`,
      rows.length > 0
        ? rows.map((row) => `#${row.rank} ${row.entryName} - ${row.totalScore} pts`).join("\n")
        : "No finalized leaderboard entries yet.",
      POWERED_BY,
    ].join("\n"))
  }

  if (props.kind === "bracket") {
    return cleanShareText([
      `My World Cup bracket is ${props.isComplete ? "locked in" : "in progress"} on AllFantasy.`,
      `${props.entryName} - ${props.totalScore} pts${props.rank ? ` - rank #${props.rank}` : ""}.`,
      props.championName ? `Champion pick: ${props.championName}.` : null,
      POWERED_BY,
    ].filter(Boolean).join("\n"))
  }

  return cleanShareText([
    `AI recap from ${props.poolName}:`,
    props.recapBody.slice(0, 700),
    POWERED_BY,
  ].join("\n"))
}

export default function WorldCupShareCard(props: Props) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => buildShareText(props), [props])

  const tShareTitle = (kind: Props["kind"]) => {
    if (kind === "invite") return t("wc.share.titleInvite")
    if (kind === "leaderboard") return t("wc.share.titleLeaderboard")
    if (kind === "bracket") return t("wc.share.titleBracket")
    return t("wc.share.titleRecap")
  }

  async function copyShareText() {
    await navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: tShareTitle(props.kind), text })
        return
      } catch {
        // Fall back to clipboard when native share is cancelled or unavailable.
      }
    }
    await copyShareText()
  }

  return (
    <section
      data-testid={`world-cup-share-card-${props.kind}`}
      className={[
        "rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.09] to-white/[0.035] p-4",
        props.className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/50">{t("wc.share.eyebrow")}</p>
          <h3 className="mt-1 text-base font-black text-white">{tShareTitle(props.kind)}</h3>
          <p className="mt-1 text-xs leading-5 text-white/50">
            {t("wc.share.description")}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-white/45">
          {t("wc.share.publicSafe")}
        </span>
      </div>

      <div data-testid={`world-cup-share-preview-${props.kind}`} className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-5 text-white/75">
        {text}
      </div>

      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={copyShareText}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black touch-manipulation sm:w-auto"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? t("wc.share.copied") : t("wc.share.copy")}
        </button>
        <button
          type="button"
          onClick={nativeShare}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/75 touch-manipulation sm:w-auto"
        >
          <Share2 className="h-4 w-4" />
          {t("wc.share.share")}
        </button>
      </div>
    </section>
  )
}
