/**
 * Password strength for signup UI: level 0–4 and label.
 */
type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4

interface PasswordStrength {
  level: PasswordStrengthLevel
  label: string
  valid: boolean
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { level: 0, label: "Enter a password", valid: false }
  }
  const hasLetter = /[A-Za-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSpecial = /[^A-Za-z0-9]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const len = password.length

  if (len < 8 || !hasLetter || !hasNumber) {
    return { level: 1, label: "Use 8+ characters with a letter and number", valid: false }
  }

  let level: PasswordStrengthLevel = 2
  let label = "Fair"

  if (len >= 10 && (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) >= 2) level = 3
  if (level === 3) label = "Good"
  if (hasSpecial && len >= 10) {
    level = 4
    label = "Strong"
  }
  if (level === 2 && len >= 8 && hasLetter && hasNumber) label = "OK"

  return {
    level,
    label,
    valid: true,
  }
}
