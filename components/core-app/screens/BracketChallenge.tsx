'use client'

import Link from 'next/link'
import { useState } from 'react'
import '@/components/core-app/af-bracket.css'
import type { BracketChallengeData, BracketSide, BracketTeam } from '@/lib/core-app/bracketChallenge'
import { TopicTip } from '@/components/core-app/TopicTip'

/**
 * 28a — Bracket Challenge, on the shared sport shell.
 *
 * ⚠ ONE SHELL, EVERY SPORT. This component knows nothing about baseball. It
 * renders whatever `shell` describes: a team count, a list of rounds, and which
 * seeds hold a bye. Adding the NBA is adding an entry to `SPORT_SHELLS` and
 * flipping `available` — if it ever needs a branch on `shell.key` here, the
 * shell is wrong, not this file.
 *
 * ⚠ A BYE SLOT STAYS OPEN UNTIL THE ROUND BELOW IT RESOLVES. Seeds 1 and 2 in
 * MLB have no Division Series opponent until the Wild Card is played, and the
 * bracket renders that as "?" rather than penciling in the higher remaining
 * seed. Pre-filling a bye's opponent is the specific mistake this handoff calls
 * out.
 *
 * ⚠ POINT VALUES AND SERIES FORMATS COME FROM THE SHELL AND ARE REAL RULES.
 * Wild Card best-of-three, Division best-of-five, Championship and World Series
 * best-of-seven. They are displayed, not decorative, because they are what the
 * pool is scored on.
 *
 * ⚠ SEEDS ARE NOT INVENTED. Nothing stores a postseason seed yet, so every slot
 * arrives empty and the screen says why. That is deliberate: the handoff wants
 * the bracket playable with placeholder slots so pools can form early, and a
 * guessed field would let someone enter against a lineup we made up.
 */

export type BracketChallengeProps = {
  data: BracketChallengeData
}

function SeedSlot({
  seed,
  team,
  bye,
}: {
  seed: number
  team: BracketTeam | null
  bye: boolean
}) {
  return (
    <div className="af-bk-slot" data-bye={bye ? 'true' : undefined} data-open={team ? undefined : 'true'}>
      <span className="af-bk-seed">{seed}</span>
      {team ? (
        <>
          {team.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="af-bk-logo" src={team.logo} alt="" width={18} height={18} />
          ) : (
            <span className="af-bk-logo af-bk-logo--none" aria-hidden="true" />
          )}
          <span className="af-bk-team">{team.shortName}</span>
        </>
      ) : (
        <span className="af-bk-open">?</span>
      )}
    </div>
  )
}

/*
 * ⚠ AN OPEN SLOT'S "WHY" IS ONE "?" AT THE FIRST "Byes" LABEL, NOT A `title=` ON EVERY SLOT. Each "?"
 * used to carry "Seeding not published yet" / "Winner not decided yet", and each bye's waiting slot
 * "Seeds 1 and 2 sit out the …" — hover-only, so a phone showed none of it. `bracketBye` says both,
 * once, for both sides.
 */
function SideColumn({
  side,
  mirrored,
}: {
  side: BracketSide
  mirrored: boolean
}) {
  const bySeed = new Map(side.slots.map((s) => [s.seed, s]))
  const byes = side.slots.filter((s) => s.bye)

  return (
    <div className="af-bk-side" data-mirrored={mirrored ? 'true' : undefined}>
      <p className="af-bk-side-label">{side.label}</p>

      {/* Round one — only the seeds without a bye. Outward-in. */}
      <div className="af-bk-col">
        <span className="af-bk-col-label">Round 1</span>
        {side.pairs.map(([a, b]) => (
          <div key={`${a}-${b}`} className="af-bk-match">
            <SeedSlot seed={a} team={bySeed.get(a)?.team ?? null} bye={false} />
            <SeedSlot seed={b} team={bySeed.get(b)?.team ?? null} bye={false} />
          </div>
        ))}
      </div>

      {/* The byes. Their opponent is genuinely unknown until round one resolves. */}
      <div className="af-bk-col">
        <span className="af-bk-col-label">
          Byes
          {/* First side only — the mirrored side repeats the same rule. */}
          {!mirrored ? (
            <>
              {' '}
              <TopicTip topic="bracketBye" />
            </>
          ) : null}
        </span>
        {byes.map((s) => (
          <div key={s.seed} className="af-bk-match af-bk-match--bye">
            <SeedSlot seed={s.seed} team={s.team} bye />
            <div className="af-bk-slot af-bk-slot--waiting">
              <span className="af-bk-open">?</span>
              <span className="af-bk-waiting">awaits Round 1</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BracketChallenge({ data }: BracketChallengeProps) {
  const { shell } = data
  const [champion, setChampion] = useState<BracketTeam | null>(null)
  const [length, setLength] = useState<number | null>(null)

  const maxPoints =
    shell.rounds.reduce((sum, r) => sum + r.points, 0) + (shell.finalLength?.bonus ?? 0)

  return (
    <div className="af-bk">
      <header className="af-bk-head">
        <p className="af-bk-eyebrow af-label">Bracket Challenge</p>
        <h1 className="af-display af-bk-title">{shell.label} 2026</h1>

        {/* Sport switcher. One shell — every entry here renders through this file. */}
        <nav className="af-bk-sports" aria-label="Sport">
          {data.sports.map((s) => (
            <Link
              key={s.key}
              href={`/core/bracket?sport=${s.key}`}
              className="af-bk-sport"
              aria-current={s.key === shell.key ? 'page' : undefined}
              data-soon={!s.available ? 'true' : undefined}
            >
              {s.label}
              {!s.available ? <span className="af-bk-soon">soon</span> : null}
            </Link>
          ))}
        </nav>
      </header>

      {/* Round-value key. Real formats, because they are what scoring uses. */}
      <section className="af-bk-key" aria-label="How it scores">
        {shell.rounds.map((r) => (
          <div key={r.id} className="af-bk-key-item">
            <span className="af-bk-key-pts">{r.points}</span>
            <span className="af-bk-key-label">{r.label}</span>
            <span className="af-bk-key-fmt">{r.bestOf ? `best of ${r.bestOf}` : 'single game'}</span>
          </div>
        ))}
        {shell.finalLength ? (
          <div className="af-bk-key-item af-bk-key-item--bonus">
            <span className="af-bk-key-pts">+{shell.finalLength.bonus}</span>
            <span className="af-bk-key-label">Exact length</span>
            <span className="af-bk-key-fmt">call the series in games</span>
          </div>
        ) : null}
        <div className="af-bk-key-item af-bk-key-item--total">
          <span className="af-bk-key-pts">{maxPoints}</span>
          <span className="af-bk-key-label">Perfect bracket</span>
          <span className="af-bk-key-fmt">nobody has one</span>
        </div>
      </section>

      {data.seedsPending ? (
        <p className="af-bk-pending" role="note">
          Seeding is not published yet, so every slot is open. That is deliberate — the bracket is
          playable now so pools can form early, and slots fill as teams clinch rather than being
          guessed at.
        </p>
      ) : null}

      {/* ── The bracket ─────────────────────────────────────────────── */}
      <div className="af-bk-board">
        <SideColumn side={data.sides[0]} mirrored={false} />

        <div className="af-bk-centre">
          <span className="af-bk-centre-label">{shell.rounds[shell.rounds.length - 1].label}</span>

          {/* The champion slot. */}
          <div className="af-bk-champ" data-filled={champion ? 'true' : undefined}>
            {champion ? (
              <>
                {champion.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="af-bk-champ-logo" src={champion.logo} alt="" width={40} height={40} />
                ) : null}
                <span className="af-bk-champ-name">{champion.name}</span>
                <button type="button" className="af-bk-champ-clear" onClick={() => setChampion(null)}>
                  Change
                </button>
              </>
            ) : (
              <span className="af-bk-champ-empty">Pick your champion</span>
            )}
          </div>

          <label className="af-bk-picker">
            <span className="af-bk-picker-label">Champion</span>
            <select
              className="af-bk-select"
              value={champion?.id ?? ''}
              onChange={(e) => setChampion(data.pool.find((t) => t.id === e.target.value) ?? null)}
            >
              <option value="">Choose a team…</option>
              {data.pool.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {/*
           * ⚠ THESE PICKS ARE NOT SAVED, AND THE SCREEN MUST SAY SO. Champion and length live in
           * `useState` only — no route, no table, no entry — so a reload clears them. This screen
           * is a preview of the shell; picks that count live in a pool (PlayoffBracketEntry /
           * PlayoffBracketPick), entered from /brackets. It once said "Nothing you pick is lost
           * when the field locks"; pinned by __tests__/core-app/bracket-challenge-picks-not-saved.
           * Wire persistence and change this copy in the same commit, or neither.
           */}
          <p className="af-bk-unsaved" role="note" data-testid="af-bk-unsaved">
            Picks here are a preview and are not saved — a reload clears them. To make picks that
            count, <Link href="/brackets">join or start a pool</Link>.
          </p>

          {/* Length pick — only where the final is a series. */}
          {shell.finalLength ? (
            <div className="af-bk-length">
              <span className="af-bk-picker-label">
                In how many games? <span className="af-bk-bonus">+{shell.finalLength.bonus}</span>
              </span>
              <div className="af-bk-length-set" role="group" aria-label="Series length">
                {shell.finalLength.options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="af-bk-length-btn"
                    aria-pressed={length === n}
                    onClick={() => setLength(length === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <SideColumn side={data.sides[1]} mirrored />
      </div>

      {/* ── One shell, every sport ──────────────────────────────────── */}
      <aside className="af-bk-note">
        <h2 className="af-bk-note-title">One shell, every sport</h2>
        <p className="af-bk-note-body">
          This bracket and the World Cup one are the same component. Three things change per sport,
          and nothing else:
        </p>
        <dl className="af-bk-vars">
          <div>
            <dt>Team count</dt>
            <dd>{shell.teamCount}</dd>
          </div>
          <div>
            <dt>Round count</dt>
            <dd>{shell.rounds.length}</dd>
          </div>
          <div>
            <dt>Byes</dt>
            <dd>{shell.byeSeeds.length ? `seeds ${shell.byeSeeds.join(', ')}` : 'none'}</dd>
          </div>
        </dl>
        <p className="af-bk-note-body">
          A new sport is a new entry in that table. If one ever needs its own bracket code, the
          shell is wrong — fix the shell, for every sport at once.
        </p>
      </aside>
    </div>
  )
}

export default BracketChallenge
