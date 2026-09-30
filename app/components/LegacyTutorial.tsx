"use client";

import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Sparkles, Rocket } from "lucide-react";

type Tab = 'overview' | 'trade' | 'finder' | 'player-finder' | 'waiver' | 'rankings' | 'pulse' | 'compare' | 'chat' | 'share' | 'transfer';

interface TutorialStep {
  icon: string;
  title: string;
  tagline: string;
  description: string;
  color: string;
  tab: Tab | null;
}

const tutorialSteps: TutorialStep[] = [
  {
    icon: "🚀",
    title: "Welcome to AF Legacy!",
    tagline: "Your Fantasy Command Center",
    description: "This is your all-in-one hub for fantasy sports domination. Let's take a quick tour of the powerful tools at your fingertips!",
    color: "from-cyan-500 to-purple-500",
    tab: "overview",
  },
  {
    icon: "📊",
    title: "Overview",
    tagline: "Your Career at a Glance",
    description: "See your complete fantasy legacy — wins, losses, championships, and your AI-powered manager rating. It's like a fantasy sports report card, but way cooler.",
    color: "from-blue-500 to-cyan-500",
    tab: "overview",
  },
  {
    icon: "🔄",
    title: "AF Trade Analyzer",
    tagline: "Never Lose a Trade Again",
    description: "Our AI evaluates trades using real FantasyCalc values. Get instant grades, fair value analysis, and know exactly who's winning before you hit accept.",
    color: "from-emerald-500 to-teal-500",
    tab: "trade",
  },
  {
    icon: "🎯",
    title: "Trade Finder",
    tagline: "Find Your Perfect Deal",
    description: "AI scans your league and finds trades tailored to YOUR team. It learns your trading style and suggests deals you'll actually want to make.",
    color: "from-orange-500 to-amber-500",
    tab: "finder",
  },
  {
    icon: "🔍",
    title: "Player Finder",
    tagline: "Hunt Down Any Player",
    description: "Looking for a specific player in your leagues? Find out who owns them, their trade value, and get instant trade package suggestions.",
    color: "from-violet-500 to-purple-500",
    tab: "player-finder",
  },
  {
    icon: "📈",
    title: "Waiver AI",
    tagline: "Win Your Waiver Wire",
    description: "Get smart waiver recommendations with FAAB suggestions. Know who to add, who to drop, and how much to bid to beat your leaguemates.",
    color: "from-green-500 to-emerald-500",
    tab: "waiver",
  },
  {
    icon: "🏆",
    title: "League Rankings",
    tagline: "Know Where You Stand",
    description: "See how you rank against every team in your league. Roster value, points, win rate — plus AI advice on whether to contend or rebuild.",
    color: "from-yellow-500 to-orange-500",
    tab: "rankings",
  },
  {
    icon: "📡",
    title: "Social Pulse",
    tagline: "What's the Buzz?",
    description: "Real-time social sentiment on players. See what the fantasy community is saying before news breaks. Stay ahead of the hype train.",
    color: "from-pink-500 to-rose-500",
    tab: "pulse",
  },
  {
    icon: "⚔️",
    title: "Manager Compare",
    tagline: "Head-to-Head Showdown",
    description: "Compare your legacy against any manager in your league. See who has the better record, more championships, and bragging rights.",
    color: "from-red-500 to-orange-500",
    tab: "compare",
  },
  {
    icon: "💬",
    title: "Chimmy, Your Fantasy Coach",
    tagline: "Your Personal Advisor",
    description: "Chat with Chimmy, who knows YOUR teams, YOUR leagues, and YOUR situation. Get personalized advice on any fantasy question.",
    color: "from-indigo-500 to-blue-500",
    tab: "chat",
  },
  {
    icon: "🔗",
    title: "Share",
    tagline: "Flex Your Legacy",
    description: "Generate shareable posts for X/Twitter with AI-crafted trash talk. Show off your championships or roast your rivals — the choice is yours.",
    color: "from-sky-500 to-cyan-500",
    tab: "share",
  },
  {
    icon: "📦",
    title: "League Transfer",
    tagline: "Take It Anywhere",
    description: "Export your league to other platforms. Preview exactly how it'll look before committing. Your league, your way.",
    color: "from-purple-500 to-pink-500",
    tab: "transfer",
  },
];

interface LegacyTutorialProps {
  onClose: () => void;
  onChangeTab?: (tab: Tab) => void;
}

export default function LegacyTutorial({ onClose, onChangeTab }: LegacyTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [direction, setDirection] = useState<"left" | "right">("right");

  useEffect(() => {
    setIsVisible(true);
  }, []);

  useEffect(() => {
    const step = tutorialSteps[currentStep];
    if (step.tab && onChangeTab) {
      onChangeTab(step.tab);
    }
  }, [currentStep, onChangeTab]);

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setDirection("right");
      setCurrentStep((prev) => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setDirection("left");
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    localStorage.setItem("af-legacy-tutorial-seen", "true");
    if (onChangeTab) {
      onChangeTab("overview");
    }
    setTimeout(onClose, 300);
  };

  const handleSkip = () => {
    handleClose();
  };

  const handleDotClick = (index: number) => {
    setDirection(index > currentStep ? "right" : "left");
    setCurrentStep(index);
  };

  const step = tutorialSteps[currentStep];
  const isLastStep = currentStep === tutorialSteps.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div
        className={`relative w-full sm:max-w-md mb-20 sm:mb-0 rounded-3xl border border-white/20 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 shadow-2xl overflow-hidden transition-all duration-300 mx-4 sm:mx-0 ${
          isVisible ? "translate-y-0 scale-100" : "translate-y-8 scale-95"
        }`}
      >
        <div className={`h-2 bg-gradient-to-r ${step.color}`} />

        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white/60 hover:bg-white/20 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 sm:p-8">
          <div
            key={currentStep}
            className={`transition-all duration-300 ${
              direction === "right"
                ? "animate-slide-in-right"
                : "animate-slide-in-left"
            }`}
          >
            <div className="text-center mb-6">
              <div
                className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br ${step.color} shadow-lg mb-4`}
              >
                <span className="text-4xl">{step.icon}</span>
              </div>

              <h2 className="text-2xl font-bold text-white mb-1">{step.title}</h2>
              <p
                className={`text-sm font-medium bg-gradient-to-r ${step.color} bg-clip-text text-transparent`}
              >
                {step.tagline}
              </p>
            </div>

            <p className="text-center text-white/70 text-sm leading-relaxed mb-6">
              {step.description}
            </p>

            {step.tab && currentStep > 0 && (
              <div className="text-center mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/50">
                  <span className="text-cyan-400">👆</span>
                  Check out the {step.title} tab behind this popup
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-center gap-1.5 mb-6">
            {tutorialSteps.map((_, index) => (
              <button
                key={index}
                onClick={() => handleDotClick(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentStep
                    ? `w-6 bg-gradient-to-r ${step.color}`
                    : "w-2 bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrev}
              disabled={isFirstStep}
              className={`flex items-center justify-center w-12 h-12 rounded-xl transition shrink-0 ${
                isFirstStep
                  ? "opacity-0 pointer-events-none"
                  : "bg-white/10 text-white hover:bg-white/20 active:bg-white/30"
              }`}
              aria-label="Previous step"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              onClick={handleNext}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition bg-gradient-to-r ${step.color} text-white shadow-lg hover:shadow-xl active:scale-[0.98]`}
            >
              {isLastStep ? (
                <>
                  <Rocket className="h-4 w-4" />
                  Get Started
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>

            {isFirstStep && <div className="w-12 shrink-0" />}
          </div>

          <button
            onClick={handleSkip}
            className="w-full mt-3 text-sm text-white/40 hover:text-white/60 transition py-1"
          >
            Skip tour
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes slide-in-left {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
