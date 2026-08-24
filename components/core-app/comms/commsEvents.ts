/**
 * Event names for opening the communications drawer (23a/23b) and the support
 * modal (25b) from anywhere.
 *
 * ⚠ THEY LIVE IN THEIR OWN MODULE BECAUSE THE CALLERS ARE SERVER COMPONENTS.
 * `CommsDock` is `'use client'`, and `Dashboard34` — the /core home — is not.
 * A server component importing a value from a client module drags the whole
 * client bundle in behind it, which is how a launcher ends up shipping a chat
 * panel to a page that never opens one. Plain string constants in a plain
 * module cost nothing and can be imported from either side.
 *
 * Same reasoning as `lib/core-app/weekBoardRules.ts`: anything both sides need
 * is a plain value in a plain file.
 */

/**
 * Opens the drawer. `detail.tab` optionally selects which of the four tabs
 * ('league' | 'chimmy' | 'huddle' | 'dms') it lands on.
 */
export const COMMS_OPEN_EVENT = 'af-comms-open'

/** Opens the support modal. */
export const SUPPORT_OPEN_EVENT = 'af-support-open'
