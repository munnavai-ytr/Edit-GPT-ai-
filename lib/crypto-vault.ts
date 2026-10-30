import {openDB, DBSchema, IDBPDatabase} from 'idb';
import {CloudConnectionSettings, StoredApiKeySummary} from './types';

interface EncryptedApiKeyRecord {
  id: string;
  label: string;
  maskedPreview: string;
  isActive: boolean;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  createdAt: number;
  updatedAt: number;
  lastTestedAt?: number;
  lastTestStatus?: 'valid' | 'invalid' | 'quota_exceeded' | 'error';
  lastTestMessage?: string;
}

interface EncryptedSecretBlobRecord {
  id: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
}

interface CryptoMasterKeyRecord {
  id: 'device_aes_gcm_256';
  key: CryptoKey;
  createdAt: number;
}

interface VaultDB extends DBSchema {
  master_keys: {
    key: 'device_aes_gcm_256';
    value: CryptoMasterKeyRecord;
  };
  api_keys: {
    key: string;
    value: EncryptedApiKeyRecord;
  };
  encrypted_configs: {
    key: string;
    value: EncryptedSecretBlobRecord;
  };
}

const VAULT_DB_NAME = 'ai-shorts-encrypted-vault-v1';
const VAULT_DB_VERSION = 1;
const CLOUD_CONFIG_RECORD_ID = 'cloudflare_connection_v1';

let vaultDbPromise: Promise<IDBPDatabase<VaultDB>> | null = null;

function getVaultDB(): Promise<IDBPDatabase<VaultDB>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Encrypted vault is browser-only.'));
  }
  if (!vaultDbPromise) {
    vaultDbPromise = openDB<VaultDB>(VAULT_DB_NAME, VAULT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('master_keys')) {
          db.createObjectStore('master_keys', {keyPath: 'id'});
        }
        if (!db.objectStoreNames.contains('api_keys')) {
          db.createObjectStore('api_keys', {keyPath: 'id'});
        }
        if (!db.objectStoreNames.contains('encrypted_configs')) {
          db.createObjectStore('encrypted_configs', {keyPath: 'id'});
        }
      },
    });
  }
  return vaultDbPromise;
}

/**
 * Retrieves or generates a non-extractable 256-bit AES-GCM CryptoKey stored
 * inside IndexedDB via structured cloning. Raw key bytes cannot be exported
 * by scripts (`extractable: false`).
 */
async function getOrCreateDeviceMasterKey(): Promise<CryptoKey> {
  const db = await getVaultDB();
  const existing = await db.get('master_keys', 'device_aes_gcm_256');
  if (existing?.key) {
    return existing.key;
  }

  const cryptoKey = await window.crypto.subtle.generateKey(
    {name: 'AES-GCM', length: 256},
    false, // non-extractable
    ['encrypt', 'decrypt']
  );

  await db.put('master_keys', {
    id: 'device_aes_gcm_256',
    key: cryptoKey,
    createdAt: Date.now(),
  });

  return cryptoKey;
}

async function encryptPlaintext(
  plaintext: string
): Promise<{iv: Uint8Array; ciphertext: ArrayBuffer}> {
  const masterKey = await getOrCreateDeviceMasterKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt(
    {name: 'AES-GCM', iv},
    masterKey,
    encoded
  );
  return {iv, ciphertext};
}

async function decryptCiphertext(
  iv: Uint8Array,
  ciphertext: ArrayBuffer
): Promise<string> {
  const masterKey = await getOrCreateDeviceMasterKey();
  const decrypted = await window.crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: new Uint8Array(iv)},
    masterKey,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export function maskApiKeyString(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 4)}••••••••••••${trimmed.slice(-4)}`;
}

function toSummary(rec: EncryptedApiKeyRecord): StoredApiKeySummary {
  return {
    id: rec.id,
    label: rec.label,
    maskedPreview: rec.maskedPreview,
    isActive: rec.isActive,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    lastTestedAt: rec.lastTestedAt,
    lastTestStatus: rec.lastTestStatus,
    lastTestMessage: rec.lastTestMessage,
  };
}

export async function listStoredApiKeys(): Promise<StoredApiKeySummary[]> {
  const db = await getVaultDB();
  const records = await db.getAll('api_keys');
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  return records.map(toSummary);
}

export async function addEncryptedApiKey(params: {
  label: string;
  rawApiKey: string;
  makeActive?: boolean;
}): Promise<StoredApiKeySummary> {
  const cleanKey = params.rawApiKey.trim();
  if (!cleanKey) {
    throw new Error('API key cannot be empty.');
  }

  const db = await getVaultDB();
  const {iv, ciphertext} = await encryptPlaintext(cleanKey);
  const now = Date.now();
  const id = `key_${now}_${Math.random().toString(36).slice(2, 7)}`;

  const existing = await db.getAll('api_keys');
  const shouldActivate = params.makeActive !== false || existing.length === 0;

  const tx = db.transaction('api_keys', 'readwrite');
  if (shouldActivate) {
    for (const item of existing) {
      if (item.isActive) {
        await tx.store.put({...item, isActive: false});
      }
    }
  }

  const record: EncryptedApiKeyRecord = {
    id,
    label: params.label.trim() || `Gemini Key ${existing.length + 1}`,
    maskedPreview: maskApiKeyString(cleanKey),
    isActive: shouldActivate,
    iv,
    ciphertext,
    createdAt: now,
    updatedAt: now,
  };

  await tx.store.put(record);
  await tx.done;

  return toSummary(record);
}

export async function replaceEncryptedApiKey(params: {
  id: string;
  newRawApiKey: string;
  newLabel?: string;
}): Promise<StoredApiKeySummary> {
  const cleanKey = params.newRawApiKey.trim();
  if (!cleanKey) {
    throw new Error('Replacement API key cannot be empty.');
  }

  const db = await getVaultDB();
  const existing = await db.get('api_keys', params.id);
  if (!existing) {
    throw new Error('Target API key record was not found.');
  }

  const {iv, ciphertext} = await encryptPlaintext(cleanKey);
  const updated: EncryptedApiKeyRecord = {
    ...existing,
    label: params.newLabel?.trim() || existing.label,
    maskedPreview: maskApiKeyString(cleanKey),
    iv,
    ciphertext,
    updatedAt: Date.now(),
    lastTestedAt: undefined,
    lastTestStatus: undefined,
    lastTestMessage: undefined,
  };

  await db.put('api_keys', updated);
  return toSummary(updated);
}

export async function setActiveApiKey(id: string): Promise<void> {
  const db = await getVaultDB();
  const all = await db.getAll('api_keys');
  const tx = db.transaction('api_keys', 'readwrite');
  for (const item of all) {
    await tx.store.put({
      ...item,
      isActive: item.id === id,
      updatedAt: item.id === id ? Date.now() : item.updatedAt,
    });
  }
  await tx.done;
}

export async function removeEncryptedApiKey(id: string): Promise<void> {
  const db = await getVaultDB();
  const target = await db.get('api_keys', id);
  await db.delete('api_keys', id);

  if (target?.isActive) {
    const remaining = await db.getAll('api_keys');
    if (remaining.length > 0) {
      remaining.sort((a, b) => b.updatedAt - a.updatedAt);
      await db.put('api_keys', {...remaining[0], isActive: true});
    }
  }
}

export async function updateApiKeyTestResult(
  id: string,
  status: 'valid' | 'invalid' | 'quota_exceeded' | 'error',
  message: string
): Promise<void> {
  const db = await getVaultDB();
  const existing = await db.get('api_keys', id);
  if (!existing) return;
  await db.put('api_keys', {
    ...existing,
    lastTestedAt: Date.now(),
    lastTestStatus: status,
    lastTestMessage: message,
  });
}

/**
 * Decrypts the currently active BYOK Gemini API key strictly in-memory for an AI API request.
 * Never logs or persists plaintext.
 */
export async function getActiveDecryptedApiKey(): Promise<string | null> {
  try {
    const db = await getVaultDB();
    const all = await db.getAll('api_keys');
    const active = all.find((k) => k.isActive) || all[0];
    if (!active) return null;
    return await decryptCiphertext(active.iv, active.ciphertext);
  } catch {
    return null;
  }
}

export async function getDecryptedApiKeyById(id: string): Promise<string | null> {
  try {
    const db = await getVaultDB();
    const rec = await db.get('api_keys', id);
    if (!rec) return null;
    return await decryptCiphertext(rec.iv, rec.ciphertext);
  } catch {
    return null;
  }
}

// --- ENCRYPTED CLOUDFLARE R2 / D1 / QUEUES CONNECTION SETTINGS ---
export async function saveEncryptedCloudConfig(
  config: CloudConnectionSettings
): Promise<void> {
  const db = await getVaultDB();
  const payload = JSON.stringify(config);
  const {iv, ciphertext} = await encryptPlaintext(payload);
  await db.put('encrypted_configs', {
    id: CLOUD_CONFIG_RECORD_ID,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function loadEncryptedCloudConfig(): Promise<CloudConnectionSettings | null> {
  try {
    const db = await getVaultDB();
    const rec = await db.get('encrypted_configs', CLOUD_CONFIG_RECORD_ID);
    if (!rec) return null;
    const json = await decryptCiphertext(rec.iv, rec.ciphertext);
    return JSON.parse(json) as CloudConnectionSettings;
  } catch {
    return null;
  }
}

export async function clearEncryptedCloudConfig(): Promise<void> {
  const db = await getVaultDB();
  await db.delete('encrypted_configs', CLOUD_CONFIG_RECORD_ID);
}
