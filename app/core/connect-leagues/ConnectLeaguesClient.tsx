'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import '@/components/core-app/af-core.css'

/**
 * Pair two already-imported leagues as one franchise.
 *
 * 🛑 THE ASK: "give the user the opportunity to connect 2 leagues you don't know
 * are connected and labeling them a league type." Everything behind this screen
 * already existed — `FranchiseLink` models the pair, `loadFranchiseDetail`
 * renders both halves, `/api/legacy/franchise` serves it. Nothing in the app
 * ever called any of it, and no action could attach the pro side at all.
 *
 * ⚠ THIS SCREEN NEVER IMPORTS ANYTHING. `/import/c2c` (also unreachable until
 * now) takes two raw source ids and CREATES a third, merged league. That is a
 * different job and the wrong one here: the ordinary case is two leagues already
 * imported separately, where a third would be a duplicate rather than a fix.
 */

type Pairable = {
  id: string
  platform: string
  name: string
  season: number | null
  role: 'pro' | 'college'
  roleReason: string
  linkedTo: string | null
  linkId: string | null
}

type Discovery = {
  pro: Pairable[]
  college: Pairable[]
  alreadyLinked: Pairable[]
  /** The half the user arrived from, resolved server-side across both id spaces. */
  from: { id: string; role: 'pro' | 'college' } | null
}

/**
 * ⚠ THE CONTROL IS A BOX WITH A TICK IN IT, AND THE TICK IS DRAWN BY US.
 *
 * A native radio was invisible against this surface — a checked one showed no
 * mark the user could see, so a preselected league read as an unselected one and
 * they clicked it again to be sure. The input stays in the markup (it is what
 * keyboard and screen readers drive, and `name` still makes each side a single
 * choice); only its rendering is replaced.
 */
function LeagueOption({
  league,
  selected,
  fromHere,
  onSelect,
}: {
  league: Pairable
  selected: boolean
  fromHere: boolean
  onSelect: () => void
}) {
  return (
    <label className={`af-cl-option${selected ? ' af-cl-option--on' : ''}`}>
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="af-cl-radio"
        name={`side-${league.role}`}
      />
      <span className="af-cl-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="af-cl-check" focusable="false">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="af-cl-option-body">
        <span className="af-cl-option-name">
          {league.name}
          {fromHere ? <span className="af-cl-from">You came from here</span> : null}
        </span>
        <span className="af-cl-option-meta">
          {league.platform}
          {league.season != null ? ` · ${league.season}` : ''} · {league.roleReason}
          {league.linkedTo ? ` · part of ${league.linkedTo}, still missing its other half` : ''}
        </span>
      </span>
    </label>
  )
}

export function ConnectLeaguesClient() {
  const router = useRouter()
  const params = useSearchParams()
  const fromLeague = params?.get('league') ?? null

  const [data, setData] = useState<Discovery | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pro, setPro] = useState<string | null>(null)
  const [college, setCollege] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/legacy/franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover-pairable', from: fromLeague ?? undefined }),
      })
      const body = (await res.json()) as Discovery & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not read your leagues')
      setData(body)
      /*
       * Preselect whichever side the user arrived from — the server resolved it,
       * because the id in the URL is a `League.id` and the list may hold the
       * Fantrax snapshot id for the same league.
       */
      if (body.from?.role === 'pro') setPro(body.from.id)
      if (body.from?.role === 'college') setCollege(body.from.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your leagues')
    } finally {
      setLoading(false)
    }
  }, [fromLeague])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!pro || !college || !data) return
    setSaving(true)
    setError(null)
    try {
      const proLeague = data.pro.find((l) => l.id === pro)
      const collegeLeague = data.college.find((l) => l.id === college)
      const res = await fetch('/api/legacy/franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pair-leagues',
          franchiseName: name.trim() || undefined,
          /* Merge into the half-built franchise either side is already in. */
          linkId: proLeague?.linkId ?? collegeLeague?.linkId ?? undefined,
          pro: { platform: proLeague?.platform, leagueId: pro },
          college: { platform: collegeLeague?.platform, leagueId: college },
        }),
      })
      const body = (await res.json()) as { error?: string; linkId?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not connect those leagues')
      /*
       * Back to the league they came from, which now renders its other half.
       *
       * ⚠ `refresh()` AS WELL AS `push()`. LeagueHome is a server component and
       * the client router cache can serve the copy rendered before the pairing
       * existed — so the user lands back on the screen still offering to connect
       * the league they just connected.
       */
      const back = fromLeague ? `/core?league=${encodeURIComponent(fromLeague)}` : '/core'
      router.push(back)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect those leagues')
      setSaving(false)
    }
  }

  const canSubmit = pro != null && college != null && !saving

  return (
    <main className="af-core af-cl">
      <header className="af-cl-head">
        <h1 className="af-display">Connect two leagues</h1>
        <p className="af-cl-lede">
          Run a college league alongside a pro one? Name them as one franchise and AllFantasy
          will show both rosters together. Neither league is changed, and nothing is imported.
        </p>
        <Link href={fromLeague ? `/core?league=${encodeURIComponent(fromLeague)}` : '/core'} className="af-btn af-btn--ghost">
          ← Back
        </Link>
      </header>

      {loading ? <p className="af-cl-note">Reading your leagues…</p> : null}

      {error ? (
        <p className="af-cl-error" role="alert">
          {error}
        </p>
      ) : null}

      {data && !loading ? (
        <>
          {/*
            ⚠ THE EMPTY CASE IS NOT AN ERROR AND MUST NOT LOOK LIKE ONE. Pairing
            needs one league on each side; a user with only pro leagues is not
            broken, they just have nothing to pair yet. Saying which side is
            missing is the difference between "do this next" and "this is
            broken".
          */}
          {data.pro.length === 0 || data.college.length === 0 ? (
            <section className="af-card af-cl-empty">
              <h2>Nothing to pair yet</h2>
              <p>
                {data.pro.length === 0
                  ? 'No pro league is connected yet.'
                  : 'No college league is connected yet.'}{' '}
                A franchise needs one of each.
              </p>
              <Link href="/import" className="af-btn">
                Import a league →
              </Link>
            </section>
          ) : (
            <>
              <section className="af-card af-cl-side">
                <h2 className="af-label">Pro half</h2>
                {data.pro.map((l) => (
                  <LeagueOption
                    key={l.id}
                    league={l}
                    selected={pro === l.id}
                    fromHere={data.from?.role === 'pro' && data.from.id === l.id}
                    onSelect={() => setPro(l.id)}
                  />
                ))}
              </section>

              <section className="af-card af-cl-side">
                <h2 className="af-label">College half</h2>
                {data.college.map((l) => (
                  <LeagueOption
                    key={l.id}
                    league={l}
                    selected={college === l.id}
                    fromHere={data.from?.role === 'college' && data.from.id === l.id}
                    onSelect={() => setCollege(l.id)}
                  />
                ))}
              </section>

              <section className="af-card af-cl-side">
                <label className="af-cl-namelabel">
                  <span className="af-label">Call this franchise</span>
                  <input
                    className="af-cl-name"
                    value={name}
                    placeholder="My franchise"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </section>

              <button type="button" className="af-btn af-cl-submit" disabled={!canSubmit} onClick={submit}>
                {saving ? 'Connecting…' : 'Connect these leagues'}
              </button>
            </>
          )}

          {data.alreadyLinked.length > 0 ? (
            <section className="af-card af-cl-side">
              <h2 className="af-label">Already connected</h2>
              {data.alreadyLinked.map((l) => (
                <p key={`${l.platform}:${l.id}`} className="af-cl-option-meta">
                  {l.name} — part of {l.linkedTo}
                </p>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
