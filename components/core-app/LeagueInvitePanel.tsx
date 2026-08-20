'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-invite.css'

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

type InviteInfo = { inviteLink: string; teamCount: number; claimedCount: number }

export function LeagueInvitePanel({
  leagueId,
  compact = false,
}: {
  leagueId: string
  /** Denser layout for a list row, versus a full panel on a league page. */
  compact?: boolean
}) {
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

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

  if (failed) {
    return (
      <p className="af-inv-failed">
        We could not load an invite link for this league. That is a read failure on our side, not a
        sign that invites are closed.
      </p>
    )
  }

  if (!info) return <p className="af-inv-loading">Loading invite…</p>

  const pct = info.teamCount > 0 ? Math.round((info.claimedCount / info.teamCount) * 100) : 0
  const unclaimed = Math.max(0, info.teamCount - info.claimedCount)

  async function copy() {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.inviteLink)
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
        </div>
      ) : null}

      <div className="af-inv-actions">
        <input
          className="af-inv-link"
          readOnly
          value={info.inviteLink}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="League invite link"
        />
        <button type="button" className="af-inv-btn" onClick={copy} data-testid="league-invite-link">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

export default LeagueInvitePanel
