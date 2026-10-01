/**
 * Mask phone numbers inside free text.
 *
 * ⚠ TWILIO'S ERROR MESSAGES QUOTE THE FULL NUMBER ("The 'To' number +12015550123 is not a valid
 * phone number"), and those messages were logged and stored as-is by the send and verify
 * routes. Keeps the last two digits so a log line can still be matched to a support ticket.
 *
 * Pure; safe anywhere.
 */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '')
    return digits.length >= 8 ? `***${digits.slice(-2)}` : m
  })
}

/** A single phone number, masked the same way — for audit rows keyed by a number. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 4 ? `***${digits.slice(-2)}` : '***'
}
