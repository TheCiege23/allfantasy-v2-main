"use client";

import { useState, useEffect, useRef } from "react";
import { X, ThumbsUp, Bug, Lightbulb, HelpCircle, AlertTriangle, MessageSquare, Star, Send, Check, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logFeedbackOpened, logFeedbackSubmitted } from "@/lib/analytics/insight-events";
import EarlyAccessUpsell from "./EarlyAccessUpsell";

const FEEDBACK_TYPES = [
  { value: "like", label: "Something I like", icon: ThumbsUp, color: "text-green-400" },
  { value: "bug", label: "Bug or issue", icon: Bug, color: "text-red-400" },
  { value: "feature", label: "Feature request / idea", icon: Lightbulb, color: "text-amber-400" },
  { value: "confusing", label: "Confusing or hard to use", icon: HelpCircle, color: "text-purple-400" },
  { value: "wrong", label: "Something feels wrong", icon: AlertTriangle, color: "text-orange-400" },
  { value: "general", label: "General feedback", icon: MessageSquare, color: "text-cyan-400" },
];

const TOOLS = [
  "Legacy Import",
  "Career Stats / History",
  "Playoff History",
  "Rankings / Percentiles",
  "Trade Evaluator",
  "Trade Finder",
  "Trade Notifications",
  "Waiver AI",
  "Player Finder",
  "Share / Social Cards",
  "AI Chat",
  "Other / Not sure",
];

const IMPORTANCE_OPTIONS = [
  { value: "nice_to_have", label: "Nice to have" },
  { value: "important", label: "Important" },
  { value: "blocking", label: "Blocking / Frustrating" },
];

type FeedbackModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sleeperUsername?: string;
  userId?: string;
  defaultTool?: string;
};

export default function FeedbackModal({
  isOpen,
  onClose,
  sleeperUsername,
  userId,
  defaultTool,
}: FeedbackModalProps) {
  const [feedbackType, setFeedbackType] = useState("");
  const [tool, setTool] = useState(defaultTool || "");
  const [feedbackText, setFeedbackText] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [importance, setImportance] = useState("");
  const [wasLoggedIn, setWasLoggedIn] = useState<boolean | null>(null);
  const [device, setDevice] = useState("");
  const [email, setEmail] = useState("");
  const [canContact, setCanContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const ua = navigator.userAgent;
      if (/Mobi|Android/i.test(ua)) setDevice("Mobile");
      else if (/Tablet|iPad/i.test(ua)) setDevice("Tablet");
      else setDevice("Desktop");
      
      setWasLoggedIn(!!sleeperUsername || !!userId);
      
      logFeedbackOpened({});
    }
  }, [isOpen, sleeperUsername, userId]);

  useEffect(() => {
    if (defaultTool) setTool(defaultTool);
  }, [defaultTool]);

  const reset = () => {
    setFeedbackType("");
    setTool(defaultTool || "");
    setFeedbackText("");
    setStepsToReproduce("");
    setRating(null);
    setImportance("");
    setEmail("");
    setCanContact(false);
    setSuccess(false);
    setError(null);
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be less than 5MB");
      return;
    }
    
    setScreenshot(file);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setScreenshotPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadScreenshot = async (): Promise<string | null> => {
    if (!screenshot) return null;
    
    setUploadingScreenshot(true);
    try {
      const formData = new FormData();
      formData.append("file", screenshot);
      
      const res = await fetch("/api/legacy/feedback/upload", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to upload screenshot");
      }
      
      const data = await res.json();
      return data.url;
    } catch (e: any) {
      console.error("Screenshot upload error:", e);
      return null;
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmit = async () => {
    if (!feedbackType) {
      toast.error("Please select a feedback type");
      return;
    }
    if (!tool) {
      toast.error("Please select which tool this is about");
      return;
    }
    if (!feedbackText.trim()) {
      toast.error("Please enter your feedback");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let screenshotUrl: string | null = null;
      let screenshotMeta: string | null = null;
      
      if (screenshot) {
        screenshotUrl = await uploadScreenshot();
        if (screenshotUrl) {
          screenshotMeta = JSON.stringify({
            type: screenshot.type,
            size: screenshot.size,
            name: screenshot.name,
          });
        }
      }

      const browser = (() => {
        const ua = navigator.userAgent;
        if (ua.includes("Chrome")) return "Chrome";
        if (ua.includes("Safari")) return "Safari";
        if (ua.includes("Firefox")) return "Firefox";
        if (ua.includes("Edge")) return "Edge";
        return "Unknown";
      })();

      const res = await fetch("/api/legacy/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackType,
          tool,
          feedbackText: feedbackText.trim(),
          stepsToReproduce: stepsToReproduce.trim() || null,
          pageUrl: typeof window !== "undefined" ? window.location.href : null,
          rating,
          importance: importance || null,
          wasLoggedIn,
          device,
          browser,
          email: email.trim() || null,
          canContact,
          userId: userId || null,
          sleeperUsername: sleeperUsername || null,
          screenshotUrl,
          screenshotMeta,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit feedback");
      }

      logFeedbackSubmitted({
        feedback_type: feedbackType,
        feedback_text: feedbackText.trim(),
      });

      setSuccess(true);
      toast.success("Feedback submitted! Thanks for helping improve the AI.");
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
      setError(e.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const isBugOrIssue = feedbackType === "bug" || feedbackType === "wrong";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />
      
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/10 bg-slate-900/95 backdrop-blur">
          <h2 className="text-lg font-semibold text-white">Your feedback makes the AI smarter</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="p-6 space-y-5">
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg">
                <Check className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white">Thanks — this helps the AI learn</h3>
              <p className="text-sm text-white/60">This feedback is read by the team and used to improve future AI models.</p>
              {isBugOrIssue && (
                <p className="text-xs text-white/40">Our AI is analyzing your report and will alert the team.</p>
              )}
            </div>

            <EarlyAccessUpsell variant="after_feedback" onClose={handleClose} />

            <button
              onClick={handleClose}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-6 py-2.5 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition"
            >
              Keep Exploring
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            <p className="text-sm text-white/60">
              What felt right? What felt off? Or what confused you?
              <span className="block mt-1 text-white/40">Even a single sentence helps.</span>
            </p>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                What is this feedback about? <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setFeedbackType(type.value)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition ${
                        feedbackType === type.value
                          ? "bg-cyan-500/20 border-cyan-500/50 border"
                          : "bg-white/5 border border-white/10 hover:bg-white/10"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${type.color}`} />
                      <span className="text-white/80">{type.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">
                Which Legacy tool are you giving feedback on? <span className="text-red-400">*</span>
              </label>
              <select
                value={tool}
                onChange={(e) => setTool(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
              >
                <option value="" className="bg-slate-900">Select a tool...</option>
                {TOOLS.map((t) => (
                  <option key={t} value={t} className="bg-slate-900">{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">
                Your feedback <span className="text-red-400">*</span>
              </label>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Something feel off? Surprisingly smart? One sentence from you helps the AI get better at reading leagues like this."
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
              />
            </div>

            {isBugOrIssue && (
              <>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Steps to reproduce
                  </label>
                  <textarea
                    value={stepsToReproduce}
                    onChange={(e) => setStepsToReproduce(e.target.value)}
                    placeholder="1. Go to...\n2. Click on...\n3. See error..."
                    rows={3}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Screenshot (optional)
                  </label>
                  
                  {screenshotPreview ? (
                    <div className="relative rounded-xl overflow-hidden border border-white/10">
                      <img
                        src={screenshotPreview}
                        alt="Screenshot preview"
                        className="w-full max-h-48 object-contain bg-black/50"
                      />
                      <button
                        onClick={removeScreenshot}
                        className="absolute top-2 right-2 rounded-lg bg-red-500/80 p-1.5 text-white hover:bg-red-500 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] p-6 text-white/50 hover:border-white/30 hover:bg-white/5 transition"
                    >
                      <Upload className="h-6 w-6" />
                      <span className="text-sm">Click to upload a screenshot</span>
                      <span className="text-xs text-white/30">Max 5MB, PNG/JPG</span>
                    </button>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleScreenshotSelect}
                    className="hidden"
                  />
                  
                  <p className="mt-2 text-xs text-white/40">
                    Don&apos;t include passwords, payment info, or private messages in screenshots.
                  </p>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Rating (optional)
                </label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(rating === star ? null : star)}
                      className="p-1"
                    >
                      <Star
                        className={`h-6 w-6 transition ${
                          rating && star <= rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-white/30 hover:text-white/50"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Importance (optional)
                </label>
                <select
                  value={importance}
                  onChange={(e) => setImportance(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                >
                  <option value="" className="bg-slate-900">Select...</option>
                  {IMPORTANCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Only if you want a response"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={canContact}
                onChange={(e) => setCanContact(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-sm text-white/60">May we contact you about this feedback?</span>
            </label>

            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
              <p className="text-xs text-white/40">
                Feedback may be used to improve AllFantasy tools and features. We may summarize or reference feedback internally or publicly, but we will never attribute feedback to you without your permission.
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || uploadingScreenshot}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 py-3 font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              {submitting || uploadingScreenshot ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {uploadingScreenshot ? "Uploading screenshot..." : "Submitting..."}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Share Feedback
                </>
              )}
            </button>
            <p className="text-center text-xs text-white/30 mt-2">
              Built by players · Feedback goes directly into development
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
