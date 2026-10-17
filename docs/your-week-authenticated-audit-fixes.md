# Your Week authenticated audit corrections

The user supplied an authenticated production audit of the portfolio weekly page,
the HailShiva league weekly page, and Rivalry Radar, plus downloaded PNG cards and
workbooks. The audit reports were provided by the user; this Codex session could
not directly control that authenticated browser because its Windows helper failed.

## Correctness

- A featured matchup's playoff probability must come from the same internal league
  ID and season. Missing matching models withhold the probability. Equal display
  names never imply equal league identity. This applies to brief, captions and PNG.
- Rivalry Radar keeps current-period matches on the schedule when scores become
  live or final. Pregame historical probabilities are withheld after scoring starts.
- Rounded zero margins show `0.0`, never a negative zero.

## Sharing and exports

- Public captions use first-person copy, named league odds and matchup details,
  including when the opponent story is disabled. In-app Chimmy guidance stays out
  of public captions. A single previous win is described as the last meeting, with
  the full imported series record distinguished from a winning streak.
- PNG cards display the league, matchup, a probability panel and a separate next
  priority panel. Missing probabilities are explicitly unavailable. Canvas text
  remains bounded and is never interpreted as HTML.
- Excel charts have explicit visible axes, category labels, titles and percentage
  value labels. A single observed point is a first saved estimate, not a trend.
  Numeric cells retain their precision with one-decimal percentage display.
- Chart-free exports are labeled Download Excel, with explicit missing-chart notes.
- Commissioner drafts use known sport, period, available scenario period and model
  gaps, with editable placeholders for official deadlines and announcements.

## UI

- Native checkbox appearance is restored locally for opponent-story selection.
- Rivalry cards have zero minimum width and the mobile grid uses minmax(0,1fr).
- My Team, full scenarios and rivalry matchup links meet a 44px height.
- Calculation timestamps localize in the browser with a hydration-safe initial text.
- The welcome guide occupies document flow at all widths and cannot overlay controls.

## Chimmy

The final guard previously saw the earlier grounding packet but not the authorized,
bounded server enrichment and memory supplied to the model in PECR context. The
same evidence now reaches the final guard. The guard's thresholds remain intact.

An answer replaced by the guard is marked rejected_answer and reaches existing
token-refund and included-allowance-release paths. An annotated answer remains an
answer. This does not retroactively change the user's earlier quota usage.

The audit's production Decision OS timeout and successful live answer delivery must
be retested in an authenticated browser after release. These code corrections do
not prove a provider or database timeout has been resolved.

## Verification

- First focused run: 8 files, 125 passing tests.
- Related delivery/allowance/guard/history/security run: 8 files, 68 passing tests.
- Final affected-code rerun: 8 files, 122 passing tests, including zero-margin rendering.
- Weekly TypeScript positive-control check: 18 source files, no source errors;
  22 unrelated dependency diagnostics remain in the shared local dependency tree.
- Actual component fixture checked at 375, 768 and 1440px in AF, light and dark:
  no horizontal overflow, welcome guide in flow, native checkbox appearance,
  weekly and rivalry action links at least 44px.
- Original downloaded files independently inspected: portfolio has no chart parts;
  league has two charts, both without title, tick-label position or value-label parts.
- New example workbook: 23 XML/relationship parts parse, both charts carry explicit
  titles, visible axis-label positions, value labels and the correct categories.
- Redesigned 1080x1350 canvas card rendered and visually inspected using example data.

The user-provided downloads are preserved. Example artifacts use illustrative data.
