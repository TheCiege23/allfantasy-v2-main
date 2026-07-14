/** Identity Service validation errors — see Part 1 "Important Rules" in the phase brief. */

export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityValidationError'
  }
}

/** Thrown when a link attempt would associate one provider identity with two different FantasyUsers. */
export class DuplicateIdentityLinkError extends IdentityValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateIdentityLinkError'
  }
}

/** Thrown when a link attempt supplies no verified provider identifier — no fuzzy matching is allowed. */
export class UnverifiedIdentityLinkError extends IdentityValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'UnverifiedIdentityLinkError'
  }
}
