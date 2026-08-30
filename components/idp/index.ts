/**
 * Barrel for the components that still live in this directory.
 *
 * ⚠ IDPPlayerModal, IDPMatchupView and settings/IDPAIPanel were re-exported from here and are
 * NOT listed any more: they were duplicates of components in `app/idp/components/`, and the
 * copies in this directory were deleted when that fork was resolved. Their re-export lines
 * outlived them by two commits.
 *
 * 🛑 A `export { X } from './Y'` IS A CONSUMER OF './Y' THAT AN IMPORTER CENSUS DOES NOT SEE.
 * The deletions were checked for importers, for relative imports, for dynamic imports and even
 * for stale data-testids — and still missed this, because a re-export is none of those. It is
 * the "re-export facade" form CLAUDE.md's four-forms rule names, arriving from the side the rule
 * does not phrase: not a module reaching this one, but this one reaching a module that is gone.
 * Nothing imports this barrel, so nothing broke at runtime; it was three TS2307s and no symptom.
 * `idpComponentForkGuard` now asserts every target here resolves.
 */
export { default as IDPHome } from './IDPHome'
export { IDPSettingsPanel } from './IDPSettingsPanel'
export type { IdpConfigState } from './IDPSettingsPanel'
export { IDPWaiverSection } from './IDPWaiverSection'
export { IDPFirstEntryModal } from './IDPFirstEntryModal'
