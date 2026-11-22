/**
 * The Survivor harness screens. A plain module, not the client component's: a VALUE exported from a
 * 'use client' file reaches a server component as a client reference, not as this array.
 */
export const SURVIVOR_HARNESS_SCREENS = [
  'home', 'tribe', 'tribal', 'challenges', 'exile', 'jury', 'merge', 'finale', 'episodes', 'intel', 'story', 'rules', 'swap',
] as const
export type SurvivorHarnessScreen = (typeof SURVIVOR_HARNESS_SCREENS)[number]
