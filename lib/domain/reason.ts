/**
 * Commissioner OS · reason validation. T-004.
 *
 * `HANDOFF.md` defines a valid reason so it is not left to judgement:
 * ">= 12 characters, not equal to the action name, not in a stoplist
 * (`test`, `fix`, `asdf`, `n/a`)."
 *
 * ⚠ A FINDING ABOUT THAT SPEC, RECORDED RATHER THAN PAPERED OVER.
 * Every literal stoplist entry is shorter than 12 characters, so if the length
 * rule is checked first the stoplist can never fire — it would be dead code
 * that reads as a control. `test` fails as TOO_SHORT and nobody ever learns the
 * stoplist exists.
 *
 * Two consequences, both deliberate:
 *
 * 1. The stoplist is checked BEFORE length, so a placeholder gets the message
 *    that names the actual problem ("that reason is a placeholder") rather than
 *    one that invites padding to twelve characters.
 * 2. The stoplist matches a reason made ENTIRELY of stoplist tokens, not just
 *    an exact single-word equality. Otherwise `test test test` (14 chars)
 *    passes every rule while being precisely what the stoplist is for.
 *
 * Neither widens the spec's intent; both are needed for it to have any effect.
 */

import { type Result, err, ok } from './result'
import { type ReasonRequiredError, reasonRequired } from './errors'

export const REASON_MIN_LENGTH = 12

/** Lowercase. Matched against normalised tokens, never raw input. */
export const REASON_STOPLIST: readonly string[] = ['test', 'fix', 'asdf', 'n/a', 'na', 'none', '-']

/**
 * Collapse whitespace, drop surrounding punctuation, lowercase.
 *
 * Length is measured on the TRIMMED text, not the raw string — twelve spaces is
 * not a reason, and a rule that counts them is a rule that can be satisfied by
 * holding down the space bar.
 */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** `league.rollbackWeek` → `league rollbackweek`, so echo detection sees past the dots. */
function actionAsProse(action: string): string {
  return normalise(action.replace(/[._-]+/g, ' '))
}

function isAllStoplistTokens(normalised: string): boolean {
  const tokens = normalised.split(' ').map((t) => t.replace(/[.,!?;:]+$/g, '')).filter(Boolean)
  if (tokens.length === 0) return false
  return tokens.every((t) => REASON_STOPLIST.includes(t))
}

/**
 * Validate a reason for an action that requires one.
 *
 * Returns the NORMALISED-whitespace reason (original casing preserved) on
 * success, so the caller stores one canonical form rather than whatever
 * trailing newline the textarea produced.
 */
export function validateReason(
  action: string,
  reason: string | undefined | null,
): Result<string, ReasonRequiredError> {
  if (reason === undefined || reason === null || reason.trim() === '') {
    return err(reasonRequired(action, 'MISSING', REASON_MIN_LENGTH))
  }

  const normalised = normalise(reason)

  // Before length — see the note at the top of this file.
  if (isAllStoplistTokens(normalised)) {
    return err(reasonRequired(action, 'STOPLISTED', REASON_MIN_LENGTH))
  }

  // Before length too. "update settings" is 15 characters and says nothing that
  // the action name did not already say; reporting TOO_SHORT would be wrong and
  // would send someone padding it rather than writing one.
  if (normalised === actionAsProse(action) || normalised === normalise(action)) {
    return err(reasonRequired(action, 'ECHOES_ACTION', REASON_MIN_LENGTH))
  }

  if (normalised.length < REASON_MIN_LENGTH) {
    return err(reasonRequired(action, 'TOO_SHORT', REASON_MIN_LENGTH))
  }

  return ok(reason.trim().replace(/\s+/g, ' '))
}
