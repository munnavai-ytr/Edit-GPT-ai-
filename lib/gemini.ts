import {GoogleGenAI} from '@google/genai';

export const ALLOWED_DIRECTOR_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
] as const;

export const TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe' as const;

export type DirectorModelId = (typeof ALLOWED_DIRECTOR_MODELS)[number];

export function resolveDirectorModel(input?: string): DirectorModelId {
  if (input === 'gemini-3.1-flash-lite') return 'gemini-3.1-flash-lite';
  return 'gemini-3.8-flash';
}

export function getServerGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new GeminiConfigError(
      'GEMINI_API_KEY is missing on the server. Configure your key in Settings > Secrets.',
      401,
      'MISSING_API_KEY'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiConfigError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 500, code = 'GEMINI_ERROR') {
    super(message);
    this.name = 'GeminiConfigError';
    this.status = status;
    this.code = code;
  }
}

export async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('quota');
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('fetch failed');

      if ((isRateLimit || isTransient) && attempt < maxRetries) {
        const delayMs = 900 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      break;
    }
  }
  throw formatGeminiError(lastError);
}

export function formatGeminiError(err: unknown): GeminiConfigError {
  if (err instanceof GeminiConfigError) return err;
  const rawMessage = err instanceof Error ? err.message : String(err);

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('403')
  ) {
    return new GeminiConfigError(
      'Gemini API key was rejected or lacks permission. Verify your key in the Settings > Secrets panel.',
      403,
      'INVALID_API_KEY'
    );
  }

  if (
    rawMessage.includes('429') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.toLowerCase().includes('quota')
  ) {
    return new GeminiConfigError(
      'Gemini free-tier rate limit reached. Wait 30–60 seconds and click Retry, or switch to gemini-3.1-flash-lite in Settings.',
      429,
      'RATE_LIMITED'
    );
  }

  if (rawMessage.includes('404') || rawMessage.includes('NOT_FOUND')) {
    return new GeminiConfigError(
      'Requested Gemini model was not found. Reset the model selection in Settings.',
      404,
      'MODEL_NOT_FOUND'
    );
  }

  return new GeminiConfigError(
    `Gemini API error: ${rawMessage.slice(0, 280)}`,
    500,
    'GEMINI_REQUEST_FAILED'
  );
}
