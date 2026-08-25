'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * What has happened across ALL of this user's leagues, each item naming the
 * league it came from.
 *
 * ⚠ IT READS THE EXISTING AGGREGATOR, AND DELIBERATELY DROPS THE leagueId.
 * `/api/shared/activity` already merges three independent sources and returns
 * `leagueId`, `leagueName` and a deep-link `href` per item — everything a
 * cross-league view needs. The one consumer before this
 * (`components/feed/LeagueFeed`) always passed a `leagueId`, so the endpoint's
 * cross-league mode existed and was never used.
 *
 * ⚠ THE LEAGUE NAME IS THE POINT, NOT DECORATION. "Somebody dropped a kicker"
 * is unreadable across 60 leagues. An item with no league attached says so
 * rather than silently looking like it belongs to whichever league you last
 * looked at.
 *
 * ⚠ 429 IS A REAL STATE, NOT AN ERROR. The endpoint declines to compute under
 * back-pressure and returns `status: "rate_limited"` with an empty list. That is
 * "not right now", not "nothing happened", and conflating the two would tell a
 * user their leagues had gone quiet when the server simply throttled.
 */

type ActivityItem = {
  id: string
  type: string
  userName: string
  description: string
  timestamp: string
  leagueId: string | null
  leagueName: string | null
  href?: string | null
}

/** Enough to be useful in a drawer without becoming a page. */
const LIMIT = 25

const TYPE_LABEL: Record<string, string> = {
  trade: 'Trade',
  waiver: 'Waiver',
  lineup: 'Lineup',
  message: 'Message',
  announcement: 'Announcement',
  injury: 'Injury',
  standings: 'Standings',
}

function whenLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function LeagueActivityFeed({ onOpenLeague }: { onOpenLeague?: (leagueId: string) => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [throttled, setThrottled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      // No leagueId: this is the cross-league view.
      const res = await fetch(`/api/shared/activity?limit=${LIMIT}`)
      const data = (await res.json().catch(() => ({}))) as {
        status?: string
        items?: ActivityItem[]
      }
      if (data.status === 'rate_limited') {
        setThrottled(true)
        setItems([])
        return
      }
      setThrottled(false)
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setItems([])
      setError('Could not load league activity.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (items == null) {
    return <p className="af-cm-loading">Loading league activity…</p>
  }

  if (throttled) {
    return (
      <div className="af-cm-empty">
        <p className="af-cm-empty-t">Activity is catching up.</p>
        <p className="af-cm-empty-b">
          The feed was throttled just now — this is not &ldquo;nothing happened&rdquo;. Try again in
          a moment.
        </p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="af-cm-empty">
        <p className="af-cm-empty-t">No recent activity.</p>
        <p className="af-cm-empty-b">
          Trades, waivers and roster moves show up here as they happen in any of your leagues.
        </p>
        {error ? <p className="af-cm-error">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="af-cm-activity">
      {items.map((item) => {
        const body = (
          <>
            <span className="af-cm-act-top">
              <span className="af-cm-act-type" data-type={item.type}>
                {TYPE_LABEL[item.type] ?? item.type}
              </span>
              {/*
                Named, or explicitly not. Never blank — a nameless row reads as
                belonging to whichever league the reader last had open.
              */}
              <span className="af-cm-act-league">
                {item.leagueName ?? 'League not identified'}
              </span>
              <span className="af-cm-act-when">{whenLabel(item.timestamp)}</span>
            </span>
            <span className="af-cm-act-desc">{item.description}</span>
          </>
        )

        /*
         * The arrow only appears when there is somewhere to go. An href from the
         * aggregator wins, because it deep-links to the event itself; otherwise
         * the league is the closest honest destination.
         */
        if (item.href) {
          return (
            <a key={item.id} className="af-cm-act" href={item.href}>
              {body}
              <span className="af-cm-act-go" aria-hidden>
                ›
              </span>
              <span className="af-cm-sr">Open</span>
            </a>
          )
        }
        if (item.leagueId) {
          const leagueId = item.leagueId
          return (
            <button
              key={item.id}
              type="button"
              className="af-cm-act"
              onClick={() => onOpenLeague?.(leagueId)}
            >
              {body}
              <span className="af-cm-act-go" aria-hidden>
                ›
              </span>
              <span className="af-cm-sr">Open league</span>
            </button>
          )
        }
        return (
          <div key={item.id} className="af-cm-act" data-static="true">
            {body}
          </div>
        )
      })}
    </div>
  )
}

export default LeagueActivityFeed
