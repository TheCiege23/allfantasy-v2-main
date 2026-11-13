import type { ConfidenceLevel } from './confidence';

export async function logFeedbackOpened(params: {
  insight_id?: string;
  confidence_level?: ConfidenceLevel;
}): Promise<void> {
  try {
    await fetch('/api/analytics/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ai_feedback_opened',
        ...params,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('Failed to log feedback opened:', e);
  }
}

export async function logFeedbackSubmitted(params: {
  insight_id?: string;
  confidence_level?: ConfidenceLevel;
  feedback_type: string;
  feedback_text: string;
}): Promise<void> {
  try {
    await fetch('/api/analytics/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ai_feedback_submitted',
        ...params,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('Failed to log feedback submitted:', e);
  }
}
