/** Plain module (not 'use client') so the server page can read the list as a value. */
export const ZOMBIE_HARNESS_SCREENS = ['home', 'standings', 'matchups', 'items', 'chat', 'rules', 'settings'] as const
export type ZombieHarnessScreen = (typeof ZOMBIE_HARNESS_SCREENS)[number]
