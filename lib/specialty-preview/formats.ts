/**
 * Static preview data for specialty formats that have ART but NO GAME ENGINE.
 *
 * ✅ PIRATE GRADUATED AND IS NO LONGER HERE (2026-11-15). The audit below was true when written;
 * then #2852 (merged 2026-11-03) shipped a native Pirate engine for NFL, NBA, MLB and NHL, and it
 * is in the create-league wizard (`pirateProtectionLimit`, `pirateClaimHours`, `piratePlayoffClaims`
 * in lib/league-creation-wizard/wizard-format-options.ts), the catalog seed and the format demos.
 * Its page stayed "Coming soon — Native Pirate leagues are not live yet" for twelve days after it
 * went live. /formats/pirate now 308s to /league-types/pirate (next.config.js), whose rules come
 * from the demo registry. If King of the Hill ships, retire it the same way: remove it here,
 * redirect its /formats path, and point every link at its lander.
 *
 * 🛑 KING OF THE HILL AND PIRATE HAD NO NATIVE ENGINE (audited 2026-10-18). What existed:
 *   - trade pricing (`lib/trade-intel/kingOfTheHill.ts`, `lib/trade-intel/pirate.ts`,
 *     `lib/trade-value/formats/*`) for leagues IMPORTED from Sleeper,
 *   - a steal detector (`lib/trade-intel/pirateSteal.ts`) that labels commissioner-executed steals,
 *   - specialty-automation handlers that only RECORD checkpoints (no crown, no plunder, no state),
 *   - a concept id / alias tag. No Prisma model, no route, no create-a-league option.
 *
 * And the two rule sets that DO exist disagree: the design handoff's "proposed" King of the Hill
 * (weekly challenger vs King, most weeks wearing the crown wins) is not the house rule priced in
 * `kingOfTheHill.ts` (+10 a week, a dethroned King forfeits that week's top three scorers). So this
 * module states ONLY what both sides agree on, and nothing that would read as a settled rule.
 * (The fuller Pirate package of 2026-10 — parley, bounty, plank, Pirate King — is also marked
 * "proposed" and adds rules the repo does not have; the user kept Pirate "coming soon", so only its
 * ART was taken.) Do not
 * add a numbered rules list here until the user picks a rule set and an engine exists.
 */

type SpecialtyPreviewSlug = 'king-of-the-hill'

type SpecialtyPreviewPoint = {
  /** Public path of a 64px status icon, when the art set has one that fits. */
  icon?: string
  label: string
  body: string
}

export type SpecialtyPreviewFormat = {
  slug: SpecialtyPreviewSlug
  /** Concept id used elsewhere in the repo (`conceptCatalog.ts`). */
  conceptId: 'king_of_the_hill' | 'pirate_vampire'
  /** Key into the shared shell's SPECIALTY_THEMES (components/league/specialty/theme.ts). */
  shellFormat: 'koth' | 'pirate'
  name: string
  art: { banner: string; emblem: string }
  tagline: string
  points: SpecialtyPreviewPoint[]
  /** What AllFantasy genuinely does for this format today, so the page never overstates. */
  today: string
}

export const SPECIALTY_PREVIEW_FORMATS: Record<SpecialtyPreviewSlug, SpecialtyPreviewFormat> = {
  'king-of-the-hill': {
    slug: 'king-of-the-hill',
    conceptId: 'king_of_the_hill',
    shellFormat: 'koth',
    name: 'King of the Hill',
    art: { banner: '/specialty/koth/banner.svg', emblem: '/specialty/koth/emblem.svg' },
    tagline: 'One manager wears the crown. Everyone else is playing to take it.',
    points: [
      { icon: '/specialty/koth/icon-crown.svg', label: 'The crown', body: 'One manager holds it at a time, and the whole league measures its week against theirs.' },
      { icon: '/specialty/koth/icon-challenge.svg', label: 'The chase', body: 'Everyone who is not wearing it is playing to take it.' },
      { icon: '/specialty/koth/icon-defend.svg', label: 'The defense', body: 'The holder keeps it only as long as they keep winning.' },
    ],
    today:
      'Native King of the Hill leagues are not live yet. If you play it on Sleeper and import the league, AllFantasy already prices trades with the crown in mind.',
  },
}

export function getSpecialtyPreview(slug: string | null | undefined): SpecialtyPreviewFormat | null {
  if (slug === 'king-of-the-hill') return SPECIALTY_PREVIEW_FORMATS[slug]
  return null
}
