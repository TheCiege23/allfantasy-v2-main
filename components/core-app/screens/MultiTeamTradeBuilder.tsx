'use client'

import { useMemo, useState } from 'react'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import { useMessages } from '@/components/i18n/useMessages'
import { multiTeamTradeMessages } from '@/lib/core-app/messages/multiTeamTrade'
import { gradeMultiTeam, MAX_MULTI_TEAMS, MIN_MULTI_TEAMS, type MultiAsset } from '@/lib/trade-intel/multiTeamGrade'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

/**
 * Create a trade with 3 or 4 teams (2026-11-14).
 *
 * Each team in the deal is a card listing what it SENDS; each item there says who gets it. The grade is
 * live: a letter for every team, from what it gets against what it gives (lib/trade-intel/multiTeamGrade.ts),
 * on the same A–F scale as a 2-team trade, and labelled "league value only" because roster fit and
 * Chimmy's read are 2-team features. AllFantasy never sends a trade, so the last step links out.
 *
 * `initial` loads a 3–4 team screenshot (lib/trade-screenshot/matchMultiOffer.ts); the parent remounts
 * this component with a new `key` when one arrives, so local state starts from it.
 */
export function MultiTeamTradeBuilder(props: {
  rosters: readonly LeagueRoster[]
  viewerRosterId: string | null
  sendHref?: string | null
  platformLabel?: string | null
  initial?: { teamIds: string[]; assets: MultiAsset[] } | null
}) {
  const m = useMessages(multiTeamTradeMessages)
  const byId = useMemo(() => new Map(props.rosters.map((r) => [r.rosterId, r])), [props.rosters])
  const [teamIds, setTeamIds] = useState<string[]>(() =>
    props.initial?.teamIds?.length ? props.initial.teamIds : props.viewerRosterId && byId.has(props.viewerRosterId) ? [props.viewerRosterId] : [],
  )
  const [assets, setAssets] = useState<MultiAsset[]>(() => props.initial?.assets ?? [])
  const [query, setQuery] = useState<Record<string, string>>({})
  const [maxNote, setMaxNote] = useState(false)

  const nameOf = (id: string) => (id === props.viewerRosterId ? m.you : byId.get(id)?.ownerName ?? m.anotherManager)
  const num = (v: number) => Math.round(v).toLocaleString(getAppIntlLocale())

  const toggleTeam = (id: string) => {
    setMaxNote(false)
    if (teamIds.includes(id)) {
      setTeamIds(teamIds.filter((t) => t !== id))
      /* A team that leaves takes what it sent with it, and what was going to it goes nowhere. */
      setAssets(assets.filter((a) => a.from !== id && a.to !== id))
      return
    }
    if (teamIds.length >= MAX_MULTI_TEAMS) {
      setMaxNote(true)
      return
    }
    setTeamIds([...teamIds, id])
  }

  const add = (from: string, a: Omit<MultiAsset, 'from' | 'to'>) => {
    const others = teamIds.filter((t) => t !== from)
    /* Defaults to the next team round the table, so a fresh deal fans out instead of piling on one team. */
    const to = others[(teamIds.indexOf(from) + others.length) % Math.max(others.length, 1)] ?? others[0]
    if (!to || assets.some((x) => x.key === a.key)) return
    setAssets([...assets, { ...a, from, to }])
    setQuery({ ...query, [from]: '' })
  }

  const grade = teamIds.length >= MIN_MULTI_TEAMS ? gradeMultiTeam(teamIds, assets) : null
  const gradeOf = (id: string) => grade?.teams.find((t) => t.rosterId === id) ?? null

  return (
    <div className="af-mt" data-testid="multi-team-builder">
      <fieldset className="af-mt-teams">
        <legend className="af-label">{m.teamsLabel}</legend>
        <p className="af-mt-hint">{m.teamsHint}</p>
        <div className="af-mt-chips">
          {props.rosters.map((r) => (
            <button
              key={r.rosterId}
              type="button"
              className="af-tc-chip af-mt-chip"
              aria-pressed={teamIds.includes(r.rosterId)}
              data-on={teamIds.includes(r.rosterId)}
              onClick={() => toggleTeam(r.rosterId)}
            >
              {nameOf(r.rosterId)}
            </button>
          ))}
        </div>
        {maxNote ? <p className="af-mt-hint" role="status">{m.maxTeams}</p> : null}
      </fieldset>

      {teamIds.length < MIN_MULTI_TEAMS ? (
        <p className="af-mt-hint" data-testid="multi-team-pick-more">{m.pickMoreTeams}</p>
      ) : null}

      <div className="af-mt-grid">
        {teamIds.map((id) => {
          const roster = byId.get(id)
          const sent = assets.filter((a) => a.from === id)
          const q = (query[id] ?? '').trim().toLowerCase()
          const options = roster
            ? [
                ...roster.players.map((p) => ({ key: `player:${p.id}`, kind: 'player' as const, label: p.name, position: p.position, value: p.value, playerId: p.id })),
                ...roster.picks.map((p) => ({ key: `pick:${p.pickId}`, kind: 'pick' as const, label: p.label, position: null, value: p.value, pickId: p.pickId })),
              ]
                .filter((o) => !assets.some((a) => a.key === o.key))
                .filter((o) => q.length > 0 && o.label.toLowerCase().includes(q))
                .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
                .slice(0, 6)
            : []
          const g = gradeOf(id)
          return (
            <section className="af-mt-team" key={id} data-testid="multi-team-card" aria-label={m.sends(nameOf(id))}>
              <header className="af-mt-team-head">
                <h3 className="af-mt-team-name">{m.sends(nameOf(id))}</h3>
                {g?.graded ? (
                  <span className="af-mt-letter af-num" data-letter={g.letter} aria-label={`${m.gradeTitle} ${g.letter}`}>
                    {g.letter}
                  </span>
                ) : null}
              </header>
              {sent.length === 0 ? <p className="af-mt-empty">{m.nothingYet}</p> : null}
              <ul className="af-mt-assets">
                {sent.map((a) => (
                  <li key={a.key} className="af-mt-asset" data-testid="multi-team-asset">
                    <span className="af-mt-asset-name">
                      {a.label}
                      {a.position ? <span className="af-mt-asset-pos"> {a.position}</span> : null}
                    </span>
                    <span className="af-mt-asset-value af-num">{a.value != null ? num(a.value) : '—'}</span>
                    <label className="af-mt-asset-to">
                      <span>{m.goesTo}</span>
                      <select
                        aria-label={m.goesToFor(a.label)}
                        value={a.to}
                        onChange={(e) => setAssets(assets.map((x) => (x.key === a.key ? { ...x, to: e.target.value } : x)))}
                      >
                        {teamIds
                          .filter((t) => t !== id)
                          .map((t) => (
                            <option key={t} value={t}>
                              {nameOf(t)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="af-mt-remove"
                      aria-label={m.removeAsset(a.label)}
                      onClick={() => setAssets(assets.filter((x) => x.key !== a.key))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {teamIds.length >= 2 ? (
                <div className="af-mt-search">
                  <input
                    type="search"
                    value={query[id] ?? ''}
                    placeholder={m.search}
                    aria-label={m.searchFor(nameOf(id))}
                    onChange={(e) => setQuery({ ...query, [id]: e.target.value })}
                  />
                  {q.length > 0 ? (
                    options.length > 0 ? (
                      <ul className="af-mt-options">
                        {options.map((o) => (
                          <li key={o.key}>
                            <button type="button" onClick={() => add(id, o)}>
                              <span>
                                {o.label}
                                {o.position ? <span className="af-mt-asset-pos"> {o.position}</span> : null}
                              </span>
                              <span className="af-num">{o.value != null ? num(o.value) : '—'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="af-mt-empty">{m.noMatch}</p>
                    )
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      {grade ? (
        <section className="af-mt-grade" aria-labelledby="af-mt-grade-title" data-testid="multi-team-grade">
          <h3 id="af-mt-grade-title" className="af-mt-grade-title">
            {m.gradeTitle} <span className="af-mt-grade-sub">· {m.gradeSub}</span>
          </h3>
          <p className="af-mt-verdict" data-testid="multi-team-verdict">
            {grade.verdict.kind === 'fair'
              ? m.fair
              : grade.verdict.kind === 'ahead'
                ? m.ahead(grade.verdict.rosterIds.map(nameOf))
                : m.incomplete}
          </p>
          <ul className="af-mt-grade-rows">
            {grade.teams.map((t) => (
              <li key={t.rosterId} className="af-mt-grade-row" data-testid="multi-team-grade-row">
                <span className="af-mt-letter af-num" data-letter={t.graded ? t.letter : undefined}>
                  {t.graded ? t.letter : '—'}
                </span>
                <span>
                  {t.graded
                    ? m.gets(nameOf(t.rosterId), num(t.gets), num(t.gives))
                    : `${nameOf(t.rosterId)}: ${t.why === 'gets_nothing' ? m.getsNothing : t.why === 'sends_nothing' ? m.sendsNothing : m.unpriced(t.unpriced)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="af-mt-basis">{m.basis}</p>
          {props.sendHref && props.platformLabel && grade.verdict.kind !== 'incomplete' ? (
            <a className="af-btn af-mt-send" href={props.sendHref} target="_blank" rel="noreferrer noopener">
              {m.sendIn(props.platformLabel)} ↗
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
