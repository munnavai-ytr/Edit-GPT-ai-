import {
  getActiveDecryptedApiKey,
  getDecryptedApiKeyById,
  updateApiKeyTestResult,
} from './crypto-vault';

/**
 * Builds request headers for AI endpoints using the currently active BYOK key
 * decrypted in-memory. Never places API keys in URLs or console logs.
 */
export async function buildGeminiAuthHeaders(
  explicitRawKey?: string
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const keyToUse =
    explicitRawKey !== undefined
      ? explicitRawKey.trim()
      : await getActiveDecryptedApiKey();

  if (keyToUse) {
    headers['x-gemini-api-key'] = keyToUse;
  }

  return headers;
}

export interface KeyTestResponse {
  connected: boolean;
  keySource: 'byok' | 'server_env' | 'none';
  directorModel: string;
  transcriptionModel: string;
  latencyMs: number;
  code?: string;
  message: string;
}

export async function probeGeminiConnection(params: {
  model: string;
  storedKeyId?: string;
  rawCandidateKey?: string;
}): Promise<KeyTestResponse> {
  let explicitKey: string | undefined;

  if (params.rawCandidateKey !== undefined) {
    explicitKey = params.rawCandidateKey.trim();
  } else if (params.storedKeyId) {
    const decrypted = await getDecryptedApiKeyById(params.storedKeyId);
    if (!decrypted) {
      throw new Error('Could not decrypt stored API key.');
    }
    explicitKey = decrypted;
  }

  const headers = await buildGeminiAuthHeaders(explicitKey);

  const res = await fetch('/api/gemini/status', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
    }),
  });

  const data = (await res.json()) as KeyTestResponse;

  if (params.storedKeyId) {
    const status = data.connected
      ? 'valid'
      : data.code === 'INVALID_API_KEY'
        ? 'invalid'
        : data.code === 'RATE_LIMITED'
          ? 'quota_exceeded'
          : 'error';
    await updateApiKeyTestResult(params.storedKeyId, status, data.message);
  }

  return data;
}
