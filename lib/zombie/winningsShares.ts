/**
 * The share of a loser's week that moves to the winner on a bashing or a mauling (an infection takes the
 * whole week). Its own module, with no imports, because the rules-document generator states these and
 * must not pull the settlement engine's import graph in with them.
 */
export const BASH_TRANSFER_SHARE = 0.25
export const MAUL_TRANSFER_SHARE = 0.5
