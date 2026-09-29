"use client"
import { useMemo, useState } from "react"
import {
  Check,
  Copy,
  Link2,
  Lock,
  MessageSquare,
  Share2,
  Trophy,
  Users,
  Zap,
} from "lucide-react"
import type { WorldCupChallengeView } from "@/lib/world-cup/types"
import WorldCupShareCard from "./WorldCupShareCards"
import { buildWorldCupInviteMessage } from "@/lib/world-cup/worldCupShareCopy"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs">
      <span className="font-semibold text-white/55">{label}</span>
      <span className="font-bold text-white/85">{value}</span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorldCupInvitePanel({
  view,
  isCommissioner = false,
  switchTab,
}: {
  view: WorldCupChallengeView
  isCommissioner?: boolean
  switchTab?: (tab: string) => void
}) {
  // Hydration-safe: locale comes from the global LanguageProviderClient
  // which sources from <html data-lang>. SSR HTML matches first CSR.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedInviteMessage, setCopiedInviteMessage] = useState(false)
  const [copiedSocial, setCopiedSocial] = useState<number | null>(null)

  const challenge = view.challenge
  const inviteUrl =
    challenge.inviteUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/join/bracket/${challenge.inviteCode}`
      : `https://allfantasy.com/join/bracket/${challenge.inviteCode}`)
  const inviteCode = challenge.inviteCode ?? null

  // Translated share message for the native share text. Uses the
  // generic template with locale-aware copy. The hashtag block is NOT
  // included here — only inside buildWorldCupSocialCaptions.
  const shareMessage = t("wc.inviteTab.shareMessage.default", {
    pool: challenge.name,
    maxEntries: challenge.maxEntriesPerParticipant,
    url: inviteUrl,
  })

  const isLocked =
    challenge.status === "locked" ||
    challenge.status === "final"

  const participantCount = Math.max(
    challenge.participantCount,
    view.leaderboard?.length ?? 0,
    view.participant ? 1 : 0
  )
  const maxParticipants = challenge.maxParticipants ?? 0
  const spotsLeft = maxParticipants > 0 ? Math.max(0, maxParticipants - participantCount) : null
  const isPoolFull = spotsLeft !== null && spotsLeft === 0

  const lockDeadlineLabel = useMemo(() => {
    const iso = challenge.effectivePickLockAt || challenge.pickLockAt
    if (!iso) return null
    try {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    } catch {
      return null
    }
  }, [challenge.effectivePickLockAt, challenge.pickLockAt])

  // Privacy: helper enforces invite code is only surfaced for the
  // commissioner audience. The audience flag is the canonical guard;
  // we still pass `inviteCode: null` for members as belt-and-suspenders.
  const inviteMessageResult = useMemo(
    () =>
      buildWorldCupInviteMessage({
        poolName: challenge.name,
        inviteUrl,
        inviteCode: isCommissioner ? inviteCode : null,
        lockDeadlineLabel,
        audience: isCommissioner ? "commissioner" : "member",
        locale: language,
      }),
    [challenge.name, inviteUrl, inviteCode, isCommissioner, lockDeadlineLabel, language]
  )

  // Social copy templates
  const socialTemplates = useMemo(
    () => [
      t("wc.inviteTab.social.copy1") + (inviteUrl ? `\n${inviteUrl}` : ""),
      t("wc.inviteTab.social.copy2"),
      t("wc.inviteTab.social.copy3"),
    ],
    [t, inviteUrl]
  )

  // Show growth nudge when pool has few participants and isn't locked/full
  const showGrowthNudge = participantCount < 5 && !isLocked && !isPoolFull

  async function copyLink() {
    await navigator.clipboard?.writeText(inviteUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1600)
  }

  async function copyCode() {
    if (!inviteCode) return
    await navigator.clipboard?.writeText(inviteCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 1600)
  }

  async function copyInviteMessage() {
    // Member-blocked path is guarded by the button only rendering for commissioners,
    // but the helper also returns a safe fallback for non-commissioners as a backstop.
    if (!isCommissioner) return
    await navigator.clipboard?.writeText(inviteMessageResult.message)
    setCopiedInviteMessage(true)
    setTimeout(() => setCopiedInviteMessage(false), 1600)
  }

  async function copySocial(idx: number) {
    await navigator.clipboard?.writeText(socialTemplates[idx] ?? "")
    setCopiedSocial(idx)
    setTimeout(() => setCopiedSocial(null), 1600)
  }

  async function shareNative() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: t("wc.inviteTab.shareTitleNative", { pool: challenge.name }),
          text: shareMessage,
          url: inviteUrl,
        })
        return
      } catch {
        // user cancelled or share not supported — fall through to copy
      }
    }
    await copyLink()
  }

  return (
    <div className="mode-readable mx-auto max-w-2xl px-4 py-6 pb-28 sm:pb-8" aria-label={t("wc.inviteTab.title")}>

      {/* ── Invite Hero ─────────────────────────────────────────────── */}
      <div
        data-testid="wc-invite-hero"
        className="mb-5 overflow-hidden rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.10] via-cyan-300/[0.05] to-transparent p-5 backdrop-blur"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/15">
            <Trophy className="h-4 w-4 text-white/80" aria-hidden />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
              {t("wc.inviteTab.eyebrow")}
            </p>
            <h2 className="text-lg font-black text-white">
              {t("wc.inviteTab.hero.title")}
            </h2>
          </div>
        </div>
        <p className="mb-4 text-sm leading-5 text-white/65">
          {t("wc.inviteTab.hero.subtitle")}
        </p>
        {/* Meta pills */}
        <div className="flex flex-wrap gap-2" data-testid="wc-invite-hero-pills">
          {/* Participant count */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/80">
            <Users className="h-3 w-3 text-white/60" aria-hidden />
            {t("wc.inviteTab.hero.participants", { count: participantCount })}
          </span>
          {/* Spots left / Pool full */}
          {spotsLeft !== null && (
            isPoolFull ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/60">
                {t("wc.inviteTab.hero.poolFull")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-1 text-[11px] font-bold text-white/80">
                {t("wc.inviteTab.hero.spotsLeft", { n: spotsLeft })}
              </span>
            )
          )}
          {/* Privacy badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/70">
            {challenge.visibility === "public"
              ? t("wc.inviteTab.meta.privacyPublic")
              : t("wc.inviteTab.meta.privacyPrivate")}
          </span>
          {/* Lock deadline */}
          {lockDeadlineLabel && !isLocked && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/70">
              <Lock className="h-3 w-3 text-white/50" aria-hidden />
              {t("wc.inviteTab.hero.lockDeadline", { date: lockDeadlineLabel })}
            </span>
          )}
        </div>
      </div>

      {/* ── Growth Nudge ────────────────────────────────────────────── */}
      {showGrowthNudge && (
        <div
          data-testid="wc-invite-growth-nudge"
          className="mb-5 flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 backdrop-blur"
        >
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-300/15">
            <Zap className="h-3.5 w-3.5 text-white/80" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white/90">
              {t("wc.inviteTab.growth.title")}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-white/55">
              {t("wc.inviteTab.growth.body")}
            </p>
          </div>
          <button
            type="button"
            onClick={shareNative}
            className="shrink-0 rounded-lg bg-gradient-to-r from-cyan-300 to-cyan-200 px-3 py-1.5 text-[11px] font-black text-black shadow-[0_4px_14px_-6px_rgba(34,211,238,0.55)] transition-transform hover:scale-[1.03] active:scale-[0.97] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          >
            {t("wc.inviteTab.growth.cta")}
          </button>
        </div>
      )}

      {/* ── Invite Link ─────────────────────────────────────────────── */}
      {/* Pool metadata */}
      <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
          {t("wc.inviteTab.detailsTitle")}
        </h3>
        <div className="space-y-2">
          <MetaRow label={t("wc.inviteTab.meta.pool")} value={challenge.name} />
          <MetaRow
            label={t("wc.inviteTab.meta.privacy")}
            value={
              challenge.visibility === "public"
                ? t("wc.inviteTab.meta.privacyPublic")
                : t("wc.inviteTab.meta.privacyPrivate")
            }
          />
          <MetaRow
            label={t("wc.inviteTab.meta.maxUsers")}
            value={`${participantCount} / ${challenge.maxParticipants}`}
          />
          <MetaRow
            label={t("wc.inviteTab.meta.bracketsPerUser")}
            value={String(challenge.maxEntriesPerParticipant)}
          />
          <MetaRow
            label={t("wc.inviteTab.meta.scoring")}
            value={t("wc.inviteTab.meta.scoringValue")}
          />
          <MetaRow
            label={t("wc.inviteTab.meta.lockRule")}
            value={
              challenge.pickLockStrategy === "tournament_start"
                ? t("wc.inviteTab.meta.lockTournament")
                : t("wc.inviteTab.meta.lockPerMatch")
            }
          />
          {isLocked && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/80">
              <Lock className="h-3 w-3 shrink-0" />
              {t("wc.inviteTab.lockedBanner")}
            </div>
          )}
        </div>
      </div>

      {/* Commissioner invite section OR member share section */}
      {!isCommissioner ? (
        /* Member section: show the invite URL + share buttons so members can bring in friends */
        <div
          data-testid="wc-invite-member-banner"
          className="rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-5 backdrop-blur"
        >
          <div className="flex items-center gap-2 text-base font-black text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-300/15 text-white/70">
              <Share2 className="h-4 w-4" />
            </span>
            {t("wc.inviteTab.member.title")}
          </div>
          <p className="mt-1 text-xs text-white/55">
            {t("wc.inviteTab.member.body")}
          </p>

          {/* Invite URL display */}
          <div className="mt-4 break-all rounded-xl border border-white/10 bg-black/40 px-3 py-3 font-mono text-xs leading-5 text-white/85">
            {inviteUrl}
          </div>

          {/* Share action buttons */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={copyLink}
              data-testid="wc-invite-member-copy-link-btn"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-cyan-200 px-4 py-2.5 text-sm font-black text-black shadow-[0_6px_20px_-8px_rgba(34,211,238,0.6)] transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 sm:w-auto"
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedLink ? t("wc.inviteTab.commissioner.copyLinkDone") : t("wc.inviteTab.commissioner.copyLink")}
            </button>
            <button
              type="button"
              onClick={shareNative}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm font-bold text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.09] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
            >
              <Share2 className="h-4 w-4" />
              {t("wc.inviteTab.commissioner.share")}
            </button>
          </div>
        </div>
      ) : inviteCode ? (
        <>
          <div
            data-testid="wc-invite-commissioner-panel"
            className="rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-5 backdrop-blur"
          >
            <div className="flex items-center gap-2 text-base font-black text-white">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-300/15 text-white/70">
                <Link2 className="h-4 w-4" />
              </span>
              {t("wc.inviteTab.commissioner.linkTitle")}
            </div>
            <p className="mt-1 text-xs text-white/55">
              {t("wc.inviteTab.commissioner.linkHelper")}
            </p>

            {/* URL box */}
            <div className="mt-4 break-all rounded-xl border border-white/10 bg-black/40 px-3 py-3 font-mono text-xs leading-5 text-white/85">
              {inviteUrl}
            </div>

            {/* Invite code */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">
                  {t("wc.inviteTab.commissioner.codeLabel")}
                </div>
                <div
                  data-testid="wc-invite-code-display"
                  className="mt-0.5 truncate font-mono text-base font-black tracking-[0.2em] text-white"
                >
                  {inviteCode}
                </div>
              </div>
              <button
                type="button"
                onClick={copyCode}
                data-testid="wc-invite-copy-code-btn"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              >
                {copiedCode ? <Check className="h-3.5 w-3.5 text-white/80" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCode ? t("wc.inviteTab.commissioner.copyCodeDone") : t("wc.inviteTab.commissioner.copyCode")}
              </button>
            </div>

            {/* Action buttons — full-width on mobile */}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={copyLink}
                data-testid="wc-invite-copy-link-btn"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-cyan-200 px-4 py-2.5 text-sm font-black text-black shadow-[0_6px_20px_-8px_rgba(34,211,238,0.6)] transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto"
              >
                {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedLink ? t("wc.inviteTab.commissioner.copyLinkDone") : t("wc.inviteTab.commissioner.copyLink")}
              </button>
              <button
                type="button"
                onClick={copyInviteMessage}
                data-testid="wc-invite-copy-message-btn"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition-colors hover:border-white/30 hover:bg-white/[0.10] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
              >
                {copiedInviteMessage ? <Check className="h-4 w-4 text-white/80" /> : <MessageSquare className="h-4 w-4" />}
                {copiedInviteMessage ? t("wc.inviteTab.commissioner.copyMessageDone") : t("wc.inviteTab.commissioner.copyMessage")}
              </button>
              <button
                type="button"
                onClick={shareNative}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm font-bold text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.09] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
              >
                <Share2 className="h-4 w-4" />
                {t("wc.inviteTab.commissioner.share")}
              </button>
            </div>

            {/* Invite message preview */}
            <details className="mt-3" data-testid="wc-invite-message-preview">
              <summary className="cursor-pointer text-[11px] font-semibold text-white/45 hover:text-white/75">
                {t("wc.inviteTab.commissioner.previewInvite")}
              </summary>
              <div className="mt-2 whitespace-pre-wrap rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-3 text-xs leading-5 text-white/80">
                {inviteMessageResult.message}
              </div>
            </details>

            {/* Share message preview */}
            <details className="mt-4">
              <summary className="cursor-pointer text-[11px] font-semibold text-white/45 hover:text-white/75">
                {t("wc.inviteTab.commissioner.previewShare")}
              </summary>
              <div className="mt-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-3 text-xs leading-5 text-white/65">
                {shareMessage}
              </div>
            </details>
          </div>
          <WorldCupShareCard
            kind="invite"
            poolName={challenge.name}
            inviteUrl={inviteUrl}
            inviteCode={inviteCode}
            className="mt-4"
          />
        </>
      ) : (
        /* Commissioner: no invite code set — friendly fallback */
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-10 text-center backdrop-blur">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Users className="h-5 w-5 text-white/35" />
          </div>
          <p className="text-sm font-bold text-white/70">{t("wc.inviteTab.commissioner.noCodeTitle")}</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/45">
            {t("wc.inviteTab.commissioner.noCodeBody")}
          </p>
        </div>
      )}

      {/* ── Social Copy Templates ─────────────────────────────────── */}
      <div
        data-testid="wc-invite-social-templates"
        className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur"
      >
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
          {t("wc.inviteTab.social.title")}
        </h3>
        <div className="space-y-2">
          {socialTemplates.map((text, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3"
            >
              <p className="min-w-0 flex-1 text-xs leading-5 text-white/75 break-words">
                {text}
              </p>
              <button
                type="button"
                onClick={() => copySocial(idx)}
                aria-label={t("wc.inviteTab.social.copyBtn")}
                className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-bold text-white/65 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              >
                {copiedSocial === idx
                  ? <Check className="h-3.5 w-3.5 text-white/80" />
                  : <Copy className="h-3.5 w-3.5" />}
                {copiedSocial === idx
                  ? t("wc.inviteTab.social.copiedBtn")
                  : t("wc.inviteTab.social.copyBtn")}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Quick Action Cards ───────────────────────────────────────── */}
      <div
        data-testid="wc-invite-quick-actions"
        className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {/* View Leaderboard */}
        <button
          type="button"
          onClick={() => switchTab?.("leaderboard")}
          className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08]">
            <Trophy className="h-4 w-4 text-white/70" aria-hidden />
          </div>
          <span className="text-sm font-bold text-white/80 group-hover:text-white">
            {t("wc.inviteTab.actions.viewLeaderboard")}
          </span>
        </button>

        {/* Open Pool Chat — triggers native share to messaging apps */}
        <button
          type="button"
          onClick={shareNative}
          className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
            <MessageSquare className="h-4 w-4 text-white/70" aria-hidden />
          </div>
          <span className="text-sm font-bold text-white/80 group-hover:text-white">
            {t("wc.inviteTab.actions.openChat")}
          </span>
        </button>

        {/* Share on Mobile */}
        <button
          type="button"
          onClick={shareNative}
          className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
            <Share2 className="h-4 w-4 text-white/70" aria-hidden />
          </div>
          <span className="text-sm font-bold text-white/80 group-hover:text-white">
            {t("wc.inviteTab.actions.shareLink")}
          </span>
        </button>
      </div>

      {/* ── Trust Note ───────────────────────────────────────────────── */}
      <p
        data-testid="wc-invite-trust-note"
        className="mt-6 text-center text-[11px] leading-5 text-white/35"
      >
        {t("wc.inviteTab.trustNote")}
      </p>
    </div>
  )
}
