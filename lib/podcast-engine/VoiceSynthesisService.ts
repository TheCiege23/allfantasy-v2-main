/**
 * Voice synthesis for podcast audio. Server-side placeholder; playback can use browser SpeechSynthesis with script.
 * Integrate with TTS API (e.g. ElevenLabs, Azure Speech) to set audioUrl.
 */
interface SynthesisResult {
  audioUrl: string | null
  durationSeconds: number | null
  error?: string
}

/**
 * Synthesize script to audio. Returns null audioUrl when no server-side TTS is configured;
 * client can fall back to browser SpeechSynthesis with the script.
 */
export async function synthesizeScriptToAudio(script: string): Promise<SynthesisResult> {
  if (!script?.trim()) {
    return { audioUrl: null, durationSeconds: null, error: "Empty script" }
  }
  // Placeholder: no server-side TTS configured. Client plays script via SpeechSynthesis.
  const wordCount = script.trim().split(/\s+/).length
  const estimatedSeconds = Math.ceil(wordCount / 2.2) // ~150 wpm
  return { audioUrl: null, durationSeconds: estimatedSeconds }
}
