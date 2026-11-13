interface AgreementAcceptanceInput {
  disclaimerAgreed: boolean
  termsAgreed: boolean
}

export function validateAgreementAcceptance(input: AgreementAcceptanceInput): {
  ok: boolean
  error?: string
} {
  if (!input.disclaimerAgreed) {
    return {
      ok: false,
      error: "You must agree to the fantasy sports disclaimer (no gambling/DFS).",
    }
  }
  if (!input.termsAgreed) {
    return {
      ok: false,
      error: "You must agree to the Terms and Conditions.",
    }
  }
  return { ok: true }
}
