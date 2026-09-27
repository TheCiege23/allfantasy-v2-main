import { describe, expect, it } from "vitest"
import { normalizeProviderError, isProviderFallbackEligible } from "@/lib/ai/providerErrors"
import { AiSpendDisabledError } from "@/lib/ai/aiSpendGuard"

function makeError(message: string, status?: number): Error {
  return Object.assign(new Error(message), status != null ? { status } : {})
}

describe("normalizeProviderError — billing", () => {
  it("classifies HTTP 402 as billing", () => {
    const err = makeError("Payment required", 402)
    expect(normalizeProviderError(err).category).toBe("billing")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies Anthropic credit balance error (HTTP 400) as billing", () => {
    const err = makeError(
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      400
    )
    expect(normalizeProviderError(err).category).toBe("billing")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies OpenAI insufficient_quota error as billing", () => {
    const err = Object.assign(new Error("You exceeded your current quota"), {
      code: "insufficient_quota",
      status: 429,
    })
    // insufficient_quota code → billing or rate_limit, both fallback eligible
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — rate_limit", () => {
  it("classifies HTTP 429 as rate_limit", () => {
    const err = makeError("Too many requests", 429)
    expect(normalizeProviderError(err).category).toBe("rate_limit")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies rate limit message as rate_limit", () => {
    const err = makeError("Rate limit exceeded for this endpoint")
    expect(normalizeProviderError(err).category).toBe("rate_limit")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — overload", () => {
  it("classifies HTTP 529 as overload", () => {
    const err = makeError("Service overloaded", 529)
    expect(normalizeProviderError(err).category).toBe("overload")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies 'overloaded' message as overload", () => {
    const err = makeError("AI temporarily overloaded. Try again in a moment.")
    expect(normalizeProviderError(err).category).toBe("overload")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — auth", () => {
  it("classifies HTTP 401 as auth (fallback eligible)", () => {
    const err = makeError("Invalid API key", 401)
    expect(normalizeProviderError(err).category).toBe("auth")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — unavailable", () => {
  it("classifies HTTP 503 as unavailable", () => {
    const err = makeError("Service unavailable", 503)
    expect(normalizeProviderError(err).category).toBe("unavailable")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies missing API key message as unavailable", () => {
    const err = makeError("OpenAI provider unavailable. Set OPENAI_API_KEY.")
    expect(normalizeProviderError(err).category).toBe("unavailable")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies provider not configured as unavailable", () => {
    const err = makeError("Anthropic API key not configured.")
    expect(normalizeProviderError(err).category).toBe("unavailable")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — timeout", () => {
  it("classifies timeout message as timeout", () => {
    const err = makeError("Request timed out after 15000ms")
    expect(normalizeProviderError(err).category).toBe("timeout")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies network TypeError as timeout", () => {
    const err = new TypeError("Failed to fetch")
    expect(normalizeProviderError(err).category).toBe("timeout")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies ECONNRESET as timeout", () => {
    const err = makeError("ECONNRESET: connection reset by peer")
    expect(normalizeProviderError(err).category).toBe("timeout")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — server_error", () => {
  it("classifies HTTP 500 as server_error", () => {
    const err = makeError("Internal server error", 500)
    expect(normalizeProviderError(err).category).toBe("server_error")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })

  it("classifies HTTP 502 as server_error", () => {
    const err = makeError("Bad gateway", 502)
    expect(normalizeProviderError(err).category).toBe("server_error")
    expect(normalizeProviderError(err).fallbackEligible).toBe(true)
  })
})

describe("normalizeProviderError — content_filter (NOT fallback eligible)", () => {
  it("classifies content filter HTTP 400 as NOT fallback eligible", () => {
    const err = makeError("Your request was rejected as a result of a content filter.", 400)
    expect(normalizeProviderError(err).category).toBe("content_filter")
    expect(normalizeProviderError(err).fallbackEligible).toBe(false)
  })

  it("classifies policy violation as NOT fallback eligible", () => {
    const err = makeError("This request violates our usage policy.", 400)
    expect(normalizeProviderError(err).category).toBe("content_filter")
    expect(normalizeProviderError(err).fallbackEligible).toBe(false)
  })

  it("classifies content_filter error code as NOT fallback eligible", () => {
    const err = Object.assign(new Error("Content rejected"), { code: "content_filter", status: 400 })
    expect(normalizeProviderError(err).category).toBe("content_filter")
    expect(normalizeProviderError(err).fallbackEligible).toBe(false)
  })
})

describe("normalizeProviderError — spend_disabled (NOT fallback eligible)", () => {
  // The kill switch is global: every provider is off, so falling through could only reach one whose
  // own guard was missing. The refusal carries no HTTP status, so without its own rule it lands in
  // `unknown` — which IS fallback eligible.
  it("classifies AiSpendDisabledError as spend_disabled and halts", () => {
    const norm = normalizeProviderError(new AiSpendDisabledError("openai-client"))
    expect(norm.category).toBe("spend_disabled")
    expect(norm.fallbackEligible).toBe(false)
    expect(isProviderFallbackEligible(new AiSpendDisabledError("xai-client"))).toBe(false)
  })

  it("recognises the refusal by its stable code, not only by class", () => {
    // A copy across a module boundary (or a serialised error) loses the prototype but keeps the code.
    const err = Object.assign(new Error("AI provider spend is disabled"), { code: "ai_spend_disabled" })
    expect(normalizeProviderError(err).category).toBe("spend_disabled")
  })

  it("a 402 from a PROVIDER is still billing, and still falls back", () => {
    // Guards against over-reach: the spend refusal also carries 402 (as httpStatus), but a provider's
    // own payment-required response is a different fact — another provider may have credit.
    expect(normalizeProviderError(makeError("Payment required", 402)).category).toBe("billing")
  })
})

describe("isProviderFallbackEligible — convenience wrapper", () => {
  it("returns true for rate limit errors", () => {
    expect(isProviderFallbackEligible(makeError("rate limit", 429))).toBe(true)
  })

  it("returns true for billing errors", () => {
    expect(isProviderFallbackEligible(makeError("credit balance too low", 400))).toBe(true)
  })

  it("returns false for content filter errors", () => {
    expect(isProviderFallbackEligible(makeError("content filter triggered", 400))).toBe(false)
  })

  it("returns true for network errors", () => {
    expect(isProviderFallbackEligible(new TypeError("Failed to fetch"))).toBe(true)
  })
})
