export class KnowledgeGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeGraphError'
  }
}

/** Thrown only by callers that opt into strict mode; the default Query Service API returns a typed "gated" result instead of throwing — see QueryService.ts. */
export class PrivacyGateDeniedError extends KnowledgeGraphError {
  constructor(message: string) {
    super(message)
    this.name = 'PrivacyGateDeniedError'
  }
}
