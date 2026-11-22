'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-invite.css'
import { formatGuillotineSeatLine, type GuillotineSeatSummary } from '@/lib/guillotine/lateStartSeatMath'
import { referralCodeOf, withReferralCode } from '@/lib/referral/referralShareLink'
import { useMyReferralLink } from '@/lib/referral/myReferralLink'
import { ProWeekInviteLine } from '@/components/referral/ProWeekInviteLine'
import { smsInviteHref, whatsAppInviteHref } from '@/lib/league/league-invite-link'

/**
 * The commissioner's invite link, and how many teams are still unclaimed.
 *
 * ⚠ THIS EXISTED IN EXACTLY ONE PLACE — INSIDE THE DASHBOARD WE ARE RETIRING.
 * `ClaimInvitePanel` lived in NocturneDashboard.tsx and nothing else rendered it,
 * so cutting over without carrying it would have left commissioners no way to get
 * their invite link at all. Worth naming precisely, because my own gap analysis
 * had this backwards: it is a COMMISSIONER inviting managers, not a manager
 * claiming a team.
 *
 * ⚠ A FAILED LOAD NOW SAYS SO. The original returned null on any error, so a
 * commissioner whose invite could not be loaded saw an empty space and no reason
 * — indistinguishable from a league that simply has no invites. Silence is the
 * wrong answer when someone is trying to fill a league.
 */

type InviteInfo = {
  inviteLink: string
  teamCount: number
  claimedCount: number
  /** Who is already here (lib/league/managersHere.ts). */
  managersHere: Array<{ name: string; teamName: string | null; you: boolean }>
  /** Native guillotine only: seats the remaining season supports and what a not-full draft does. */
  guillotineSeats: GuillotineSeatSummary | null
}

export function LeagueInvitePanel({
  leagueId,
  compact = false,
  hideWhenFull = false,
  leagueName,
}: {
  leagueId: string
  /** Denser layout for a list row, versus a full panel on a league page. */
  compact?: boolean
  /**
   * The league home's nudge (2026-11-15): say nothing while loading, on a failed load, or once every
   * team has a manager — it is an invitation to fill the league, not a settings panel.
   */
  hideWhenFull?: boolean
  /** Names the league in the text / WhatsApp message. */
  leagueName?: string
}) {
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  // The inviter's referral code on the link (2026-11-15) — see ImportInviteCard; unchanged without one.
  const referralCode = referralCodeOf(useMyReferralLink())

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setFailed(false)
    setCopied(false)
    void fetch(`/api/leagues/join?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.inviteLink) {
          setInfo({
            inviteLink: String(d.inviteLink),
            teamCount: Number(d.claim?.teamCount ?? 0),
            claimedCount: Number(d.claim?.claimedCount ?? 0),
            managersHere: Array.isArray(d.claim?.managersHere) ? d.claim.managersHere.filter((m: unknown) => m && typeof (m as { name?: unknown }).name === 'string') : [],
            guillotineSeats: d.guillotineSeats && typeof d.guillotineSeats === 'object' ? (d.guillotineSeats as GuillotineSeatSummary) : null,
          })
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (failed && hideWhenFull) return null
  if (failed) {
    return (
      <p className="af-inv-failed">
        We could not load an invite link for this league. That is a read failure on our side, not a
        sign that invites are closed.
      </p>
    )
  }

  if (!info) return hideWhenFull ? null : <p className="af-inv-loading">Loading invite…</p>

  const inviteLink = withReferralCode(info.inviteLink, referralCode)
  const pct = info.teamCount > 0 ? Math.round((info.claimedCount / info.teamCount) * 100) : 0
  const unclaimed = Math.max(0, info.teamCount - info.claimedCount)
  if (hideWhenFull && (info.teamCount === 0 || unclaimed === 0)) return null
  const inviteMessage = leagueName
    ? `Join our league "${leagueName}" on AllFantasy — open this to claim your team:`
    : 'Join our league on AllFantasy — open this to claim your team:'

  async function copy() {
    if (!info) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      /*
       * Clipboard can be denied outright (permissions, insecure context). Falling
       * back to a selectable input means the commissioner can still get the link
       * by hand rather than being told the feature failed.
       */
      setCopied(false)
    }
  }

  return (
    <div className="af-inv" data-compact={compact}>
      {info.teamCount > 0 ? (
        <div className="af-inv-progress-wrap">
          <div className="af-inv-progress-head">
            <span>
              <b className="af-num">{info.claimedCount}</b> of{' '}
              <b className="af-num">{info.teamCount}</b> teams claimed
            </span>
            <span className="af-num">{pct}%</span>
          </div>
          <div
            className="af-inv-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="af-inv-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          {/*
            ⚠ THE UNCLAIMED COUNT IS THE ACTIONABLE NUMBER, not the percentage.
            "4 teams still need a manager" tells a commissioner what to do; "67%"
            tells them how they are doing.
          */}
          {unclaimed > 0 ? (
            <p className="af-inv-note">
              {unclaimed} {unclaimed === 1 ? 'team still needs' : 'teams still need'} a manager.
            </p>
          ) : (
            <p className="af-inv-note af-inv-note--done">Every team is claimed.</p>
          )}
          {info.managersHere.length > 0 ? (
            <div className="af-inv-here" data-testid="league-managers-here">
              <p className="af-inv-here-h">Already here</p>
              <ul className="af-inv-here-list">
                {info.managersHere.map((m, i) => (
                  <li key={`${m.name}-${m.teamName ?? ''}-${i}`} className="af-inv-here-row" data-you={m.you}>
                    <span className="af-inv-here-name">{m.name}{m.you ? ' (you)' : ''}</span>
                    {m.teamName && m.teamName !== m.name ? <span className="af-inv-here-team">{m.teamName}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {info.guillotineSeats ? (
            <p className="af-inv-note" data-testid="guillotine-seat-line">
              {formatGuillotineSeatLine(info.guillotineSeats)}
            </p>
          ) : null}
        </div>
      ) : null}

      <ProWeekInviteLine />
      <div className="af-inv-actions">
        <input
          className="af-inv-link"
          readOnly
          value={inviteLink}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="League invite link"
        />
        <button type="button" className="af-inv-btn" onClick={copy} data-testid="league-invite-link">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <div className="af-inv-actions" data-testid="league-invite-share">
        <a className="af-btn af-btn--ghost" href={smsInviteHref(inviteMessage, inviteLink)}>
          Text it
        </a>
        <a className="af-btn af-btn--ghost" href={whatsAppInviteHref(inviteMessage, inviteLink)} target="_blank" rel="noreferrer noopener">
          WhatsApp
        </a>
      </div>
    </div>
  )
}

export default LeagueInvitePanel
