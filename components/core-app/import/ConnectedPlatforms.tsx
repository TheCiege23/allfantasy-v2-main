'use client'

/**
 * 6e — Connected accounts (the fantasy-platform half of Settings).
 *
 * ⚠ NOT A NEW ROUTE. The handoff puts this at `/settings/connected-accounts`. This
 * repo sits against Vercel's hard 2048-route ceiling — the reason `/core` is one
 * optional catch-all rather than nine sibling pages — so a second settings page for
 * a section that already exists inside `/settings` is exactly the spend that put it
 * there. This renders in place of the platform list already inside
 * ConnectedAccountsSettingsSection, which is the surface the handoff is describing.
 *
 * ⚠ AND NOT A NEW ENDPOINT EITHER. Every status below comes from the existing
 * `GET /api/league/auth`, which already returns `{ platform, hasApiKey,
 * hasOauthToken, hasEspnCookies, updatedAt }` for every row the user has. Sleeper is
 * the exception and is passed in, because it is stored on the profile rather than in
 * `LeagueAuth`.
 *
 * ⚠ LEAGUE COUNTS ARE NOT SHOWN, AND THAT IS DELIBERATE. The capture reads
 * "3 leagues · connected by username". Nothing on this surface knows how many
 * leagues a platform accounts for, and the only honest ways to get it are a new
 * endpoint or a count this component invents. Handoff rule 2 asks for the
 * connection METHOD in plain language — "connected by username", "connected with
 * the AllFantasy extension" — and that part is real, so that part is what renders.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-connected.css'
import {
  IMPORT_PROVIDER_UI_OPTIONS,
  getImportProviderLabel,
} from '@/lib/league-import/provider-ui-config'

type AuthRow = {
  platform: string
  hasApiKey?: boolean
  hasOauthToken?: boolean
  hasEspnCookies?: boolean
  updatedAt?: string | null
}

type RowStatus = 'connected' | 'action-needed' | 'not-connected' | 'coming-soon'

const STATUS_LABEL: Record<RowStatus, string> = {
  connected: 'Connected',
  'action-needed': 'Action needed',
  'not-connected': 'Not connected',
  'coming-soon': 'Coming soon',
}

/** Which credential each platform's connection actually consists of. */
function methodFor(platform: string, row: AuthRow | undefined, status: RowStatus): string {
  if (status === 'coming-soon') return 'Not available yet'
  switch (platform) {
    case 'espn':
      return status === 'connected'
        ? 'Connected with your ESPN cookies · stored encrypted'
        : 'Connects with the AllFantasy extension, or your ESPN cookies · stored encrypted'
    case 'yahoo':
      /*
       * ⚠ A ROW WITH NO TOKEN IS THE "ACTION NEEDED" CASE, and it is a real state
       * rather than a drawn one: /import's own page note records that a LeagueAuth
       * row with a null oauthToken is a connect that started and never finished.
       * That is precisely what "re-authorize" fixes.
       */
      return status === 'action-needed'
        ? 'Yahoo sign-in started but never finished — re-authorize to complete it'
        : status === 'connected'
          ? 'Connected with Yahoo sign-in'
          : 'Connects with Yahoo sign-in'
    case 'mfl':
      return status === 'connected'
        ? 'Connected with a league API key · stored encrypted'
        : 'Connects with a league API key · stored encrypted'
    case 'sleeper':
      return status === 'connected' ? 'Connected by username' : 'Connects by username'
    default:
      return status === 'connected' ? 'Connected by league ID' : 'Connects by league ID'
  }
}

function statusFor(platform: string, row: AuthRow | undefined, available: boolean): RowStatus {
  if (!available) return 'coming-soon'
  if (!row) return 'not-connected'
  if (platform === 'espn') return row.hasEspnCookies ? 'connected' : 'action-needed'
  if (platform === 'yahoo') return row.hasOauthToken ? 'connected' : 'action-needed'
  if (platform === 'mfl') return row.hasApiKey ? 'connected' : 'action-needed'
  /* Fantrax stores a Secret ID as an apiKey; Fleaflicker needs no credential at all. */
  if (platform === 'fantrax') return row.hasApiKey ? 'connected' : 'not-connected'
  return 'not-connected'
}

const YAHOO_CONNECT_HREF = `/api/auth/yahoo?returnTo=${encodeURIComponent('/settings')}`

export type ConnectedPlatformsProps = {
  /** From the profile — Sleeper lives there, not in LeagueAuth. */
  sleeperUsername?: string | null
  /** Settings owns the Sleeper disconnect; reuse it rather than duplicating. */
  onDisconnectSleeper?: () => void
}

export function ConnectedPlatforms({ sleeperUsername, onDisconnectSleeper }: ConnectedPlatformsProps) {
  const [rows, setRows] = useState<AuthRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'good' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/league/auth', { cache: 'no-store' })
      if (!res.ok) {
        setRows([])
        return
      }
      const data = (await res.json().catch(() => null)) as { auths?: AuthRow[] } | null
      setRows(Array.isArray(data?.auths) ? data!.auths! : [])
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const disconnect = async (platform: string, label: string) => {
    /*
     * Handoff rule 3: the confirmation must say what disconnecting costs. The card
     * below promises it; this is the step that has to keep that promise.
     */
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Disconnect ${label}? This removes our read-only copy of that platform's leagues from AllFantasy. Your leagues and history stay on ${label} itself, untouched.`,
      )
    ) {
      return
    }
    setBusy(platform)
    setMessage(null)
    try {
      const res = await fetch('/api/league/auth', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      if (!res.ok) {
        setMessage({ tone: 'error', text: `${label} could not be disconnected. Please try again.` })
        return
      }
      setMessage({ tone: 'good', text: `${label} disconnected.` })
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'Network error — please try again.' })
    } finally {
      setBusy(null)
    }
  }

  const byPlatform = new Map((rows ?? []).map((r) => [r.platform, r]))

  /*
   * ── 6e: the completion bar ──────────────────────────────────────────────────
   * "3 of 6 live platforms connected · 50%".
   *
   * ⚠ "LIVE PLATFORMS" IS THE DENOMINATOR, AND IT IS READ FROM CONFIG. The handoff
   * hardcodes 6 because all six are live today; the moment one is switched off in
   * provider-ui-config, a fixed 6 would report someone as 5-of-6 connected for a
   * platform they are not allowed to connect. Counting `available` keeps the
   * fraction meaningful without a second edit here.
   *
   * Sleeper is counted from the profile rather than from LeagueAuth, because that
   * is where its link lives — the same asymmetry the rows below already handle.
   */
  const livePlatforms = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available)
  const connectedCount = livePlatforms.filter((o) => {
    if (o.provider === 'sleeper') return Boolean(sleeperUsername)
    return statusFor(o.provider, byPlatform.get(o.provider), true) === 'connected'
  }).length
  const livePlatformCount = livePlatforms.length
  const connectedPct =
    livePlatformCount > 0 ? Math.round((connectedCount / livePlatformCount) * 100) : 0

  return (
    <div className="af-ca">
      <div className="af-ca-head">
        <span className="af-label">Settings</span>
        <h3 className="af-ca-title">Connected accounts</h3>
      </div>

      {rows === null ? (
        <p className="af-ca-note" role="status">
          Checking your connections&hellip;
        </p>
      ) : (
        <>
        <div className="af-ca-progress">
          <p className="af-ca-progress-head">
            <span className="af-label">
              {connectedCount} of {livePlatformCount} live{' '}
              {livePlatformCount === 1 ? 'platform' : 'platforms'} connected
            </span>
            <span className="af-ca-progress-pct af-num">{connectedPct}%</span>
          </p>
          <div
            className="af-ca-progress-track"
            role="progressbar"
            aria-valuenow={connectedCount}
            aria-valuemin={0}
            aria-valuemax={livePlatformCount}
            aria-label="Platforms connected"
          >
            <div className="af-ca-progress-fill" style={{ width: `${connectedPct}%` }} />
          </div>
        </div>
        <ul className="af-ca-rows">
          {/* Sleeper is not a LeagueAuth row — it lives on the profile. */}
          <PlatformRow
            platform="sleeper"
            label="Sleeper"
            handle={sleeperUsername ?? null}
            status={sleeperUsername ? 'connected' : 'not-connected'}
            method={methodFor('sleeper', undefined, sleeperUsername ? 'connected' : 'not-connected')}
            busy={false}
            onDisconnect={sleeperUsername && onDisconnectSleeper ? onDisconnectSleeper : undefined}
          />

          {IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.provider !== 'sleeper').map((opt) => {
            const row = byPlatform.get(opt.provider)
            const status = statusFor(opt.provider, row, opt.available)
            return (
              <PlatformRow
                key={opt.provider}
                platform={opt.provider}
                label={getImportProviderLabel(opt.provider)}
                handle={null}
                status={status}
                method={methodFor(opt.provider, row, status)}
                since={row?.updatedAt ?? null}
                busy={busy === opt.provider}
                reauthorizeHref={opt.provider === 'yahoo' ? YAHOO_CONNECT_HREF : undefined}
                onDisconnect={
                  status === 'connected' || status === 'action-needed'
                    ? () => void disconnect(opt.provider, getImportProviderLabel(opt.provider))
                    : undefined
                }
              />
            )
          })}
        </ul>
        </>
      )}

      {message ? (
        <p
          className={`af-ca-msg af-ca-msg--${message.tone}`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      <div className="af-ca-data">
        <p className="af-ca-data-head">
          <span className="af-label">Your data</span>
          <DataHint />
        </p>
        <p className="af-ca-data-body">
          Disconnecting a platform removes its leagues and our read-only copy of their data. Your
          history stays on the platform itself, untouched.
        </p>
        <div className="af-ca-data-actions">
          {/*
            Handoff rule 5: "Add a platform" re-enters the connect flow rather than
            opening a second, settings-only form. That flow is /import.
          */}
          <Link href="/import" className="af-btn af-ca-add">
            Add a platform
          </Link>
          {/*
            ⚠ NO "DISCONNECT A PLATFORM" BUTTON. The capture pairs "Add a platform"
            with one, but a global disconnect button cannot know WHICH platform is
            meant — it would have to open a second picker for a job every row above
            already does in one press, on the row that names the platform. The
            destructive action stays where the thing it destroys is named.
          */}
        </div>
      </div>
    </div>
  )
}

function PlatformRow({
  platform,
  label,
  handle,
  status,
  method,
  since,
  busy,
  reauthorizeHref,
  onDisconnect,
}: {
  platform: string
  label: string
  handle: string | null
  status: RowStatus
  method: string
  since?: string | null
  busy: boolean
  reauthorizeHref?: string
  onDisconnect?: () => void
}) {
  return (
    <li className="af-ca-row" data-status={status}>
      <span className="af-platform af-ca-mark" data-platform={platform} aria-hidden>
        {platform === 'fleaflicker' ? 'FL' : label.charAt(0)}
      </span>
      <span className="af-ca-body">
        <span className="af-ca-name">
          {label}
          {handle ? <span className="af-ca-handle"> · {handle}</span> : null}
        </span>
        <span className="af-ca-method">
          {method}
          {since && status === 'connected' ? ` · since ${new Date(since).toLocaleDateString()}` : ''}
        </span>
      </span>
      <span className="af-ca-tag af-num">{STATUS_LABEL[status]}</span>
      <span className="af-ca-actions">
        {/*
          Handoff rule 1: ACTION NEEDED is the only status that earns a CTA button,
          so the one row that wants attention is the only one competing for it.
        */}
        {status === 'action-needed' && reauthorizeHref ? (
          <a className="af-btn af-ca-fix" href={reauthorizeHref}>
            Re-authorize
          </a>
        ) : status === 'action-needed' ? (
          <Link className="af-btn af-ca-fix" href={`/import?provider=${platform}`}>
            Finish connecting
          </Link>
        ) : null}
        {onDisconnect ? (
          <button
            type="button"
            className="af-btn af-btn--ghost af-ca-disconnect"
            onClick={onDisconnect}
            disabled={busy}
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : status === 'coming-soon' ? null : (
          <Link className="af-btn af-btn--ghost af-ca-manage" href={`/import?provider=${platform}`}>
            Connect
          </Link>
        )}
      </span>
    </li>
  )
}

function DataHint() {
  const [open, setOpen] = useState(false)
  return (
    <span className="af-ca-hint">
      <button
        type="button"
        className="af-ca-hint-btn"
        aria-label="How your platform credentials are stored"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        ?
      </button>
      <span className="af-ca-hint-bubble" role="tooltip" hidden={!open}>
        Platform credentials are stored encrypted at rest and never logged. Disconnecting removes
        that platform&rsquo;s leagues and our read-only copy of their data from AllFantasy.
      </span>
    </span>
  )
}

export default ConnectedPlatforms
