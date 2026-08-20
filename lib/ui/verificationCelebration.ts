import confetti from "canvas-confetti"

const BRAND_COLORS = ["#06b6d4", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"]

function shouldReduceMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function detectMobile(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth <= 768
}

export async function playVerificationCelebration(durationMs = 1800): Promise<void> {
  if (typeof window === "undefined") return
  if (shouldReduceMotion()) return

  const isMobile = detectMobile()
  const particleCount = isMobile ? 40 : 70

  confetti({
    particleCount,
    spread: isMobile ? 52 : 64,
    startVelocity: isMobile ? 32 : 38,
    gravity: 1.08,
    ticks: isMobile ? 120 : 150,
    scalar: isMobile ? 0.82 : 0.95,
    origin: { x: 0.5, y: 0.68 },
    colors: BRAND_COLORS,
    zIndex: 1300,
    disableForReducedMotion: true,
  })

  window.setTimeout(() => {
    confetti({
      particleCount: isMobile ? 24 : 40,
      spread: isMobile ? 46 : 58,
      startVelocity: isMobile ? 28 : 34,
      gravity: 1.1,
      ticks: isMobile ? 110 : 140,
      scalar: isMobile ? 0.78 : 0.9,
      origin: { x: 0.5, y: 0.62 },
      colors: BRAND_COLORS,
      zIndex: 1300,
      disableForReducedMotion: true,
    })
  }, 240)

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
