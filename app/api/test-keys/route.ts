import { NextRequest, NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/provider-config";
import { runClearSportsHealthCheck } from "@/lib/clear-sports/client";
import { getTwilioRuntimeStatus, verifyTwilioAuth } from "@/lib/twilio-client";
import { requireAdminOrBearer } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceResult = {
  configured: boolean;
  ok: boolean;
  message: string;
  details?: Record<string, unknown> | null;
};

function maskKey(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

async function testOpenAI(): Promise<ServiceResult> {
  const status = getProviderStatus();
  if (!status.openai) {
    return {
      configured: false,
      ok: false,
      message: "OpenAI key not configured.",
      details: null,
    };
  }

  return {
    configured: true,
    ok: true,
    message: "OpenAI key is configured.",
    details: null,
  };
}

async function testDeepSeek(): Promise<ServiceResult> {
  const status = getProviderStatus();
  if (!status.deepseek) {
    return {
      configured: false,
      ok: false,
      message: "DeepSeek key not configured.",
      details: null,
    };
  }
  return {
    configured: true,
    ok: true,
    message: "DeepSeek key is configured.",
    details: null,
  };
}

async function testXai(): Promise<ServiceResult> {
  const status = getProviderStatus();
  if (!status.xai) {
    return {
      configured: false,
      ok: false,
      message: "xAI key not configured.",
      details: null,
    };
  }
  return {
    configured: true,
    ok: true,
    message: "xAI key is configured.",
    details: null,
  };
}

async function testClearSports(): Promise<ServiceResult> {
  const health = await runClearSportsHealthCheck();
  if (!health.configured) {
    return {
      configured: false,
      ok: false,
      message: "ClearSports credentials not configured (requires key + base URL).",
      details: null,
    };
  }
  if (!health.available) {
    return {
      configured: true,
      ok: false,
      message: "ClearSports is configured but not reachable.",
      details: {
        latencyMs: health.latencyMs ?? null,
        error: health.error ?? null,
      },
    };
  }
  return {
    configured: true,
    ok: true,
    message: "ClearSports credentials are configured and provider is reachable.",
    details: {
      latencyMs: health.latencyMs ?? null,
    },
  };
}

async function testStripe(): Promise<ServiceResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";

  if (!secretKey.trim()) {
    return {
      configured: false,
      ok: false,
      message: "Stripe secret key not configured.",
      details: null,
    };
  }

  return {
    configured: true,
    ok: true,
    message: "Stripe key is configured.",
    details: {
      keyPreview: maskKey(secretKey),
    },
  };
}

async function testSupabase(): Promise<ServiceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!url.trim() || !anonKey.trim()) {
    return {
      configured: false,
      ok: false,
      message: "Supabase env vars are incomplete.",
      details: {
        hasUrl: !!url.trim(),
        hasAnonKey: !!anonKey.trim(),
      },
    };
  }

  return {
    configured: true,
    ok: true,
    message: "Supabase env vars are configured.",
    details: {
      url,
      anonKeyPreview: maskKey(anonKey),
    },
  };
}

async function testResend(): Promise<ServiceResult> {
  const hasWebhookSecret = !!(process.env.RESEND_WEBHOOK_SECRET?.trim());
  try {
    const { getResendClient } = await import("@/lib/resend-client");
    const { client, fromEmail } = await getResendClient();

    const response = await client.domains.list();

    return {
      configured: true,
      ok: true,
      message: "Resend is configured and reachable.",
      details: {
        fromEmail,
        hasResendWebhookSecret: hasWebhookSecret,
        domainsCount:
          Array.isArray((response as any)?.data?.data)
            ? (response as any).data.data.length
            : Array.isArray((response as any)?.data)
              ? (response as any).data.length
              : null,
      },
    };
  } catch (error: unknown) {
    const envKey = process.env.RESEND_API_KEY || "";

    return {
      configured: !!envKey.trim(),
      ok: false,
      message: error instanceof Error ? error.message : "Resend test failed.",
      details: {
        keyPreview: maskKey(envKey),
        hasResendWebhookSecret: hasWebhookSecret,
      },
    };
  }
}

async function testTwilio(): Promise<ServiceResult> {
  const status = getTwilioRuntimeStatus();
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const configured = status.canUseAuthTokenMode || status.canUseApiKeyMode;

  // A live probe, not a construction check. This endpoint previously reported ok:true whenever the
  // client could be *built* — but an unauthorized API key builds fine and only fails on the first
  // real request, so genuinely broken SMS (phone signup, SMS password reset) read as healthy here.
  const probe = configured ? await verifyTwilioAuth() : null;
  const clientInitialized = probe ? probe.reason !== "client_init_failed" : false;

  const message = !configured
    ? status.hasAccountSid && !status.accountSidWellFormed
      ? `TWILIO_ACCOUNT_SID is set but is not an Account SID (starts with "${sid.slice(0, 2)}", expected "AC").`
      : "Twilio env vars are incomplete."
    : probe?.ok
      ? `Twilio verified against the live API (${probe.mode} mode).`
      : probe?.reason === "client_init_failed"
        ? `Twilio client init failed: ${probe.error?.message}`
        : `Twilio env vars are set but the credentials were REJECTED by the live API (${probe?.mode} mode): ${probe?.error?.message}`;

  return {
    configured,
    ok: Boolean(probe?.ok),
    message,
    details: {
      accountSidPreview: maskKey(sid),
      mode: probe?.mode ?? "none",
      liveAuthOk: probe?.ok ?? false,
      ...(probe?.reason ? { failureReason: probe.reason } : {}),
      ...(probe?.error ? { authError: probe.error } : {}),
      hasAccountSid: status.hasAccountSid,
      hasAuthToken: status.hasAuthToken,
      hasApiKey: status.hasApiKey,
      hasApiSecret: status.hasApiSecret,
      hasFromNumber: status.hasFromNumber,
      hasVerifyServiceSid: status.hasVerifyServiceSid,
      accountSidWellFormed: status.accountSidWellFormed,
      apiKeyWellFormed: status.apiKeyWellFormed,
      verifyServiceSidWellFormed: status.verifyServiceSidWellFormed,
      canUseAuthTokenMode: status.canUseAuthTokenMode,
      canUseApiKeyMode: status.canUseApiKeyMode,
      canUseRawSms: status.canUseRawSms,
      canUseVerify: status.canUseVerify,
      clientInitialized,
    },
  };
}

async function testCoinbase(): Promise<ServiceResult> {
  const key =
    process.env.COINBASE_COMMERCE_API_KEY ||
    process.env.COINBASE_API_KEY ||
    "";

  if (!key.trim()) {
    return {
      configured: false,
      ok: false,
      message: "Coinbase key not configured.",
      details: null,
    };
  }

  return {
    configured: true,
    ok: true,
    message: "Coinbase key is configured.",
    details: null,
  };
}

async function testPayPal(): Promise<ServiceResult> {
  const clientId = process.env.PAYPAL_CLIENT_ID || "";
  const secret = process.env.PAYPAL_CLIENT_SECRET || "";

  if (!clientId.trim() || !secret.trim()) {
    return {
      configured: false,
      ok: false,
      message: "PayPal env vars are incomplete.",
      details: {
        hasClientId: !!clientId.trim(),
        hasSecret: !!secret.trim(),
      },
    };
  }

  return {
    configured: true,
    ok: true,
    message: "PayPal env vars are configured.",
    details: null,
  };
}

export async function GET(request: NextRequest) {
  // Admin-gated. This endpoint enumerates every configured provider, reports which are broken, and
  // returns masked key previews (incl. the live Stripe secret's prefix + last 4) — a free map of the
  // stack for anyone who asks. It was reachable unauthenticated on production.
  //
  // The gate must stay ABOVE the probes, not just hide the response: testTwilio() now makes a real
  // Twilio API call, so an open endpoint is also an unauthenticated way to drive load and cost onto
  // our provider accounts, not merely an information leak.
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const [
      openai,
      deepseek,
      xai,
      clearsports,
      resend,
      stripe,
      supabase,
      twilio,
      coinbase,
      paypal,
    ] = await Promise.all([
      testOpenAI(),
      testDeepSeek(),
      testXai(),
      testClearSports(),
      testResend(),
      testStripe(),
      testSupabase(),
      testTwilio(),
      testCoinbase(),
      testPayPal(),
    ]);

    return NextResponse.json({
      ok: true,
      services: {
        openai,
        deepseek,
        xai,
        clearsports,
        resend,
        stripe,
        supabase,
        twilio,
        coinbase,
        paypal,
      },
      summary: {
        configuredCount: [
          openai,
          deepseek,
          xai,
          clearsports,
          resend,
          stripe,
          supabase,
          twilio,
          coinbase,
          paypal,
        ].filter((x) => x.configured).length,
        passingCount: [
          openai,
          deepseek,
          xai,
          clearsports,
          resend,
          stripe,
          supabase,
          twilio,
          coinbase,
          paypal,
        ].filter((x) => x.ok).length,
      },
    });
  } catch (error: unknown) {
    console.error("[test-keys][GET] error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Key test failed.",
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET, OPTIONS",
    },
  });
}
