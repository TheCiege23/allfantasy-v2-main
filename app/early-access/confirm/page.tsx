import crypto from "crypto";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function fromBase64url(s: string) {
  const padded =
    s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function toBase64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function hmacBase64url(secret: string, token: string) {
  const h = crypto.createHmac("sha256", secret).update(token).digest();
  return toBase64url(h);
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export default async function EarlyAccessConfirmPage(
  props: {
    searchParams?: Promise<{ t?: string; s?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const token = (searchParams?.t || "").trim();
  const sig = (searchParams?.s || "").trim();
  const secret = (process.env.EARLY_ACCESS_CONFIRM_SECRET || "").trim();

  const baseUrl = (process.env.APP_URL || "https://allfantasy.ai")
    .trim()
    .replace(/\/+$/, "");

  let ok = false;
  let email: string | null = null;
  let reason: string | null = null;

  if (!secret) {
    reason = "Confirmation is not configured yet (missing secret).";
  } else if (!token || !sig) {
    reason = "Missing confirmation parameters.";
  } else {
    const expected = hmacBase64url(secret, token);
    if (!timingSafeEqualStr(expected, sig)) {
      reason = "Invalid confirmation signature.";
    } else {
      try {
        const decoded = fromBase64url(token).toString("utf8");
        const [rawEmail, rawTs] = decoded.split("|");
        const ts = Number(rawTs);

        if (!rawEmail || !Number.isFinite(ts)) {
          reason = "Invalid confirmation token.";
        } else {
          const ageMs = Date.now() - ts;
          const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
          if (ageMs < 0 || ageMs > MAX_AGE_MS) {
            reason = "Confirmation link expired.";
          } else {
            email = rawEmail.trim().toLowerCase();
            ok = true;
          }
        }
      } catch {
        reason = "Invalid confirmation token encoding.";
      }
    }
  }

  let updated = false;
  let alreadyConfirmed = false;
  let signupExists = false;

  if (ok && email) {
    try {
      const existing = await prisma.earlyAccessSignup.findUnique({
        where: { email },
        select: { confirmedAt: true },
      });

      if (existing) {
        signupExists = true;
        if (existing.confirmedAt) {
          alreadyConfirmed = true;
        } else {
          await prisma.earlyAccessSignup.update({
            where: { email },
            data: { confirmedAt: new Date() },
          });
          updated = true;
        }
      } else {
        signupExists = false;
      }
    } catch {
    }
  }

  try {
    await prisma.analyticsEvent.create({
      data: {
        event: "tool_use",
        toolKey: ok ? "early_access_confirmed" : "early_access_confirm_failed",
        path: "/early-access/confirm",
        emailHash: email ? sha256Hex(email) : null,
        meta: {
          ok,
          email: email || undefined,
          reason: reason || undefined,
          signupExists,
          updated,
          alreadyConfirmed,
        },
      },
    });
  } catch {
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-white">
      <div className="mx-auto max-w-xl px-6 py-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xs uppercase tracking-widest text-white/60">
            AllFantasy - Early Access
          </div>

          {ok ? (
            <>
              <h1 className="mt-3 text-2xl font-extrabold">
                {alreadyConfirmed ? "Already confirmed" : "Spot confirmed"}
              </h1>
              <p className="mt-2 text-sm text-white/70">
                {signupExists
                  ? alreadyConfirmed
                    ? "You were already confirmed - you're all set."
                    : "You're confirmed for early access waves. When your invite is ready, we'll email you."
                  : "Your spot is confirmed, but we couldn't find your signup record. If you used a different email, re-join early access below."}
              </p>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-white/90"
                >
                  Go to AllFantasy
                </Link>
                <Link
                  href="/af-legacy"
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Explore Legacy Tools
                </Link>
              </div>

              <div className="mt-6 text-xs text-white/50">
                Tip: If you don't see our emails, check Promotions/Spam and whitelist{" "}
                <span className="text-white/70">noreply@allfantasy.ai</span>.
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-2xl font-extrabold">Link issue</h1>
              <p className="mt-2 text-sm text-white/70">
                {reason || "We couldn't confirm your spot with that link."}
              </p>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-white/90"
                >
                  Back to AllFantasy
                </Link>
                <a
                  href={`${baseUrl}/#early-access`}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Re-join early access
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
