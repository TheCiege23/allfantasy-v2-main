/**
 * AUTO DRAFT: nobody picks by hand.
 *
 * An auto draft is the commissioner's instruction that the computer drafts every seat
 * (`autoDraftFill.ts`). The fill runs in bursts from the minute draft tick, so between bursts
 * someone is on the clock with nothing picking for them — and the room's Draft button still worked,
 * because the only mode the pick path knew was `offline`. Found on production 2026-11-25, on a
 * 54-team startup where no manager was meant to pick at all.
 *
 * So a pick that arrives from the room (`draft/pick/route.ts`) is refused in an auto draft unless it
 * is the commissioner's override, the one tool that corrects a board. The fill itself never comes
 * through that route: it calls `submitPick` on the server.
 */
export function refusesHandPickInAutoDraft(executionMode: string | null | undefined, source: string | null | undefined): boolean {
  return executionMode === 'auto' && source !== 'commissioner'
}

export const AUTO_DRAFT_HAND_PICK_ERROR = 'This is an auto draft: every pick is made automatically.'
