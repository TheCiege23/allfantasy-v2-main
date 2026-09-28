'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { initialsFor, safeAvatarUrl } from './chatLayout'

/**
 * Who to start a DM or a huddle with: your league-mates as you type, or any exact username.
 *
 * ⚠ THE PEOPLE COME FROM `/api/shared/chat/league-mates`, which already drops you, anyone with a
 * block either way, and anyone you share no league with. Nothing here re-filters them — the server
 * is the one that can be kept right. The routes that CREATE the conversation check blocks again.
 *
 * ⚠ AN EXACT USERNAME STILL WORKS, FOR PEOPLE OUTSIDE YOUR LEAGUES. So no option is highlighted until
 * you arrow to one: with a first-row default, typing "kai" and pressing Enter would start a DM with
 * "kaiser" from your dynasty league instead of the "kai" you typed.
 *
 * Nothing is fetched until the box is focused, so a closed drawer costs no request.
 */

export type PickerPerson = {
  id: string
  displayName: string
  username: string
  avatarUrl: string | null
  sharedLeagues: string[]
}

/** A huddle pick: a league-mate, or a username typed by hand (resolved by the server on create). */
type Pick = { key: string; username: string; label: string; avatarUrl: string | null }

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const stripAt = (s: string) => s.trim().replace(/^@+/, '').trim()

/** The comma-separated names typed so far, cleaned. */
function typedNames(text: string): string[] {
  return text
    .split(',')
    .map(stripAt)
    .filter(Boolean)
}

function toPerson(raw: unknown): PickerPerson | null {
  const r = raw as Partial<PickerPerson> | null
  if (!r || typeof r.id !== 'string' || typeof r.username !== 'string' || !r.username.trim()) return null
  return {
    id: r.id,
    username: r.username.trim(),
    displayName: typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.trim() : r.username.trim(),
    avatarUrl: typeof r.avatarUrl === 'string' ? r.avatarUrl : null,
    sharedLeagues: Array.isArray(r.sharedLeagues) ? r.sharedLeagues.filter((l): l is string => typeof l === 'string') : [],
  }
}

function leagueLine(leagues: string[]): string {
  if (leagues.length === 0) return ''
  return leagues.length === 1 ? leagues[0]! : `${leagues[0]} +${leagues.length - 1} more`
}

function Face({ name, url }: { name: string; url: string | null }) {
  const safe = safeAvatarUrl(url)
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cm-dmrow-av af-cm-pick-av" aria-hidden="true">
      {safe && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safe} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="af-cm-dmrow-initials">{initialsFor(name)}</span>
      )}
    </span>
  )
}

export function PeoplePicker({
  kind,
  busy,
  error,
  onEdit,
  onPickDm,
  onSubmit,
}: {
  kind: 'dm' | 'group'
  busy: boolean
  /** Why the last start failed, in the server's words. Shown under the box, where you are looking. */
  error?: string | null
  /** Any edit — the panel clears a stale start error. */
  onEdit?: () => void
  /** DM: a league-mate was chosen. Starts the DM through the existing start route. */
  onPickDm: (person: PickerPerson) => void
  /** DM: the typed username. Huddle: every pick plus anything still typed. */
  onSubmit: (usernames: string[]) => void
}) {
  const isDm = kind === 'dm'
  const uid = useId()
  const listId = `${uid}-list`
  const labelId = `${uid}-label`
  const noteId = `${uid}-note`
  const optionId = (i: number) => `${uid}-opt-${i}`

  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [picks, setPicks] = useState<Pick[]>([])
  const [results, setResults] = useState<PickerPerson[]>([])
  const [load, setLoad] = useState<LoadState>('idle')
  const cache = useRef(new Map<string, PickerPerson[]>())
  const latest = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  /* A huddle searches on the name being typed now — the text after the last comma. */
  const query = useMemo(() => stripAt(isDm ? text : (text.split(',').pop() ?? '')), [isDm, text])

  useEffect(() => {
    if (!open) return
    latest.current = query
    const hit = cache.current.get(query)
    if (hit) {
      setResults(hit)
      setLoad('ready')
      return
    }
    setLoad('loading')
    let cancelled = false
    const handle = window.setTimeout(
      () => {
        void fetch(`/api/shared/chat/league-mates${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' })
          .then(async (res) => {
            const data = (await res.json().catch(() => ({}))) as { mates?: unknown }
            if (!res.ok || !Array.isArray(data.mates)) throw new Error('league-mates unavailable')
            const people = data.mates.map(toPerson).filter((p): p is PickerPerson => p !== null)
            cache.current.set(query, people)
            if (cancelled || latest.current !== query) return
            setResults(people)
            setLoad('ready')
          })
          .catch(() => {
            if (cancelled || latest.current !== query) return
            setResults([])
            setLoad('error')
          })
      },
      query ? 200 : 0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query])

  /* The highlighted row is only meaningful for the list it was chosen in. */
  useEffect(() => setActive(-1), [query])

  /*
   * While a new search is in flight, the last answer is narrowed on the client rather than shown as
   * it was — otherwise the list would briefly hold people who do not match what is in the box.
   */
  const visible = useMemo(() => {
    if (load !== 'loading' || !query) return results
    const needle = query.toLowerCase()
    return results.filter(
      (p) => p.displayName.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle),
    )
  }, [load, query, results])

  /* Picked is by handle, so a league-mate first typed as "@jo" still shows as in the huddle. */
  const pickedNames = useMemo(() => new Set(picks.map((p) => p.username.toLowerCase())), [picks])

  const edit = useCallback(
    (next: string) => {
      setText(next)
      setOpen(true)
      onEdit?.()
    },
    [onEdit],
  )

  /** Everything typed before the current name becomes a chip of its own. */
  const typedChips = useCallback(
    (names: string[]): Pick[] =>
      names.map((n) => ({ key: `typed:${n.toLowerCase()}`, username: n, label: `@${n}`, avatarUrl: null })),
    [],
  )

  /** One chip per handle. A league-mate replaces a hand-typed chip for the same handle (it has a face). */
  const addPicks = useCallback((more: Pick[]) => {
    setPicks((prev) => {
      const out = [...prev]
      for (const p of more) {
        const at = out.findIndex((x) => x.username.toLowerCase() === p.username.toLowerCase())
        if (at < 0) out.push(p)
        else if (p.key.startsWith('mate:')) out[at] = p
      }
      return out
    })
  }, [])

  const choose = useCallback(
    (person: PickerPerson) => {
      if (busy) return
      onEdit?.()
      if (isDm) {
        setOpen(false)
        setActive(-1)
        onPickDm(person)
        return
      }
      const key = `mate:${person.id}`
      const handle = person.username.toLowerCase()
      if (pickedNames.has(handle)) {
        // Tapping a picked league-mate again takes them back out.
        setPicks((prev) => prev.filter((p) => p.username.toLowerCase() !== handle))
      } else {
        const before = text.includes(',') ? typedNames(text.slice(0, text.lastIndexOf(','))) : []
        addPicks([
          ...typedChips(before),
          { key, username: person.username, label: person.displayName, avatarUrl: person.avatarUrl },
        ])
        setText('')
      }
      setActive(-1)
      inputRef.current?.focus()
    },
    [busy, onEdit, isDm, onPickDm, pickedNames, text, addPicks, typedChips],
  )

  const removePick = useCallback((key: string) => {
    setPicks((prev) => prev.filter((p) => p.key !== key))
    inputRef.current?.focus()
  }, [])

  const namesToSubmit = useMemo(() => {
    if (isDm) {
      const one = stripAt(text)
      return one ? [one] : []
    }
    const all = [...picks.map((p) => p.username), ...typedNames(text)]
    const seen = new Set<string>()
    return all.filter((n) => (seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true)))
  }, [isDm, text, picks])

  const submit = useCallback(() => {
    if (busy || namesToSubmit.length === 0) return
    setOpen(false)
    setActive(-1)
    onSubmit(namesToSubmit)
  }, [busy, namesToSubmit, onSubmit])

  const showList = open && visible.length > 0

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const n = visible.length
      if (n === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i < 0 ? (step > 0 ? 0 : n - 1) : (i + step + n) % n))
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        // Closing the list is all Escape does here; the drawer must not close under it.
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showList && active >= 0 && visible[active]) {
        choose(visible[active]!)
        return
      }
      if (!isDm && text.trim()) {
        // In a huddle, Enter turns what you typed into chips; Start (or Enter on an empty box) creates.
        addPicks(typedChips(typedNames(text)))
        setText('')
        return
      }
      submit()
      return
    }
    if (e.key === 'Backspace' && !isDm && text === '' && picks.length > 0) {
      e.preventDefault()
      setPicks((prev) => prev.slice(0, -1))
    }
  }

  let note: string | null = null
  if (open && load === 'error') {
    note = "Couldn't load your league-mates. You can still type a username."
  } else if (open && load === 'loading' && visible.length === 0) {
    note = 'Finding your league-mates…'
  } else if (open && load === 'ready' && visible.length === 0) {
    note = query
      ? isDm
        ? `Nobody in your leagues matches “${query}”. Hit Start to message @${query} anyway.`
        : `Nobody in your leagues matches “${query}”. Press Enter to add @${query} anyway.`
      : 'No league-mates yet. Type an AllFantasy username to reach anyone.'
  }

  /* Short enough to show whole in a 390px drawer at the 16px phone font; the list's heading says where names come from. */
  const placeholder = isDm ? 'Name or @username' : 'Add names or @usernames'

  return (
    <div
      className="af-cm-pick"
      ref={rootRef}
      data-open={open}
      onBlur={(e) => {
        // Closed only when focus leaves the picker altogether — not when it moves to a chip's ×.
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false)
          setActive(-1)
        }
      }}
    >
      {!isDm && picks.length > 0 ? (
        <ul className="af-cm-pick-chips" aria-label="People in this huddle">
          {picks.map((p) => (
            <li key={p.key} className="af-cm-pick-chip">
              <Face name={p.label.replace(/^@/, '')} url={p.avatarUrl} />
              <span className="af-cm-pick-chip-name">{p.label}</span>
              <button
                type="button"
                className="af-cm-pick-chip-x"
                aria-label={`Remove ${p.label}`}
                onClick={() => removePick(p.key)}
                disabled={busy}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="af-cm-composer af-cm-pick-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          className="af-cm-input af-cm-pick-input"
          value={text}
          onChange={(e) => edit(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={isDm ? 'Message a league-mate or any username' : 'Add league-mates or usernames to a huddle'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={note ? noteId : undefined}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={isDm ? 'go' : 'enter'}
        />
        <button type="submit" className="af-cm-send af-cm-pick-start" disabled={busy || namesToSubmit.length === 0}>
          Start
        </button>
      </form>

      {error ? (
        <p className="af-cm-error af-cm-pick-error" role="alert">
          {error}
        </p>
      ) : null}

      {open && (showList || note) ? (
        <div className="af-cm-pick-pop">
          {showList ? (
            <>
              <p className="af-cm-pick-label" id={labelId}>
                {query ? 'In your leagues' : isDm ? 'Your league-mates' : 'Pull in your league-mates'}
              </p>
              <ul
                className="af-cm-pick-list"
                role="listbox"
                id={listId}
                aria-labelledby={labelId}
                aria-multiselectable={isDm ? undefined : true}
              >
                {visible.map((p, i) => {
                  const picked = pickedNames.has(p.username.toLowerCase())
                  const leagues = leagueLine(p.sharedLeagues)
                  return (
                    <li
                      key={p.id}
                      id={optionId(i)}
                      role="option"
                      className="af-cm-pick-opt"
                      aria-selected={isDm ? i === active : picked}
                      aria-disabled={busy || undefined}
                      data-active={i === active}
                      data-picked={picked}
                      // Keep focus in the box, so the list does not close under the tap.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(p)}
                    >
                      <Face name={p.displayName} url={p.avatarUrl} />
                      <span className="af-cm-pick-text">
                        <span className="af-cm-pick-top">
                          <span className="af-cm-pick-name">{p.displayName}</span>
                          <span className="af-cm-pick-handle">@{p.username}</span>
                        </span>
                        {leagues ? <span className="af-cm-pick-league">{leagues}</span> : null}
                      </span>
                      {!isDm ? (
                        <span className="af-cm-pick-check" aria-hidden="true">
                          {picked ? '✓' : '+'}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          {note ? (
            <p className="af-cm-pick-note" id={noteId} role="status">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default PeoplePicker
