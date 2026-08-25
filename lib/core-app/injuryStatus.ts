/**
 * Is this player declared ABSENT, as opposed to merely doubtful?
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT. "Questionable" and "doubtful" mean
 * uncertainty; treating them as absence would zero a projection and tell a
 * manager to bench someone who is probably playing. Only a declaration of
 * absence produces a zero.
 *
 * Extracted from lib/core-app/myTeam.ts so the roster-need model and the
 * projection column cannot disagree about who is available. A team whose kicker
 * is on IR has an empty kicker slot, and a need model that counts bodies rather
 * than available bodies cannot see it.
 */
const RULED_OUT = ['out', ' ir', 'ir ', 'injured reserve', 'suspend', 'pup', 'nfi', 'did not play']

export function isRuledOut(status: string | null | undefined): boolean {
  if (!status) return false
  const t = ` ${status.trim().toLowerCase()} `
  if (t.trim() === 'ir') return true
  return RULED_OUT.some((needle) => t.includes(needle))
}
