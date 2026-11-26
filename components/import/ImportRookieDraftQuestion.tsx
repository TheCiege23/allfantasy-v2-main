'use client'

/**
 * "Have you had your 2026 rookie draft?" on the import confirm screen, for a dynasty, C2C or devy league.
 *
 * Only ASKED when the platform cannot say (ESPN, MFL, Yahoo, Fantrax): those report a league as in season
 * all year, so this season's picks would read as already used. Sleeper reports it, so there the screen
 * states what Sleeper said in one line and asks nothing. Unanswered sends nothing — exactly as before.
 * The rule that uses the answer is lib/dynasty-core/rookieDraftDone.ts.
 */

export function ImportRookieDraftQuestion(props: {
  season: number | null
  /** What the platform reported, or null when it does not say. */
  fromPlatform: 'done' | 'not_done' | null | undefined
  platformLabel: string
  value: boolean | null
  onChange: (next: boolean | null) => void
}) {
  const draft = props.season ? `${props.season} rookie draft` : 'rookie draft'

  if (props.fromPlatform) {
    return (
      <p className="af-im-field-help af-im-rookie-known" data-testid="import-rookie-draft-known">
        {props.fromPlatform === 'done'
          ? `${props.platformLabel} says your ${draft} is done.`
          : `${props.platformLabel} says your ${draft} hasn’t happened yet, so this year’s picks stay on the board.`}
      </p>
    )
  }

  const choice = (done: boolean, label: string) => (
    <button
      type="button"
      className="af-im-rookie-choice"
      aria-pressed={props.value === done}
      data-selected={props.value === done ? 'true' : undefined}
      onClick={() => props.onChange(props.value === done ? null : done)}
    >
      {label}
    </button>
  )

  return (
    <div className="af-im-rookie" role="group" aria-labelledby="import-rookie-draft-q" data-testid="import-rookie-draft">
      <p className="af-label" id="import-rookie-draft-q">
        Have you had your {draft}?
      </p>
      <div className="af-im-rookie-choices">
        {choice(true, 'Yes, it’s done')}
        {choice(false, 'Not yet')}
      </div>
      <p className="af-im-field-help">
        {props.value === true
          ? 'This year’s picks are marked used. Your picks start with next year’s draft.'
          : props.value === false
            ? 'This year’s picks stay on the board until the draft.'
            : `${props.platformLabel} doesn’t say. Your answer decides whether this year’s picks are still on the board.`}
      </p>
    </div>
  )
}
