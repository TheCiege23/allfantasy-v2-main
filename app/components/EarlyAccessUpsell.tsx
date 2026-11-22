"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

type UpsellVariant = "default" | "after_feedback" | "power_user";

interface EarlyAccessUpsellProps {
  variant?: UpsellVariant;
  onClose?: () => void;
}

const CONTENT = {
  default: {
    title: "Help shape Chimmy before launch",
    body: "AF Legacy is a live preview of Chimmy powering the AllFantasy app launching in 2026. Early access members help guide how Chimmy learns by using the tools, sharing feedback, and stress-testing real league scenarios.",
  },
  after_feedback: {
    title: "Thanks — this helps Chimmy learn",
    body: "Feedback like yours directly influences how the AllFantasy Chimmy improves before launch. Want to be part of that process as new features roll out?",
  },
  power_user: {
    title: "You're already using Chimmy like an early tester",
    body: "Early access members get visibility into what's coming next and help shape the tools before the full app launch.",
  },
};

const upsellSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email"),
});
type UpsellForm = z.infer<typeof upsellSchema>;

export default function EarlyAccessUpsell({
  variant = "default",
  onClose,
}: EarlyAccessUpsellProps) {
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpsellForm>({
    resolver: zodResolver(upsellSchema),
    defaultValues: { email: "" },
  });

  const content = CONTENT[variant];

  const onSubmit = async (formData: UpsellForm) => {
    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          utm_source: "af_legacy",
          utm_medium: "inline_upsell",
          utm_campaign: variant,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error || "Something went wrong.");
        return;
      }

      setSuccess(true);
      toast.success("You're in! We'll be in touch soon.");
    } catch {
      toast.error("Network error. Please try again.");
    }
  };

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
        <div className="text-3xl mb-3">🎉</div>
        <h3 className="text-lg font-semibold text-white mb-2">You're in!</h3>
        <p className="text-sm text-white/60">
          You'll be among the first to shape the AllFantasy Chimmy. We'll be in touch soon.
        </p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-4 text-sm text-white/40 hover:text-white/60 transition"
          >
            Continue exploring
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 p-6">
      <h3 className="text-lg font-semibold text-white mb-2">{content.title}</h3>
      <p className="text-sm text-white/60 mb-5 leading-relaxed">{content.body}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <input
              type="email"
              {...register("email")}
              placeholder="Enter your email"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
            />
            {errors.email && (
              <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-50"
          >
            {isSubmitting ? "Joining..." : "Join Early Access"}
          </button>
        </div>

        <p className="text-xs text-white/40">
          Free · No commitment · Built with players
        </p>
      </form>
    </div>
  );
}
