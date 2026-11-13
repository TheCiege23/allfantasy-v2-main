interface SignInValidationInput {
  login: string
  password: string
}

export function validateSignInInput(input: SignInValidationInput): {
  ok: boolean
  error?: string
} {
  if (!input.login.trim()) {
    return {
      ok: false,
      error: 'Please enter your email, username, or phone.',
    }
  }
  if (!input.password.trim()) {
    return {
      ok: false,
      error: 'Please enter your password.',
    }
  }
  return { ok: true }
}
