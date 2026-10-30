import {GoogleGenAI} from '@google/genai';
import type {NextRequest} from 'next/server';

export const SELECTABLE_DIRECTOR_MODELS = [
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash (Balanced Multimodal & Reasoning)',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite (Fast High-Quota Free Tier)',
  },
  {
    id: 'gemini-flash-latest',
    label: 'gemini-flash-latest (Latest Flash Alias)',
  },
  {
    id: 'gemini-4-argon',
    label: 'gemini-4-argon (Advanced Pro Reasoning · Requires Paid BYOK Key)',
  },
] as const;

export const TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe' as const;

const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function resolveDirectorModel(input?: string): string {
  const cleaned = input?.trim();
  if (!cleaned || DEPRECATED_MODELS.has(cleaned)) {
    return 'gemini-3.8-flash';
  }
  return cleaned;
}

export function resolveTranscriptionModel(input?: string): string {
  const cleaned = input?.trim();
  if (!cleaned || DEPRECATED_MODELS.has(cleaned)) {
    return TRANSCRIPTION_MODEL;
  }
  return cleaned;
}

export function getServerGeminiClient(req?: NextRequest): {
  ai: GoogleGenAI;
  keySource: 'byok' | 'server_env';
} {
  const headerKey = req?.headers.get('x-gemini-api-key')?.trim();
  const envKey = process.env.GEMINI_API_KEY?.trim();

  const useByok = Boolean(headerKey && headerKey.length > 5);
  const resolvedKey = useByok
    ? headerKey!
    : envKey && envKey !== 'MY_GEMINI_API_KEY'
      ? envKey
      : '';

  if (!resolvedKey) {
    throw new GeminiConfigError(
      'No Gemini API key is configured. Open the API Key Manager to add your Gemini API key.',
      401,
      'MISSING_API_KEY'
    );
  }

  const ai = new GoogleGenAI({
    apiKey: resolvedKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    ai,
    keySource: useByok ? 'byok' : 'server_env',
  };
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
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('fetch failed');

      if (isTransient && attempt < maxRetries) {
        const delayMs = 800 * Math.pow(2, attempt);
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
    rawMessage.includes('API key not valid') ||
    rawMessage.includes('403') ||
    rawMessage.includes('401')
  ) {
    return new GeminiConfigError(
      'Invalid or unauthorized Gemini API key. Open API Key Manager to replace or test your key.',
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
      'Quota or rate limit exceeded for the current Gemini API key. Switch to another key or select gemini-3.1-flash-lite in API Key Manager.',
      429,
      'RATE_LIMITED'
    );
  }

  if (rawMessage.includes('404') || rawMessage.includes('NOT_FOUND')) {
    return new GeminiConfigError(
      'Selected Gemini model is unavailable for this API key. Choose gemini-3.8-flash or gemini-3.1-flash-lite in API Key Manager.',
      404,
      'MODEL_NOT_FOUND'
    );
  }

  return new GeminiConfigError(
    `Gemini request failed: ${rawMessage.replace(/key=[^&\s]+/gi, 'key=[REDACTED]').slice(0, 260)}`,
    500,
    'GEMINI_REQUEST_FAILED'
  );
}
