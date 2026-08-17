/**
 * Whether AllFantasy is running an invite-only closed beta. ONE switch, both sides.
 *
 * Deliberately has NO `server-only` import and no dependencies, so the client can read the
 * same value the server enforces. `betaAdmissionService` is server-only, and the signup
 * page is a client component — without a shared module the page had to assume the gate's
 * state, and it assumed wrong.
 *
 * That assumption was a live bug: `/signup` rendered its closed-beta refusal purely from
 * the `?betaError=` query parameter, with no check that a beta was running. Once signup
 * reopened the server could no longer produce those codes, but any URL still carrying one
 * — a stale tab, a bookmark, the back button, a shared link — kept rendering
 * "AllFantasy is in a closed beta" as a red alert on a signup form that worked fine.
 * A URL parameter is a claim from the client, never authority about server policy.
 *
 * To run another closed beta, flip this to `true`: the gate, the admission machinery, and
 * the signup page's beta messaging all come back together.
 */
export const CLOSED_BETA_ENABLED = false
