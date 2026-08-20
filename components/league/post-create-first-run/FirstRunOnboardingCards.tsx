'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarClock, ClipboardCheck, Copy, MessageCircle, Settings2, Shuffle, UserPlus, Users } from 'lucide-react'
import type { ReadinessChecklistItem } from '@/lib/league/first-run-readiness'
import { FIRST_RUN_COPY } from '@/lib/league/first-run-i18n'
import { cn } from '@/lib/utils'

function CardShell({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.08] bg-[#060d1c]/90 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)]',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

export function InviteManagersCard({
  inviteToken,
  onOpenInviteSettings,
}: {
  inviteToken: string
  onOpenInviteSettings: () => void
}) {
  const hasInvite = Boolean(inviteToken.trim())
  const joinPath = hasInvite ? `/join/${encodeURIComponent(inviteToken.trim())}` : ''

  const copyInvite = async () => {
    if (!hasInvite || typeof window === 'undefined') return
    const url = `${window.location.origin}${joinPath}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
  }

  return (
    <CardShell title={FIRST_RUN_COPY.inviteCardTitle}>
      <p className="text-[12px] leading-relaxed text-white/60">
        {hasInvite ? FIRST_RUN_COPY.inviteCardBodyHasToken : FIRST_RUN_COPY.inviteCardBodyNoToken}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenInviteSettings}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15"
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          {FIRST_RUN_COPY.inviteOpenSettings}
        </button>
        {hasInvite ? (
          <>
            <button
              type="button"
              onClick={copyInvite}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {FIRST_RUN_COPY.inviteCopyLink}
            </button>
            <Link
              href={joinPath}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/75 hover:border-white/20 hover:text-white/90"
            >
              {FIRST_RUN_COPY.invitePreviewJoin}
            </Link>
          </>
        ) : null}
      </div>
    </CardShell>
  )
}

export function DraftSetupCard({
  draftDateIso,
  onOpenDraftTab,
  onOpenDraftSettings,
}: {
  draftDateIso: string | null
  onOpenDraftTab: () => void
  onOpenDraftSettings: () => void
}) {
  const scheduled = Boolean(draftDateIso)
  const label = scheduled
    ? new Date(draftDateIso as string).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : FIRST_RUN_COPY.draftCardScheduledFallback

  return (
    <CardShell title={FIRST_RUN_COPY.draftCardTitle}>
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-sky-300/80" aria-hidden />
        <div>
          <p className="text-[12px] font-medium text-white/85">{label}</p>
          <p className="mt-0.5 text-[11px] text-white/55">{FIRST_RUN_COPY.draftCardHint}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenDraftTab}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
        >
          {FIRST_RUN_COPY.draftOpenTab}
        </button>
        <button
          type="button"
          onClick={onOpenDraftSettings}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15"
        >
          {FIRST_RUN_COPY.draftOpenSettings}
        </button>
      </div>
    </CardShell>
  )
}

export function LeagueChatCard({ onOpenLeagueChat }: { onOpenLeagueChat: () => void }) {
  return (
    <CardShell title={FIRST_RUN_COPY.chatCardTitle}>
      <p className="text-[12px] text-white/60">{FIRST_RUN_COPY.chatCardBody}</p>
      <button
        type="button"
        onClick={onOpenLeagueChat}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
      >
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        {FIRST_RUN_COPY.chatOpen}
      </button>
    </CardShell>
  )
}

export function CommissionerSettingsCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <CardShell title={FIRST_RUN_COPY.settingsCardTitle}>
      <p className="text-[12px] text-white/60">{FIRST_RUN_COPY.settingsCardBody}</p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
        {FIRST_RUN_COPY.settingsOpen}
      </button>
    </CardShell>
  )
}

export function FirstRunQuickLinksCard({ leagueId }: { leagueId: string }) {
  const base = `/league/${leagueId}`
  return (
    <CardShell title={FIRST_RUN_COPY.quickLinksTitle}>
      <p className="text-[12px] text-white/55">Same destinations as the legacy setup guide banner.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`${base}?view=players`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
        >
          <Shuffle className="h-3.5 w-3.5 opacity-80" aria-hidden />
          {FIRST_RUN_COPY.quickPlayers}
        </Link>
        <Link
          href={`${base}?view=trades`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/[0.07]"
        >
          <Users className="h-3.5 w-3.5 opacity-80" aria-hidden />
          {FIRST_RUN_COPY.quickTrades}
        </Link>
      </div>
    </CardShell>
  )
}

function statusIcon(done: boolean | null) {
  if (done === true) {
    return <span className="text-emerald-400" aria-hidden>✓</span>
  }
  if (done === false) {
    return <span className="text-white/25" aria-hidden>○</span>
  }
  return <span className="text-white/35" aria-hidden>—</span>
}

export function LeagueReadinessChecklist({ items }: { items: ReadinessChecklistItem[] }) {
  return (
    <CardShell title={FIRST_RUN_COPY.readinessTitle} className="sm:col-span-2">
      <ul className="space-y-2">
        {items.map((row) => (
          <li key={row.id} className="flex gap-2 text-[12px]">
            <span className="mt-0.5 w-4 shrink-0 text-center font-mono text-[11px]">{statusIcon(row.done)}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-white/88">{row.label}</span>
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45">
                  {row.tier}
                </span>
              </div>
              {row.description ? <p className="mt-0.5 text-[11px] leading-snug text-white/50">{row.description}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-white/40">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {FIRST_RUN_COPY.checklistFootnote}
      </p>
    </CardShell>
  )
}
