/**
 * Commissioner OS Platform Contracts — the single source of truth for
 * cross-module communication shapes. Every shared-infrastructure consumer
 * (providers, the event bus, the future Decision OS client, future
 * platform services) imports types from here rather than reaching into
 * another module's implementation files directly.
 *
 * Versioning: CONTRACT_VERSION bumps on any breaking change to an exported
 * shape. Additive changes (a new optional field, a new union member) do
 * not require a bump; anything that could break an existing consumer does.
 */
export const CONTRACT_VERSION = '1.2.0'

export * from './navigation'
export * from './featureFlags'
export * from './events'
export * from './services'
export * from './errors'
export * from './response'
export * from './metadata'
export * from './notifications'
export * from './searchResults'
export * from './activity'
export * from './moduleRegistration'
export * from './recommendations'
export * from './relatedLink'
export * from './help'
