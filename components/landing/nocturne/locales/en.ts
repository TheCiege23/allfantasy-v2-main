import { NOCTURNE_COPY } from '../copy'

/**
 * Canonical English copy for the Nocturne landing page.
 *
 * This compatibility import keeps the existing landing stable while the copy
 * source is migrated into locale-specific modules. New locale consumers should
 * import through `./index` instead of importing `../copy` directly.
 */
export const EN_NOCTURNE_COPY = NOCTURNE_COPY

export default EN_NOCTURNE_COPY
