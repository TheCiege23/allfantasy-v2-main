'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Database, Brain, LayoutDashboard, Trophy, Scale } from 'lucide-react';

const starPositions = Array.from({ length: 40 }, (_, i) => ({
  top: `${((i * 17 + 7) % 100)}%`,
  left: `${((i * 31 + 13) % 100)}%`,
  drift: (i % 9) * 10 - 40,
  duration: 60 + (i % 5) * 10,
  delay: (i % 10),
}));

const messages = [
  "Rebuilding your dynasty empire...",
  "Analyzing seasons of glory & heartbreak...",
  "Unlocking hidden trade gold...",
  "Chimmy co-GM calibrating your path to the ship...",
  "Assembling your fantasy legacy...",
];

function createAudioContext() {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
}

function playPing(ctx: AudioContext, freq = 880, duration = 0.15, vol = 0.35) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playSparkle(ctx: AudioContext) {
  const notes = [1200, 1500, 1800, 2200];
  notes.forEach((freq, i) => {
    setTimeout(() => playPing(ctx, freq, 0.12, 0.2), i * 60);
  });
}

function startAmbientDrone(ctx: AudioContext): () => void {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(55, ctx.currentTime);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(82.5, ctx.currentTime);
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc2.start();
  return () => {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    setTimeout(() => { osc1.stop(); osc2.stop(); }, 600);
  };
}

export default function ImportLoading() {
  const [progress, setProgress] = useState(5);
  const [currentMessage, setCurrentMessage] = useState(messages[0]);
  const [eta, setEta] = useState('~2 min remaining');
  const [activeStep, setActiveStep] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopDroneRef = useRef<(() => void) | null>(null);
  const prevStepRef = useRef(0);
  const hitMilestonesRef = useRef<Set<number>>(new Set());

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = createAudioContext();
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  useEffect(() => {
    if (!soundEnabled) {
      stopDroneRef.current?.();
      stopDroneRef.current = null;
      return;
    }
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (!stopDroneRef.current) {
      stopDroneRef.current = startAmbientDrone(ctx);
    }
    return () => {
      stopDroneRef.current?.();
      stopDroneRef.current = null;
    };
  }, [soundEnabled, getAudioCtx]);

  useEffect(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    if (activeStep > prevStepRef.current) {
      playPing(ctx, 660 + activeStep * 110, 0.2, 0.35);
    }
    prevStepRef.current = activeStep;
  }, [activeStep, soundEnabled, getAudioCtx]);

  useEffect(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const rounded = Math.round(progress);
    [25, 50, 75, 100].forEach((milestone) => {
      if (rounded >= milestone && !hitMilestonesRef.current.has(milestone)) {
        hitMilestonesRef.current.add(milestone);
        playSparkle(ctx);
      }
    });
  }, [progress, soundEnabled, getAudioCtx]);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          return 100;
        }
        return Math.min(prev + Math.random() * 8 + 2, 100);
      });
    }, 1800);

    const msgInterval = setInterval(() => {
      setCurrentMessage((prev) => {
        const idx = messages.indexOf(prev);
        return messages[(idx + 1) % messages.length];
      });
    }, 5000);

    const etaTimer = setInterval(() => {
      const remaining = Math.max(0, Math.round((120 - progress * 1.2) / 10) * 10);
      setEta(remaining > 0 ? `~${remaining} sec remaining` : 'Finalizing...');
    }, 10000);

    const stepTimer = setInterval(() => {
      setActiveStep((prev) => Math.min(prev + 1, 4));
    }, 12000);

    return () => {
      clearInterval(timer);
      clearInterval(msgInterval);
      clearInterval(etaTimer);
      clearInterval(stepTimer);
    };
  }, [progress]);

  const steps = [
    { icon: Database, label: 'Connecting to Sleeper', done: activeStep >= 0 },
    { icon: Trophy, label: 'Loading leagues & history', done: activeStep >= 1 },
    { icon: Brain, label: 'Calculating legacy stats', done: activeStep >= 2 },
    { icon: Brain, label: 'Generating Chimmy insights', done: activeStep >= 3 },
    { icon: LayoutDashboard, label: 'Preparing dashboard', done: activeStep >= 4 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d0d17] to-[#0f0f1a] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-grid-cyan-900/10 opacity-20 pointer-events-none animate-pulse-slow" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.04)_0%,_transparent_50%)]"
          animate={{ x: ['-10%', '10%'] }}
          transition={{ duration: 120, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
        />
        {starPositions.map((star, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full opacity-30"
            style={{ top: star.top, left: star.left }}
            animate={{
              x: [0, star.drift],
              opacity: [0.3, 0.8, 0.3],
            }}
            transition={{
              duration: star.duration,
              repeat: Infinity,
              repeatType: 'reverse',
              delay: star.delay,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-black/60 backdrop-blur-xl border border-cyan-900/40 rounded-2xl shadow-2xl shadow-cyan-950/50 overflow-hidden"
      >
        <div className="relative pt-10 pb-6 text-center">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              className="w-44 h-44 rounded-full border-2 border-cyan-500/30"
              animate={{ rotate: 360 }}
              transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
            />
          </div>

          <div className="relative inline-block">
            <div className="w-28 h-28 mx-auto rounded-full overflow-hidden border-4 border-cyan-500/40 shadow-lg shadow-cyan-500/30 bg-gradient-to-br from-cyan-900/50 to-purple-900/50 flex items-center justify-center">
              <Trophy className="h-12 w-12 text-cyan-400" />
            </div>
            <motion.div
              className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 blur-xl"
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          <div className="mt-6">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              AllFantasy
            </h2>
            <p className="text-gray-400 mt-2 text-lg">
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentMessage}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.6 }}
                >
                  {currentMessage}
                </motion.span>
              </AnimatePresence>
            </p>
          </div>
        </div>

        <div className="px-8 pb-6">
          <div className="relative h-3 bg-gray-800/50 rounded-full overflow-hidden border border-cyan-900/40">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-wave" />
            </motion.div>
          </div>

          <div className="mt-3 flex justify-between text-sm">
            <span className="text-cyan-300 font-medium">{Math.round(progress)}% complete</span>
            <span className="text-gray-400">{eta}</span>
          </div>
        </div>

        <div className="px-8 pb-8">
          <div className="text-xs uppercase text-gray-500 mb-4 tracking-wider">LIVE STATUS</div>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                custom={i}
                variants={{
                  hidden: { opacity: 0, x: -20 },
                  visible: (ci: number) => ({
                    opacity: 1,
                    x: 0,
                    transition: { delay: ci * 0.4 + progress / 200 }
                  })
                }}
                initial="hidden"
                animate={progress > (i + 1) * 20 ? 'visible' : 'hidden'}
                className="flex items-center gap-3 text-sm"
              >
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : i === Math.floor(progress / 20) ? (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                    className="h-5 w-5 rounded-full bg-cyan-500/30 flex items-center justify-center"
                  >
                    <div className="h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
                  </motion.div>
                ) : (
                  <div className="h-5 w-5 rounded-full bg-gray-700" />
                )}
                <span className={step.done ? 'text-green-300' : 'text-gray-300'}>
                  {step.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative px-8 pb-10 border-t border-cyan-900/30 pt-6">
          <div className="text-xs uppercase text-gray-500 mb-4 tracking-wider">WHAT YOU&apos;LL GET</div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: LayoutDashboard, label: 'Report Card' },
              { icon: Brain, label: 'Chimmy Insights' },
              { icon: Trophy, label: 'Power Rankings' },
              { icon: Scale, label: 'Trade Evaluator' },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 + i * 0.2, duration: 0.6 }}
                className="flex items-center gap-3 bg-black/40 border border-cyan-900/30 rounded-lg p-3 hover:border-cyan-500/50 transition-colors"
              >
                <item.icon className="h-5 w-5 text-cyan-400" />
                <span className="text-sm text-gray-200">{item.label}</span>
              </motion.div>
            ))}
          </div>
          <motion.button
            className="absolute bottom-4 right-4 text-xs text-gray-500 hover:text-cyan-400 transition-colors"
            onClick={() => setSoundEnabled(!soundEnabled)}
            whileHover={{ scale: 1.1 }}
          >
            {soundEnabled ? 'Sound on' : 'Sound off'}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
