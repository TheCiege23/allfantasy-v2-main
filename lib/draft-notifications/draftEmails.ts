import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'

/**
 * 22b — the draft-lifecycle emails: "Draft starts in 1 hour" and "Draft complete".
 *
 * ⚠ SAME VISUAL FAMILY AS 22a, AND THE SAME GRADE SCALE. `GradeLetter` is
 * imported from `lib/trade-intel/gradeScale`, which exists precisely so a letter
 * means the same thing in every AllFantasy communication. A draft graded on its
 * own private scale would put a B in one email and a B in another that were not
 * comparable — which is worse than no grade.
 *
 * ⚠ DEPENDENCY-FREE ON PURPOSE. No 'server-only', no prisma, no fetch. These are
 * renderers: the caller reads the data, these turn it into HTML. That is what
 * lets the dev handoff preview render them, and what lets a test assert on the
 * output without a database.
 *
 * ⚠ AVAILABILITY IS ALWAYS THIS LEAGUE'S OWN HISTORY, AND SAYS SO EVERY TIME.
 * `AvailabilityCandidate.probability` must be computed from completed drafts in
 * THIS league, never from a national ADP board. The copy states the source on
 * every render — see `AVAILABILITY_SOURCE` — because a manager who reads a
 * percentage and assumes it is industry consensus will draft against the wrong
 * expectation. `draftsSampled` is required for the same reason: a percentage
 * from one prior draft is not the same claim as one from six.
 *
 * ⚠ GRADES ACCOUNT FOR LEAGUE SETTINGS, AND THE SETTINGS ARE PRINTED. A TE in a
 * TE-premium league is not the same pick as a TE in a standard one. `leagueNote`
 * is required on the recap for that reason — the same field 22a prints, from the
 * same describeLeague() helper.
 *
 * ⚠ "WHAT'S STILL MISSING" IS NOT A LIST OF MISTAKES. A hole at a position where
 * nothing was available when you picked is a waiver problem, not a drafting
 * error, and `RosterGap.fixable` is what keeps those two apart. Calling the
 * second one a failure is the specific dishonesty this section is designed to
 * avoid.
 *
 * ⚠ THE THIRD MOMENT IS NOT BUILT. The handoff's section title references a
 * "you're on the clock" email alongside these two, but no design was supplied
 * for it and none is invented here. `lib/draft-notifications/DraftNotificationService`
 * already raises an in-app on-the-clock notification (`notifyOnTheClockAfterPick`);
 * whether that moment also warrants an email is an open question for product.
 */

// Shared palette with 22a. Solid hexes — Outlook's Word engine drops rgba.
const BG = '#0b0b0f'
const CARD = '#15151c'
const BORDER = '#262631'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const GOOD = '#4ade80'
const WARN = '#fbbf24'
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

const GRADE_COLORS: Record<GradeLetter, { bg: string; fg: string }> = {
  A: { bg: '#123524', fg: '#4ade80' },
  B: { bg: '#0f2f3d', fg: '#38bdf8' },
  C: { bg: '#2a2416', fg: '#fbbf24' },
  D: { bg: '#33200f', fg: '#fb923c' },
  F: { bg: '#331417', fg: '#f87171' },
}

/** Printed wherever an availability percentage appears. Never abbreviated away. */
const AVAILABILITY_SOURCE = "from this league's own completed drafts, not a national ADP board"

export type DraftEmail = { subject: string; html: string }

export type AvailabilityCandidate = {
  name: string
  position: string
  /** 0–1. Chance he is still there at your pick, per this league's own history. */
  probability: number
}

export type RosterGap = {
  position: string
  /**
   * True when the waiver wire can plausibly fix it. False means it genuinely had
   * to be drafted. The distinction is the whole point of the section — see the
   * file header.
   */
  fixable: boolean
  /** Why. Always specific — "nothing at the position went after round 9". */
  note: string
}

// ── Shared chrome ──────────────────────────────────────────────────────

function shell(inner: string, footer: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="background:${BG};padding:24px 12px;font-family:${FONT};color:${TEXT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
    ${inner}
    ${footer}
  </table>
</div>
</body>
</html>`
}

function header(eyebrow: string, title: string, sub: string, note?: string | null): string {
  return `
<tr>
  <td style="padding-bottom:14px">
    <div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:${FAINT};font-weight:700">${escapeHtml(eyebrow)}</div>
    <div style="font-size:21px;font-weight:800;color:${TEXT};margin-top:5px;line-height:1.25">${escapeHtml(title)}</div>
    <div style="font-size:13px;color:${MUTED};margin-top:3px">${escapeHtml(sub)}</div>
    ${note ? `<div style="font-size:11px;color:${FAINT};margin-top:6px">${escapeHtml(note)}</div>` : ''}
  </td>
</tr>`
}

function cta(href: string, label: string, sub: string): string {
  return `
<tr>
  <td align="center" style="padding:20px 0 6px 0">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px">${escapeHtml(label)}</a>
    <div style="font-size:11px;color:${FAINT};margin-top:9px">${escapeHtml(sub)}</div>
  </td>
</tr>`
}

/**
 * The footer, carrying the same per-league mute as 22a.
 *
 * Duplicated shape rather than imported because 22a's `emailFooter` is a private
 * helper in a module that pulls in the trade grading types. Both are small; the
 * contract that matters — per-league mute alongside global unsubscribe — is the
 * thing kept identical, and it is asserted in the preview.
 */
function footer(params: {
  baseUrl: string
  leagueName: string
  leagueId: string | null
  unsubscribeUrl: string | null
}): string {
  const muteHref = params.leagueId
    ? `${params.baseUrl}/settings?tab=notifications&league=${encodeURIComponent(params.leagueId)}`
    : `${params.baseUrl}/settings?tab=notifications`
  const link = (href: string, text: string) =>
    `<a href="${escapeHtml(href)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(text)}</a>`
  return `
<tr>
  <td style="padding-top:16px;border-top:1px solid ${BORDER};color:${FAINT};font-size:11px;line-height:1.7">
    AllFantasy.ai<br>
    ${link(muteHref, `Mute ${params.leagueName}`)}
    &nbsp;&middot;&nbsp;
    ${link(`${params.baseUrl}/settings?tab=notifications`, 'Change preferences')}
    ${params.unsubscribeUrl ? `&nbsp;&middot;&nbsp;${link(params.unsubscribeUrl, 'Unsubscribe from all')}` : ''}
  </td>
</tr>`
}

// ── "Draft starts in 1 hour" ───────────────────────────────────────────

export type DraftStartingEmailParams = {
  leagueName: string
  leagueId: string | null
  /** "1.04" — the slot, in round.pick form. */
  pickSlot: string
  /** Minutes until the first pick. Drives the subject and the urgency line. */
  minutesUntilStart: number
  /** How many players the user has queued. Zero triggers the warning. */
  queueSize: number
  /**
   * Positions the roster cannot currently fill. Empty is fine and renders
   * nothing — a pre-draft roster is usually empty, and shouting about it would
   * be noise.
   */
  rosterHoles: string[]
  /** Likely-available names at this pick. Empty renders the honest absence. */
  availability: AvailabilityCandidate[]
  /**
   * How many completed drafts in THIS league the percentages were computed from.
   * Required: a percentage with no sample size is not a percentage anyone can
   * weigh, and one prior draft is a very different claim from six.
   */
  draftsSampled: number
  /** Where "build your queue" goes. */
  queueUrl: string
  baseUrl: string
  unsubscribeUrl?: string | null
}

export function buildDraftStartingEmail(params: DraftStartingEmailParams): DraftEmail {
  const {
    leagueName,
    pickSlot,
    minutesUntilStart,
    queueSize,
    rosterHoles,
    availability,
    draftsSampled,
    queueUrl,
    baseUrl,
  } = params

  const when =
    minutesUntilStart >= 60
      ? `${Math.round(minutesUntilStart / 60)} hour${Math.round(minutesUntilStart / 60) === 1 ? '' : 's'}`
      : `${minutesUntilStart} minutes`

  // The subject never hides the news: league, when, and the slot.
  const subject = `${leagueName} drafts in ${when} — you pick ${pickSlot}`

  /*
   * The empty-queue warning. Only when the queue is genuinely empty — a warning
   * that fires on a full queue is a warning nobody reads the next time.
   */
  const queueBlock =
    queueSize === 0
      ? `
<tr>
  <td style="padding:12px 14px;background:${CARD};border:1px solid #4a3a12;border-left:3px solid ${WARN};border-radius:12px">
    <div style="font-size:12px;font-weight:800;color:${WARN}">Your queue is empty.</div>
    <div style="font-size:11.5px;color:${MUTED};line-height:1.6;margin-top:4px">
      If you miss the clock with nothing queued, autopick takes whoever it likes. One minute now is the difference.
    </div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
      : `
<tr>
  <td style="padding:10px 14px;border:1px solid ${BORDER};border-radius:12px">
    <div style="font-size:11.5px;color:${MUTED}">
      <span style="color:${GOOD};font-weight:700">${queueSize} queued.</span> Autopick will work down that list if you miss the clock.
    </div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`

  const holesBlock =
    rosterHoles.length > 0
      ? `
<tr>
  <td style="padding:10px 14px;border:1px solid ${BORDER};border-radius:12px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700">Where you are thin</div>
    <div style="font-size:11.5px;color:${MUTED};line-height:1.6;margin-top:4px">${escapeHtml(rosterHoles.join(' · '))}</div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
      : ''

  /*
   * The availability list. Every render states the source and the sample — the
   * copy contract, and the reason `draftsSampled` is a required parameter.
   */
  const availabilityBlock =
    availability.length > 0
      ? `
<tr>
  <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:8px">
      Likely still there at ${escapeHtml(pickSlot)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${availability
        .map(
          (c) => `
      <tr>
        <td style="padding:5px 0;font-size:12.5px;color:${TEXT}">${escapeHtml(c.name)} <span style="color:${FAINT};font-size:11px">${escapeHtml(c.position)}</span></td>
        <td align="right" style="padding:5px 0;font-size:12.5px;font-weight:700;color:${c.probability >= 0.6 ? GOOD : c.probability >= 0.3 ? WARN : MUTED}">${Math.round(c.probability * 100)}%</td>
      </tr>`,
        )
        .join('')}
    </table>
    <div style="font-size:10.5px;color:${FAINT};line-height:1.6;margin-top:9px">
      Percentages are ${escapeHtml(AVAILABILITY_SOURCE)} — ${draftsSampled} completed ${draftsSampled === 1 ? 'draft' : 'drafts'} on file. Your leaguemates do not draft like the internet does.
    </div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
      : `
<tr>
  <td style="padding:12px 14px;border:1px dashed ${BORDER};border-radius:12px">
    <div style="font-size:11.5px;color:${MUTED};line-height:1.6">
      We hold no completed drafts for this league yet, so there is no availability read to give you.
      A national ADP board would be a guess about different people — we would rather say nothing.
    </div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`

  const inner = [
    header(
      `Draft · starts in ${when}`,
      leagueName,
      `You pick ${pickSlot}.`,
      null,
    ),
    queueBlock,
    holesBlock,
    availabilityBlock,
    cta(queueUrl, queueSize === 0 ? 'Build your queue' : 'Review your queue', 'Opens your draft board.'),
  ].join('')

  return {
    subject,
    html: shell(
      inner,
      footer({
        baseUrl,
        leagueName,
        leagueId: params.leagueId,
        unsubscribeUrl: params.unsubscribeUrl ?? null,
      }),
    ),
  }
}

// ── "Draft complete" ───────────────────────────────────────────────────

export type DraftPickRecap = {
  /** "1.04" */
  slot: string
  playerName: string
  position: string
  /**
   * Where the market had him going, in the same round.pick notation. Null when
   * he was unpriced — rendered as "unpriced", never as a zero.
   */
  marketSlot: string | null
  grade: GradeLetter
  /** One clause on why. Always specific to this pick. */
  note: string
}

export type DraftRecapEmailParams = {
  leagueName: string
  leagueId: string | null
  overallGrade: GradeLetter
  /** One line on what the draft actually accomplished. */
  summary: string
  picks: DraftPickRecap[]
  /** Remaining holes, split by whether waivers can fix them. */
  gaps: RosterGap[]
  /**
   * "12-team superflex dynasty · full PPR · TE premium". Required: a grade
   * without the settings behind it invites the reader to score it against a
   * default scoring system that is not theirs.
   */
  leagueNote: string
  boardUrl: string
  baseUrl: string
  unsubscribeUrl?: string | null
}

export function buildDraftRecapEmail(params: DraftRecapEmailParams): DraftEmail {
  const { leagueName, overallGrade, summary, picks, gaps, leagueNote, boardUrl, baseUrl } = params

  const subject = `${leagueName} draft complete — you graded ${overallGrade}`
  const colors = GRADE_COLORS[overallGrade]

  const gradeBlock = `
<tr>
  <td style="padding:16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="font-size:13px;color:${MUTED};line-height:1.6">${escapeHtml(summary)}</td>
        <td align="right" style="width:70px">
          <div style="display:inline-block;min-width:34px;padding:8px 12px;background:${colors.bg};color:${colors.fg};border-radius:10px;font-size:24px;font-weight:800;text-align:center">${escapeHtml(overallGrade)}</div>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`

  const picksBlock =
    picks.length > 0
      ? `
<tr>
  <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:8px">
      Pick by pick
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${picks
        .map((p) => {
          const c = GRADE_COLORS[p.grade]
          return `
      <tr>
        <td style="padding:7px 0;border-top:1px solid ${BORDER}">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="font-size:12.5px;color:${TEXT};font-weight:600">
                <span style="color:${FAINT};font-size:11px">${escapeHtml(p.slot)}</span>&nbsp;
                ${escapeHtml(p.playerName)}
                <span style="color:${FAINT};font-size:11px">${escapeHtml(p.position)}</span>
              </td>
              <td align="right" style="width:56px">
                <span style="display:inline-block;min-width:18px;padding:2px 7px;background:${c.bg};color:${c.fg};border-radius:6px;font-size:11px;font-weight:800;text-align:center">${escapeHtml(p.grade)}</span>
              </td>
            </tr>
          </table>
          <div style="font-size:11px;color:${MUTED};line-height:1.55;margin-top:3px">
            ${p.marketSlot ? `Market had him at ${escapeHtml(p.marketSlot)}. ` : 'Unpriced by the market. '}${escapeHtml(p.note)}
          </div>
        </td>
      </tr>`
        })
        .join('')}
    </table>
    <div style="font-size:10.5px;color:${FAINT};line-height:1.6;margin-top:9px">
      Graded against this league's settings — ${escapeHtml(leagueNote)} — not a default scoring system.
    </div>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
      : ''

  /*
   * ⚠ THE HONEST SPLIT. Waiver-fixable gaps and genuinely-missed positions are
   * rendered as two different claims, with different headings, because calling
   * the first one a drafting error would be false — nothing addressing it was
   * there to take.
   */
  const fixable = gaps.filter((g) => g.fixable)
  const structural = gaps.filter((g) => !g.fixable)

  const gapsBlock =
    gaps.length > 0
      ? `
<tr>
  <td style="padding:14px 16px;border:1px solid ${BORDER};border-radius:14px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:7px">
      What's still missing
    </div>
    ${
      fixable.length > 0
        ? `<div style="font-size:12px;color:${TEXT};font-weight:700;margin-bottom:3px">Waiver problems, not draft mistakes</div>
    ${fixable
      .map(
        (g) =>
          `<div style="font-size:11.5px;color:${MUTED};line-height:1.6;margin-bottom:3px"><span style="color:${TEXT};font-weight:600">${escapeHtml(g.position)}</span> — ${escapeHtml(g.note)}</div>`,
      )
      .join('')}`
        : ''
    }
    ${
      structural.length > 0
        ? `<div style="font-size:12px;color:${TEXT};font-weight:700;margin:9px 0 3px">Harder to fix from here</div>
    ${structural
      .map(
        (g) =>
          `<div style="font-size:11.5px;color:${MUTED};line-height:1.6;margin-bottom:3px"><span style="color:${TEXT};font-weight:600">${escapeHtml(g.position)}</span> — ${escapeHtml(g.note)}</div>`,
      )
      .join('')}`
        : ''
    }
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
      : ''

  const inner = [
    header('Draft complete', leagueName, `Your draft, graded.`, leagueNote),
    gradeBlock,
    picksBlock,
    gapsBlock,
    cta(boardUrl, 'See the full board', 'Every pick in the draft, and what each one cost.'),
  ].join('')

  return {
    subject,
    html: shell(
      inner,
      footer({
        baseUrl,
        leagueName,
        leagueId: params.leagueId,
        unsubscribeUrl: params.unsubscribeUrl ?? null,
      }),
    ),
  }
}
