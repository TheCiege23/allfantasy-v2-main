'use client'

/**
 * Connect ESPN — the 6b panel, on the AllFantasy core design system.
 *
 * ⚠ ONE IMPLEMENTATION, TWO MOUNTS. This is the whole of what used to live only in
 * `components/settings/EspnCookieConnection.tsx`. That file is now a thin `.af-core`
 * wrapper around this, so Settings and the import flow render the SAME panel rather
 * than two that drift. A second copy inside ImportV4 was the obvious move and the
 * wrong one: ESPN's connect logic is the fiddliest on the screen (extension ping,
 * one-click, cookie fallback, disconnect) and duplicating it means fixing every bug
 * twice.
 *
 * ⚠ WHY IT HAD TO MOVE AT ALL. ESPN is the one provider that cannot be imported
 * until a connection exists — commissionerGate resolves your team from the SWID
 * cookie, so a public league needs it too. The import screen knew that and handled
 * it by linking OUT to /settings, which ends the import: you land on a settings page
 * with no league id in hand, connect, and then have to find your way back and start
 * over. 6a build rule 6 says ESPN's case is one click, not an errand.
 *
 * ⚠ THESE ARE COOKIES, NOT A PASSWORD, and the distinction is the entire point of
 * 6a rule 6. Nothing here ever asks for an ESPN account password. The extension path
 * reads `SWID`/`espn_s2` from the user's own browser; the manual path is the same two
 * values pasted by hand. Both go to the SAME `POST /api/league/auth` that already
 * encrypts them — no new storage, no new endpoint.
 *
 * ⚠ THE MANUAL FORM IS NOT DEMOTED WHEN IT IS THE ONLY WAY IN. It is collapsed behind
 * the one-click button when the extension is actually reachable, and rendered openly
 * when it is not. Today it is always the latter: `NEXT_PUBLIC_ESPN_EXTENSION_ID` is
 * unset in production (and holds a placeholder locally — a real Chrome id is 32
 * lowercase letters), so `extensionStatus` can only ever be "not-installed". Hiding
 * the only working path behind a disclosure to match a design that assumes a
 * published extension would break the flow for every real user today.
 */

import { useCallback, useEffect, useState } from 'react'

/*
 * af-core.css FIRST and it is load bearing — the same rule ImportV4's header spells
 * out. This panel's tokens (--surface2, --line, --accent, --good, --bad …) and its
 * shared primitives (.af-btn, .af-label, .af-chip) all come from there; af-espn.css
 * only adds the `af-espn-*` rules on top. It must be a JS import rather than an
 * `@import` inside af-espn.css, because an @import inside a route-bundled CSS file is
 * dropped when another af-*.css is concatenated ahead of it.
 */
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-espn.css'

type EspnAuthStatus = {
  connected: boolean
  updatedAt: string | null
}

async function fetchEspnAuthStatus(): Promise<EspnAuthStatus> {
  const res = await fetch('/api/league/auth', { cache: 'no-store' })
  if (!res.ok) return { connected: false, updatedAt: null }
  const data = await res.json().catch(() => null)
  const auths = Array.isArray(data?.auths) ? data.auths : []
  const espn = auths.find((a: { platform?: string }) => a.platform === 'espn')
  return {
    connected: Boolean(espn?.hasEspnCookies),
    updatedAt: espn?.updatedAt ?? null,
  }
}

/*
 * Set once the AllFantasy Connect ESPN extension is published (see extension/README.md).
 * Until then this is empty and the extension path is simply never offered — the manual
 * paste form is unaffected either way.
 */
const EXTENSION_ID = process.env.NEXT_PUBLIC_ESPN_EXTENSION_ID?.trim() || null

/*
 * Where "Install the extension" points, once there is somewhere to point. Kept
 * separate from EXTENSION_ID on purpose: a dev-loaded extension has an id and no
 * store listing, so the two facts are not the same fact and one must not imply the
 * other. Absent -> the install CTA is replaced by an honest sentence rather than a
 * button that goes nowhere.
 */
const EXTENSION_STORE_URL = process.env.NEXT_PUBLIC_ESPN_EXTENSION_STORE_URL?.trim() || null

type ExtensionMessageResponse = { ok: boolean; code?: string; message?: string } | null

type ChromeRuntimeLike = {
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void
  lastError?: { message?: string } | null
}

function getChromeRuntime(): ChromeRuntimeLike | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { chrome?: { runtime?: ChromeRuntimeLike } }
  return w.chrome?.runtime ?? null
}

/** Messages the Connect-ESPN extension; resolves null (never rejects) if it isn't reachable. */
function sendExtensionMessage(message: { type: string }): Promise<ExtensionMessageResponse> {
  return new Promise((resolve) => {
    const runtime = getChromeRuntime()
    if (!runtime || !EXTENSION_ID) {
      resolve(null)
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, 2500)
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (runtime.lastError) {
          resolve(null)
          return
        }
        resolve((response ?? null) as ExtensionMessageResponse)
      })
    } catch {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
    }
  })
}

export type EspnConnectPanelProps = {
  /**
   * Told when the connection state changes, so the surface around the panel can
   * react — the import screen uses it to swap its "connect first" copy for the
   * league-ID field the moment ESPN goes green, rather than making the user
   * press something to find out.
   */
  onConnectedChange?: (connected: boolean) => void
}

export function EspnConnectPanel({ onConnectedChange }: EspnConnectPanelProps) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [swid, setSwid] = useState('')
  const [espnS2, setEspnS2] = useState('')
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const [extensionStatus, setExtensionStatus] = useState<'checking' | 'detected' | 'not-installed'>(
    EXTENSION_ID ? 'checking' : 'not-installed',
  )
  const [oneClickConnecting, setOneClickConnecting] = useState(false)
  const [oneClickError, setOneClickError] = useState<string | null>(null)
  /*
   * 6b's blocking state, and it is a REAL one rather than a drawn one: the
   * extension's background worker returns `code: 'ESPN_NOT_LOGGED_IN'` when it
   * finds no SWID/espn_s2 in the browser at all (extension/background.js). That is
   * the difference between "the connect failed" and "there is nothing here to
   * read yet", and only the second has a fix the user can act on.
   */
  const [espnSessionMissing, setEspnSessionMissing] = useState(false)
  /* 6b: the manual card is a disclosure. It starts OPEN whenever it is the only
     working path — see the note on `manualOpen` below. */
  const [manualOpenedByUser, setManualOpenedByUser] = useState(false)

  const refresh = useCallback(async () => {
    const s = await fetchEspnAuthStatus()
    setStatus(s.connected ? 'connected' : 'disconnected')
    setUpdatedAt(s.updatedAt)
    onConnectedChange?.(s.connected)
  }, [onConnectedChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!EXTENSION_ID) return
    void sendExtensionMessage({ type: 'ping' }).then((res) => {
      setExtensionStatus(res?.ok ? 'detected' : 'not-installed')
    })
  }, [])

  const handleOneClickConnect = async () => {
    setOneClickError(null)
    setEspnSessionMissing(false)
    setOneClickConnecting(true)
    try {
      const res = await sendExtensionMessage({ type: 'connectEspn' })
      if (!res) {
        setOneClickError('Could not reach the extension. Use the manual option below instead.')
        return
      }
      if (!res.ok) {
        /*
         * ⚠ NOT AN ERROR MESSAGE — A DIFFERENT SCREEN STATE. "There is no ESPN
         * session in this browser" is the one failure here with a concrete fix
         * ("go log into ESPN"), and burying it in the same red line as
         * SAVE_FAILED/NETWORK_ERROR loses that. 6b gives it its own strip.
         */
        if (res.code === 'ESPN_NOT_LOGGED_IN') {
          setEspnSessionMissing(true)
          return
        }
        setOneClickError(res.message || 'Could not connect ESPN. Please try again.')
        return
      }
      setEspnSessionMissing(false)
      setEditing(false)
      setMessage({
        tone: 'success',
        text: 'ESPN connected. Private leagues can now be previewed and imported.',
      })
      await refresh()
    } finally {
      setOneClickConnecting(false)
    }
  }

  const handleSave = async () => {
    const trimmedSwid = swid.trim()
    const trimmedS2 = espnS2.trim()
    if (!trimmedSwid || !trimmedS2) {
      setMessage({ tone: 'error', text: 'Enter both the SWID and espn_s2 cookie values.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/league/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'espn', espnSwid: trimmedSwid, espnS2: trimmedS2 }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({
          tone: 'error',
          text: data?.error || 'Could not save ESPN cookies. Please try again.',
        })
        return
      }
      /* Cleared on success: they are credentials, and they are stored now. */
      setSwid('')
      setEspnS2('')
      setEditing(false)
      setMessage({
        tone: 'success',
        text: 'ESPN connected. Private leagues can now be previewed and imported.',
      })
      await refresh()
    } catch {
      setMessage({ tone: 'error', text: 'Network error — please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm("Disconnect ESPN? Private ESPN leagues won't import until you reconnect.")
    ) {
      return
    }
    setDisconnecting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/league/auth', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'espn' }),
      })
      if (!res.ok) {
        setMessage({ tone: 'error', text: 'Could not disconnect ESPN. Please try again.' })
        return
      }
      setMessage({ tone: 'success', text: 'ESPN disconnected.' })
      await refresh()
    } catch {
      setMessage({ tone: 'error', text: 'Network error — please try again.' })
    } finally {
      setDisconnecting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="af-espn af-espn--loading" role="status" aria-live="polite">
        <span className="af-espn-spinner" aria-hidden />
        <span>Checking your ESPN connection&hellip;</span>
      </div>
    )
  }

  const showForm = status === 'disconnected' || editing
  const extensionReady = extensionStatus === 'detected'
  /*
   * ⚠ THE DISCLOSURE DEFAULTS OPEN WHEN IT IS THE ONLY DOOR. 6b draws the manual
   * paste as a "Paste cookies manually →" link behind a card, which is right for the
   * world the design assumes — one where the extension exists and one click works.
   * It does not exist yet (NEXT_PUBLIC_ESPN_EXTENSION_ID is unset in production), so
   * in that world the link would put the ONLY working path one click further away for
   * every real user. It opens by default whenever the extension is unavailable, and
   * behaves as the design's disclosure the moment the extension is reachable.
   */
  const manualOpen = manualOpenedByUser || !extensionReady

  const manualForm = (
    <div className="af-espn-manual" data-testid="espn-manual-connect">
      <p className="af-espn-body">
        {/*
          ⚠ THIS IS THE INSTRUCTION 6a RULE 6 EXISTS TO REPLACE, and it is still here
          because the extension is not published yet. Naming the steps precisely is the
          least-bad version of it: a vague "get your cookies" is how someone gives up.
        */}
        Private ESPN leagues need two cookies from your browser. With{' '}
        <strong>fantasy.espn.com</strong> open and signed in, press <kbd>F12</kbd> &rarr;{' '}
        <strong>Application</strong> &rarr; <strong>Cookies</strong>, then copy{' '}
        <strong>SWID</strong> and <strong>espn_s2</strong> here. Both are{' '}
        <strong>stored encrypted</strong> and used only to read your leagues.
      </p>
      <div className="af-espn-fields">
        <label className="af-espn-field">
          <span className="af-label">SWID</span>
          <input
            id="espn-swid-input"
            type="password"
            autoComplete="off"
            placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
            value={swid}
            onChange={(e) => setSwid(e.target.value)}
            disabled={saving}
          />
        </label>
        <label className="af-espn-field">
          <span className="af-label">espn_s2</span>
          <input
            id="espn-s2-input"
            type="password"
            autoComplete="off"
            placeholder="Long cookie value"
            value={espnS2}
            onChange={(e) => setEspnS2(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>
      <div className="af-espn-actions">
        <button
          type="button"
          className="af-btn af-espn-save"
          onClick={() => void handleSave()}
          disabled={saving || !swid.trim() || !espnS2.trim()}
        >
          {saving ? 'Saving…' : 'Save ESPN cookies'}
        </button>
        {status === 'connected' && (
          <button
            type="button"
            className="af-btn af-btn--ghost"
            onClick={() => {
              setEditing(false)
              setSwid('')
              setEspnS2('')
              setMessage(null)
            }}
            disabled={saving}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="af-espn" data-connected={status === 'connected' ? 'true' : 'false'}>
      {status === 'connected' && !editing ? (
        <div className="af-espn-connected">
          <span className="af-espn-badge af-num">ESPN connected</span>
          {updatedAt ? (
            <span className="af-espn-since">since {new Date(updatedAt).toLocaleDateString()}</span>
          ) : null}
          <span className="af-espn-connected-actions">
            <button type="button" className="af-btn af-btn--ghost" onClick={() => setEditing(true)}>
              Update cookies
            </button>
            <button
              type="button"
              className="af-btn af-btn--ghost af-espn-disconnect"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </span>
        </div>
      ) : null}

      {showForm && (
        <>
          {/*
            ── 6b: the primary card ───────────────────────────────────────────
            ⚠ ONE CARD, TWO STATUSES — NOT TWO CARDS. The handoff capture shows
            "EXTENSION DETECTED" and "EXTENSION NOT INSTALLED" at once because a
            design capture has to show every state on one canvas; a running screen
            is only ever in one of them. Rendering both would tell the user their
            extension is simultaneously installed and missing.

            ⚠ AND THE CARD STAYS VISIBLE WHEN BLOCKED (6b build rule 2). When ESPN
            has no session in this browser the button is disabled rather than
            removed, so the user can see what logging in is about to unlock.
          */}
          <div className="af-espn-card" data-ready={extensionReady ? 'true' : 'false'}>
            <p className="af-espn-status">
              <span className="af-espn-dot" aria-hidden />
              <span className="af-label">
                {extensionStatus === 'checking'
                  ? 'Looking for the extension'
                  : extensionReady
                    ? 'Extension detected'
                    : 'Extension not installed'}
              </span>
              <EspnHint />
            </p>
            <h3 className="af-espn-h">
              {extensionReady ? 'Connect with 1 click' : 'One click, once it is installed'}
            </h3>
            <p className="af-espn-body">
              {extensionReady
                ? 'We read only your ESPN league cookies, in your own browser, and store them encrypted to import your leagues — nothing else.'
                : 'Add the AllFantasy extension once and a single click connects any private ESPN league. It reads only your ESPN league cookies, stored encrypted — nothing else.'}
            </p>
            {extensionReady ? (
              <button
                type="button"
                className="af-btn af-espn-go"
                onClick={() => void handleOneClickConnect()}
                disabled={oneClickConnecting || espnSessionMissing}
                data-testid="espn-one-click-connect"
              >
                {oneClickConnecting ? 'Connecting…' : 'Connect with 1 click'}
              </button>
            ) : EXTENSION_STORE_URL ? (
              <a
                className="af-btn af-espn-go"
                href={EXTENSION_STORE_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Install the extension &rarr;
              </a>
            ) : (
              /*
                ⚠ NO LINK, BECAUSE THERE IS NOWHERE TO SEND THEM. The extension is
                built (see extension/README.md) but unpublished, so an
                "Install the extension →" button here would be a dead link dressed
                as the primary path. It returns the moment
                NEXT_PUBLIC_ESPN_EXTENSION_STORE_URL is set.
              */
              <p className="af-espn-note">
                The extension isn&rsquo;t published yet &mdash; use the cookie paste below for
                now. It is the same encrypted storage either way.
              </p>
            )}
            {oneClickError && (
              <p className="af-espn-msg af-espn-msg--error" role="alert">
                {oneClickError}
              </p>
            )}
          </div>

          {/*
            ── 6b: the blocking strip ─────────────────────────────────────────
            Only ever shown because the extension told us so — never guessed from
            the absence of a connection, which would accuse someone of being logged
            out on their very first visit.
          */}
          {espnSessionMissing ? (
            <p className="af-espn-warn" role="alert">
              <span className="af-espn-warn-mark" aria-hidden>
                !
              </span>
              <span>
                <strong>Log into ESPN first.</strong> We couldn&rsquo;t find an ESPN session in
                this browser, so there are no league cookies to read yet.
              </span>
            </p>
          ) : null}

          {/* ── 6b: the manual fallback card ────────────────────────────────── */}
          <div className="af-espn-fallback" data-open={manualOpen ? 'true' : 'false'}>
            <button
              type="button"
              className="af-espn-fallback-toggle"
              aria-expanded={manualOpen}
              onClick={() => setManualOpenedByUser((v) => !v)}
            >
              <span className="af-label">Manual fallback</span>
              <span className="af-espn-fallback-lead">
                Paste your SWID and espn_s2 cookie values instead &mdash;{' '}
                <strong>stored encrypted</strong>.
              </span>
              <span className="af-espn-fallback-cue">
                {manualOpen ? 'Hide the cookie form' : 'Paste cookies manually →'}
              </span>
            </button>
            {manualOpen ? <div className="af-espn-fallback-body">{manualForm}</div> : null}
          </div>
        </>
      )}

      {message && (
        <p
          className={`af-espn-msg af-espn-msg--${message.tone === 'error' ? 'error' : 'good'}`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      {/*
        6b build rule 4: this footnote is load bearing, not filler. Extensions do not
        run on most mobile browsers, so ESPN connect is desktop-only in practice and
        someone on a phone needs to know that rather than discovering it by failing.
        Hidden once connected — there is nothing left to connect.
      */}
      {showForm ? (
        <p className="af-espn-note af-espn-note--mobile">
          <LockGlyph /> On a phone? Extensions don&rsquo;t work on most mobile browsers
          &mdash; connect ESPN once on desktop and it stays connected.
        </p>
      ) : null}
    </div>
  )
}

/** 6b's `?` beside the extension status, carrying the trust explanation. */
function EspnHint() {
  const [open, setOpen] = useState(false)
  return (
    <span className="af-espn-hint">
      <button
        type="button"
        className="af-espn-hint-btn"
        aria-label="How the ESPN extension works"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        ?
      </button>
      <span className="af-espn-hint-bubble" role="tooltip" hidden={!open}>
        ESPN gives no public way to read a private league. The AllFantasy extension reads only
        your ESPN league cookies, in your own browser, and sends them to your account stored
        encrypted. It never reads any other site.
      </span>
    </span>
  )
}

/** The lock beside the mobile footnote — inherits colour and size, unlike an emoji. */
function LockGlyph() {
  return (
    <svg
      className="af-espn-lock"
      width="13"
      height="14"
      viewBox="0 0 13 14"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <rect x="1" y="5.75" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.75 5.75V4a2.75 2.75 0 0 1 5.5 0v1.75" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export default EspnConnectPanel
