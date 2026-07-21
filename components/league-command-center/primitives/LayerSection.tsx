import type { ReactNode } from 'react'
import type { CommandCenterRole } from '@/lib/league-command-center/types'
import { hasCommissionerAuthority } from '@/lib/league-command-center/types'

/**
 * The three-layer section contract — the locked architectural rule, enforced.
 *
 * > A commissioner is still an active fantasy manager. Commissioner mode must
 * > never replace, hide, or reduce the personal manager experience.
 *
 * The rule is easy to state and easy to violate six months later, so it is
 * encoded in the type signature rather than left to review:
 *
 *  - `personal` and `shared` are **required** props. There is no way to
 *    express a commissioner-only section — `<LayerSection commissionerOps={…} />`
 *    does not typecheck.
 *  - `commissionerOps` is the **only** optional slot, and it renders LAST,
 *    below the other two. It can add to the page; it can never take the place
 *    of anything.
 *
 * This is what replaces the forbidden pattern:
 *
 * ```tsx
 * // Never this:
 * isCommissioner ? <CommissionerOnlyPage /> : <ManagerPage />
 *
 * // Always this:
 * <LayerSection
 *   role={role}
 *   personal={<MyTeamSnapshot />}
 *   shared={<LeagueStandings />}
 *   commissionerOps={<OpsQueue />}
 * />
 * ```
 *
 * A commissioner viewing this gets their own team snapshot AND the league view
 * AND the ops queue — three layers, additive, in that order.
 */
export interface LayerSectionProps {
  role: CommandCenterRole

  /**
   * Layer 1 — Personal Team Experience.
   * The commissioner gets the exact same personal tools a regular manager gets
   * for their own team. Required, and rendered first, for every role.
   */
  personal: ReactNode

  /**
   * Layer 2 — Shared League Experience.
   * Official league data visible to every authorized member. Required.
   */
  shared: ReactNode

  /**
   * Layer 3 — Commissioner Operations.
   * Additive league-wide oversight. Rendered only for commissioner and
   * co-commissioner, always last, always visually distinguished by the
   * operational gold accent (never the personal-content purple).
   */
  commissionerOps?: ReactNode

  labels?: {
    personal?: string
    shared?: string
    commissioner?: string
  }

  /** Set false to render layers without their heading chrome (compact sections). */
  showLabels?: boolean
}

const DEFAULT_LABELS = {
  personal: 'Your team',
  shared: 'League',
  commissioner: 'Commissioner operations',
} as const

function isEmptySlot(node: ReactNode): boolean {
  return node === null || node === undefined || node === false || node === ''
}

function LayerHeading({ variant, label }: { variant: string; label: string }) {
  return (
    <div className="af-cc-layer__head">
      <span className="af-cc-layer__label">{label}</span>
      <span className="af-cc-layer__rule" aria-hidden="true" />
      {variant === 'commissioner' ? (
        <span className="af-cc-badge af-cc-badge--ops">
          <i className="ph ph-crown-simple" aria-hidden="true" />
          Commissioner
        </span>
      ) : null}
    </div>
  )
}

export function LayerSection({
  role,
  personal,
  shared,
  commissionerOps,
  labels,
  showLabels = true,
}: LayerSectionProps) {
  const resolved = { ...DEFAULT_LABELS, ...labels }
  const canSeeOps = hasCommissionerAuthority(role)

  // Runtime guard for the one violation the type system cannot catch: passing
  // an explicit `null` into a required slot. Loud in development, silent in
  // production — a stale render is preferable to a thrown page, but this must
  // never ship unnoticed.
  if (process.env.NODE_ENV !== 'production' && isEmptySlot(personal)) {
    console.error(
      '[LayerSection] The `personal` layer is empty. Every section must render the ' +
        'personal manager experience for every role, including commissioners. ' +
        'If there is genuinely nothing personal to show, render an explicit empty ' +
        'state — not `null`.',
    )
  }

  return (
    <div className="af-cc-stack">
      <section className="af-cc-layer af-cc-layer--personal" aria-label={resolved.personal}>
        {showLabels ? <LayerHeading variant="personal" label={resolved.personal} /> : null}
        {personal}
      </section>

      <section className="af-cc-layer af-cc-layer--shared" aria-label={resolved.shared}>
        {showLabels ? <LayerHeading variant="shared" label={resolved.shared} /> : null}
        {shared}
      </section>

      {canSeeOps && !isEmptySlot(commissionerOps) ? (
        <section
          className="af-cc-layer af-cc-layer--commissioner"
          aria-label={resolved.commissioner}
        >
          {showLabels ? <LayerHeading variant="commissioner" label={resolved.commissioner} /> : null}
          {commissionerOps}
        </section>
      ) : null}
    </div>
  )
}

export default LayerSection
