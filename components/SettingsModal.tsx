'use client';

import React, {useCallback, useEffect, useState} from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  addEncryptedApiKey,
  clearEncryptedCloudConfig,
  listStoredApiKeys,
  loadEncryptedCloudConfig,
  removeEncryptedApiKey,
  replaceEncryptedApiKey,
  saveEncryptedCloudConfig,
  setActiveApiKey,
} from '@/lib/crypto-vault';
import {
  checkCloudInfrastructureStatus,
  CloudInfrastructureStatus,
} from '@/lib/cloud-client';
import {formatBytes, formatRelativeDate} from '@/lib/format';
import {probeGeminiConnection} from '@/lib/gemini-client';
import {
  AppSettings,
  CloudConnectionSettings,
  OutputResolution,
  RenderMode,
  StoredApiKeySummary,
} from '@/lib/types';

export type SettingsModalTab = 'keys' | 'cloud' | 'device';

interface SettingsModalProps {
  open: boolean;
  initialTab?: SettingsModalTab;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onKeysOrCloudChanged?: () => void;
  deviceMemoryGB: number | null;
  storageStats: {
    projectCount: number;
    totalBytes: number;
    quotaBytes?: number;
  };
  onClearAllStorage: () => Promise<void>;
}

interface ActiveConnectionState {
  loading: boolean;
  connected: boolean | null;
  keySource?: 'byok' | 'server_env' | 'none';
  latencyMs?: number;
  directorModel?: string;
  transcriptionModel?: string;
  code?: string;
  message?: string;
}

const PRESET_MODELS = [
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash · Balanced Multimodal & Reasoning (Recommended)',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite · High-Quota Fast Free Tier',
  },
  {
    id: 'gemini-flash-latest',
    label: 'gemini-flash-latest · Rolling Flash Alias',
  },
  {
    id: 'gemini-4-argon',
    label: 'gemini-4-argon · Deep Pro Reasoning (Paid BYOK Key)',
  },
];

const EMPTY_CLOUD_FORM: CloudConnectionSettings = {
  cfAccountId: '',
  cfApiToken: '',
  cfD1DatabaseId: '',
  cfQueueId: '',
  r2AccountId: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2BucketName: '',
  workerWakeUrl: '',
  workerSharedSecret: '',
};

export default function SettingsModal({
  open,
  initialTab = 'keys',
  onClose,
  settings,
  onSaveSettings,
  onKeysOrCloudChanged,
  deviceMemoryGB,
  storageStats,
  onClearAllStorage,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsModalTab>(initialTab);

  // --- BYOK API Keys State ---
  const [storedKeys, setStoredKeys] = useState<StoredApiKeySummary[]>([]);
  const [apiStatus, setApiStatus] = useState<ActiveConnectionState>({
    loading: false,
    connected: null,
  });

  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newRawKey, setNewRawKey] = useState('');
  const [revealNewKey, setRevealNewKey] = useState(false);
  const [keyActionBusy, setKeyActionBusy] = useState<string | null>(null);
  const [keyFormFeedback, setKeyFormFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState('');
  const [confirmRemoveKeyId, setConfirmRemoveKeyId] = useState<string | null>(
    null
  );

  // Custom Model Input Override
  const [customModelDraft, setCustomModelDraft] = useState(
    settings.directorModel
  );

  // --- Cloud Config State ---
  const [cloudForm, setCloudForm] =
    useState<CloudConnectionSettings>(EMPTY_CLOUD_FORM);
  const [hasSavedLocalCloudConfig, setHasSavedLocalCloudConfig] =
    useState(false);
  const [cloudStatus, setCloudStatus] =
    useState<CloudInfrastructureStatus | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudFeedback, setCloudFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // --- Local Storage Clear State ---
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refreshVaultAndStatus = useCallback(
    async (modelToTest: string) => {
      try {
        const keys = await listStoredApiKeys();
        setStoredKeys(keys);

        const activeKey = keys.find((k) => k.isActive);
        const res = await probeGeminiConnection({
          model: modelToTest,
          storedKeyId: activeKey?.id,
        });

        // Reload key list so updated test timestamp/status reflects immediately
        const updatedKeys = await listStoredApiKeys();
        setStoredKeys(updatedKeys);

        setApiStatus({
          loading: false,
          connected: res.connected,
          keySource: res.keySource,
          latencyMs: res.latencyMs,
          directorModel: res.directorModel,
          transcriptionModel: res.transcriptionModel,
          code: res.code,
          message: res.message,
        });
      } catch (err) {
        setApiStatus({
          loading: false,
          connected: false,
          code: 'NETWORK_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Could not reach Gemini API verification endpoint.',
        });
      }
    },
    []
  );

  const refreshCloudDiagnostics = useCallback(
    async (explicitCfg?: CloudConnectionSettings | null) => {
      setCloudLoading(true);
      try {
        const status = await checkCloudInfrastructureStatus(explicitCfg);
        setCloudStatus(status);
      } catch (err) {
        setCloudFeedback({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Failed checking cloud status.',
        });
      } finally {
        setCloudLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const hydrateAsync = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setActiveTab(initialTab);
      setCustomModelDraft(settings.directorModel);
      setKeyFormFeedback(null);
      setCloudFeedback(null);
      setApiStatus((prev) => ({...prev, loading: true}));

      const savedCloud = await loadEncryptedCloudConfig();
      if (!cancelled) {
        if (savedCloud) {
          setCloudForm(savedCloud);
          setHasSavedLocalCloudConfig(true);
        } else {
          setCloudForm(EMPTY_CLOUD_FORM);
          setHasSavedLocalCloudConfig(false);
        }
      }

      await refreshVaultAndStatus(settings.directorModel);
      if (!cancelled) {
        await refreshCloudDiagnostics(savedCloud);
      }
    };

    void hydrateAsync();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    initialTab,
    settings.directorModel,
    refreshVaultAndStatus,
    refreshCloudDiagnostics,
  ]);

  if (!open) return null;

  const handleTestCandidateKey = async () => {
    const trimmed = newRawKey.trim();
    if (!trimmed) {
      setKeyFormFeedback({
        type: 'error',
        text: 'Enter a Gemini API key first to test it.',
      });
      return;
    }

    setKeyActionBusy('test_candidate');
    setKeyFormFeedback(null);
    try {
      const res = await probeGeminiConnection({
        model: settings.directorModel,
        rawCandidateKey: trimmed,
      });
      if (res.connected) {
        setKeyFormFeedback({
          type: 'success',
          text: `Key verified (${res.latencyMs} ms) with model ${res.directorModel}. Click Encrypt & Save Key to store it.`,
        });
      } else {
        setKeyFormFeedback({
          type: 'error',
          text: res.message,
        });
      }
    } catch (err) {
      setKeyFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Key test failed.',
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRawKey.trim();
    if (!trimmed) {
      setKeyFormFeedback({
        type: 'error',
        text: 'API key cannot be empty.',
      });
      return;
    }

    setKeyActionBusy('add_key');
    setKeyFormFeedback(null);
    try {
      const added = await addEncryptedApiKey({
        label: newKeyLabel,
        rawApiKey: trimmed,
        makeActive: true,
      });
      // Immediately wipe plaintext from React state
      setNewRawKey('');
      setNewKeyLabel('');
      setRevealNewKey(false);

      const probe = await probeGeminiConnection({
        model: settings.directorModel,
        storedKeyId: added.id,
      });
      await refreshVaultAndStatus(settings.directorModel);
      onKeysOrCloudChanged?.();

      setKeyFormFeedback({
        type: probe.connected ? 'success' : 'error',
        text: probe.connected
          ? `Encrypted and activated "${added.label}". All new AI requests now use this key.`
          : `Saved "${added.label}", but verification reported: ${probe.message}`,
      });
    } catch (err) {
      setKeyFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed storing API key.',
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleActivateStoredKey = async (id: string) => {
    setKeyActionBusy(id);
    setKeyFormFeedback(null);
    try {
      await setActiveApiKey(id);
      await refreshVaultAndStatus(settings.directorModel);
      onKeysOrCloudChanged?.();
      setKeyFormFeedback({
        type: 'success',
        text: 'Switched active Gemini API key. Subsequent AI requests immediately use the selected key.',
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleTestStoredKey = async (id: string) => {
    setKeyActionBusy(`test_${id}`);
    setKeyFormFeedback(null);
    try {
      const res = await probeGeminiConnection({
        model: settings.directorModel,
        storedKeyId: id,
      });
      const updated = await listStoredApiKeys();
      setStoredKeys(updated);
      if (updated.find((k) => k.id === id)?.isActive) {
        setApiStatus({
          loading: false,
          connected: res.connected,
          keySource: res.keySource,
          latencyMs: res.latencyMs,
          directorModel: res.directorModel,
          transcriptionModel: res.transcriptionModel,
          code: res.code,
          message: res.message,
        });
      }
      setKeyFormFeedback({
        type: res.connected ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleReplaceStoredKey = async (id: string) => {
    if (!replaceValue.trim()) return;
    setKeyActionBusy(`replace_${id}`);
    setKeyFormFeedback(null);
    try {
      await replaceEncryptedApiKey({
        id,
        newRawApiKey: replaceValue.trim(),
      });
      setReplaceValue('');
      setReplacingId(null);
      await probeGeminiConnection({
        model: settings.directorModel,
        storedKeyId: id,
      });
      await refreshVaultAndStatus(settings.directorModel);
      onKeysOrCloudChanged?.();
      setKeyFormFeedback({
        type: 'success',
        text: 'API key replaced and re-encrypted in IndexedDB.',
      });
    } catch (err) {
      setKeyFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed replacing key.',
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleRemoveStoredKey = async (id: string) => {
    setKeyActionBusy(`del_${id}`);
    setKeyFormFeedback(null);
    try {
      await removeEncryptedApiKey(id);
      setConfirmRemoveKeyId(null);
      await refreshVaultAndStatus(settings.directorModel);
      onKeysOrCloudChanged?.();
      setKeyFormFeedback({
        type: 'success',
        text: 'Removed API key from encrypted IndexedDB vault.',
      });
    } finally {
      setKeyActionBusy(null);
    }
  };

  const handleSaveCloudSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloudLoading(true);
    setCloudFeedback(null);
    try {
      const normalized: CloudConnectionSettings = {
        cfAccountId: cloudForm.cfAccountId.trim(),
        cfApiToken: cloudForm.cfApiToken.trim(),
        cfD1DatabaseId: cloudForm.cfD1DatabaseId.trim(),
        cfQueueId: cloudForm.cfQueueId.trim(),
        r2AccountId:
          cloudForm.r2AccountId.trim() || cloudForm.cfAccountId.trim(),
        r2AccessKeyId: cloudForm.r2AccessKeyId.trim(),
        r2SecretAccessKey: cloudForm.r2SecretAccessKey.trim(),
        r2BucketName: cloudForm.r2BucketName.trim(),
        workerWakeUrl: cloudForm.workerWakeUrl?.trim() || undefined,
        workerSharedSecret: cloudForm.workerSharedSecret?.trim() || undefined,
      };
      await saveEncryptedCloudConfig(normalized);
      setCloudForm(normalized);
      setHasSavedLocalCloudConfig(true);
      const status = await checkCloudInfrastructureStatus(normalized);
      setCloudStatus(status);
      onKeysOrCloudChanged?.();

      setCloudFeedback({
        type: status.ready ? 'success' : 'error',
        text: status.ready
          ? 'Encrypted Cloud R2, D1, and Queue credentials verified and saved locally.'
          : 'Saved encrypted credentials, but one or more Cloudflare checks reported an error below.',
      });
    } catch (err) {
      setCloudFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed saving encrypted cloud configuration.',
      });
    } finally {
      setCloudLoading(false);
    }
  };

  const handleClearCloudOverrides = async () => {
    setCloudLoading(true);
    setCloudFeedback(null);
    try {
      await clearEncryptedCloudConfig();
      setCloudForm(EMPTY_CLOUD_FORM);
      setHasSavedLocalCloudConfig(false);
      const status = await checkCloudInfrastructureStatus(null);
      setCloudStatus(status);
      onKeysOrCloudChanged?.();
      setCloudFeedback({
        type: 'success',
        text: 'Cleared browser-stored cloud credentials. Falling back to server environment variables if configured.',
      });
    } finally {
      setCloudLoading(false);
    }
  };

  const isPresetModel = PRESET_MODELS.some(
    (m) => m.id === settings.directorModel
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0B1120] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 sm:px-7">
          <div>
            <h2
              id="settings-modal-title"
              className="text-lg font-bold text-white"
            >
              API Key Manager &amp; Studio Architecture
            </h2>
            <p className="text-xs text-slate-400">
              Private single-user BYOK vault · Local FFmpeg.wasm &amp; Cloudflare R2/D1/Queue rendering
            </p>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="grid grid-cols-3 border-b border-slate-800 bg-[#080D1A] px-3 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'keys'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            <span>BYOK API Keys</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('cloud')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'cloud'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="h-3.5 w-3.5 shrink-0" />
            <span>Cloud Render</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('device')}
            className={`flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'device'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span>Device &amp; Storage</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
          {activeTab === 'keys' && (
            <>
              {/* Live Connection Status */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">
                    Active Gemini API Connection Status
                  </h3>
                  <button
                    type="button"
                    disabled={apiStatus.loading}
                    onClick={() => {
                      setApiStatus((prev) => ({...prev, loading: true}));
                      void refreshVaultAndStatus(settings.directorModel);
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        apiStatus.loading ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Test Active Connection</span>
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#080D1A] p-4 space-y-2">
                  {apiStatus.loading ? (
                    <div className="flex items-center gap-2.5 text-xs text-slate-300">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                      <span>Testing Gemini API key &amp; selected model...</span>
                    </div>
                  ) : apiStatus.connected ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>
                            Connected ·{' '}
                            {apiStatus.keySource === 'byok'
                              ? 'Active BYOK Key (AES-GCM Encrypted Vault)'
                              : 'Server Environment Key Fallback'}
                          </span>
                        </span>
                        {typeof apiStatus.latencyMs === 'number' && (
                          <span className="font-mono tabular-nums text-slate-400">
                            {apiStatus.latencyMs} ms · {apiStatus.directorModel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        AI requests are strictly isolated from local and cloud FFmpeg video rendering.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          {apiStatus.code === 'INVALID_API_KEY'
                            ? 'Invalid API Key Rejected (HTTP 403)'
                            : apiStatus.code === 'RATE_LIMITED'
                              ? 'API Quota / Rate Limit Reached (HTTP 429)'
                              : apiStatus.code === 'MISSING_API_KEY'
                                ? 'No Gemini API Key Configured'
                                : `Connection Error (${apiStatus.code || 'OFFLINE'})`}
                        </span>
                      </div>
                      <p className="text-xs text-rose-200/90 leading-relaxed">
                        {apiStatus.message ||
                          'Add a valid Gemini API key below or switch to another stored key.'}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Feedback Banner */}
              {keyFormFeedback && (
                <div
                  className={`rounded-xl border px-4 py-3 text-xs ${
                    keyFormFeedback.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                  }`}
                >
                  {keyFormFeedback.text}
                </div>
              )}

              {/* Stored Encrypted Keys List */}
              <section className="space-y-3 border-t border-slate-800/80 pt-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    Encrypted BYOK Keys ({storedKeys.length})
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    IndexedDB · AES-GCM 256-bit
                  </span>
                </div>

                {storedKeys.length === 0 ? (
                  <div className="rounded-xl border border-slate-800/80 bg-[#080D1A] p-4 text-xs text-slate-400">
                    No personal BYOK keys stored in browser vault yet. Add a Gemini API key below to override any server key at any time.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-[#080D1A]">
                    {storedKeys.map((k) => (
                      <div key={k.id} className="p-4 space-y-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              <span className="text-sm font-semibold text-white truncate">
                                {k.label}
                              </span>
                              {k.isActive && (
                                <span className="text-xs font-semibold text-emerald-400">
                                  · Active for AI Requests
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-400">
                              <span>{k.maskedPreview}</span>
                              {k.lastTestStatus && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={
                                      k.lastTestStatus === 'valid'
                                        ? 'text-emerald-400'
                                        : k.lastTestStatus === 'quota_exceeded'
                                          ? 'text-amber-400'
                                          : 'text-rose-400'
                                    }
                                  >
                                    {k.lastTestStatus === 'valid'
                                      ? 'Verified'
                                      : k.lastTestStatus === 'quota_exceeded'
                                        ? 'Quota Limit'
                                        : k.lastTestStatus === 'invalid'
                                          ? 'Invalid Key'
                                          : 'Test Error'}
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>Updated {formatRelativeDate(k.updatedAt)}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {!k.isActive && (
                              <button
                                type="button"
                                disabled={keyActionBusy !== null}
                                onClick={() => handleActivateStoredKey(k.id)}
                                className="min-h-[36px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
                              >
                                Use Key
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={keyActionBusy !== null}
                              onClick={() => handleTestStoredKey(k.id)}
                              className="min-h-[36px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                            >
                              {keyActionBusy === `test_${k.id}`
                                ? 'Testing…'
                                : 'Test'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReplacingId(
                                  replacingId === k.id ? null : k.id
                                );
                                setReplaceValue('');
                              }}
                              className="min-h-[36px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                            >
                              Replace
                            </button>

                            {confirmRemoveKeyId === k.id ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={keyActionBusy !== null}
                                  onClick={() => handleRemoveStoredKey(k.id)}
                                  className="min-h-[36px] rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveKeyId(null)}
                                  className="min-h-[36px] rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Remove ${k.label}`}
                                onClick={() => setConfirmRemoveKeyId(k.id)}
                                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:border-rose-800 hover:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {replacingId === k.id && (
                          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800 sm:flex-row">
                            <input
                              type="password"
                              autoComplete="off"
                              value={replaceValue}
                              onChange={(e) => setReplaceValue(e.target.value)}
                              placeholder="Paste replacement Gemini API key..."
                              className="min-h-[38px] flex-1 rounded-lg border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={
                                !replaceValue.trim() || keyActionBusy !== null
                              }
                              onClick={() => handleReplaceStoredKey(k.id)}
                              className="min-h-[38px] rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
                            >
                              Save Replacement
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Add New Encrypted Key Form */}
              <form
                onSubmit={handleAddKey}
                className="space-y-3 border-t border-slate-800/80 pt-5"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white">
                    Add New Gemini API Key
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <label
                      htmlFor="byok-label-input"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Key Label
                    </label>
                    <input
                      id="byok-label-input"
                      type="text"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      placeholder="e.g., Personal Paid Key"
                      className="w-full min-h-[40px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-8">
                    <label
                      htmlFor="byok-secret-input"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Gemini API Key (Masked by Default)
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="byok-secret-input"
                        type={revealNewKey ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        value={newRawKey}
                        onChange={(e) => setNewRawKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full min-h-[40px] rounded-xl border border-slate-800 bg-[#080D1A] pl-3 pr-10 py-2 text-xs font-mono text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-label={
                          revealNewKey ? 'Mask API key' : 'Reveal API key'
                        }
                        onClick={() => setRevealNewKey((v) => !v)}
                        className="absolute right-2 p-1.5 text-slate-400 hover:text-white"
                      >
                        {revealNewKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-slate-400 max-w-md">
                    Keys are encrypted locally in IndexedDB with Web Crypto AES-GCM and never exposed in client logs, URLs, or FFmpeg workers.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!newRawKey.trim() || keyActionBusy !== null}
                      onClick={handleTestCandidateKey}
                      className="min-h-[40px] rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {keyActionBusy === 'test_candidate'
                        ? 'Testing…'
                        : 'Test Key'}
                    </button>
                    <button
                      type="submit"
                      disabled={!newRawKey.trim() || keyActionBusy !== null}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Encrypt &amp; Save Key</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Model Selection */}
              <section className="space-y-3 border-t border-slate-800/80 pt-5">
                <div>
                  <label
                    htmlFor="director-model-select"
                    className="block text-sm font-semibold text-white"
                  >
                    Gemini Model Selection
                  </label>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Choose a preset Gemini model or enter a custom model ID for visual scene analysis and Edit Decision List planning.
                  </p>
                </div>

                <select
                  id="director-model-select"
                  value={isPresetModel ? settings.directorModel : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      setCustomModelDraft(e.target.value);
                      onSaveSettings({
                        ...settings,
                        directorModel: e.target.value,
                      });
                    }
                  }}
                  className="w-full min-h-[42px] rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
                >
                  {PRESET_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {!isPresetModel && (
                    <option value="__custom__">
                      Custom Model: {settings.directorModel}
                    </option>
                  )}
                </select>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={customModelDraft}
                    onChange={(e) => setCustomModelDraft(e.target.value)}
                    placeholder="Or enter custom Gemini model ID (e.g., gemini-3.8-flash)"
                    className="min-h-[38px] flex-1 rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={
                      !customModelDraft.trim() ||
                      customModelDraft.trim() === settings.directorModel
                    }
                    onClick={() =>
                      onSaveSettings({
                        ...settings,
                        directorModel: customModelDraft.trim(),
                      })
                    }
                    className="min-h-[38px] rounded-xl border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    Apply Model
                  </button>
                </div>

                <p className="text-xs font-mono tabular-nums text-slate-400">
                  Dedicated Speech Transcription Model:{' '}
                  {settings.transcriptionModel}
                </p>
              </section>
            </>
          )}

          {activeTab === 'cloud' && (
            <>
              {/* Live Cloud Infrastructure Diagnostics */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Cloud Background Rendering Diagnostics
                    </h3>
                    <p className="text-xs text-slate-400">
                      Cloudflare R2 (private media) · D1 (persistent jobs) · Queues · Separate FFmpeg Worker
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={cloudLoading}
                    onClick={() => void refreshCloudDiagnostics()}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        cloudLoading ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Verify Cloud Infrastructure</span>
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#080D1A] p-4 space-y-3">
                  {cloudLoading && !cloudStatus ? (
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                      <span>Probing Cloudflare R2, D1, Queues, and Worker heartbeat...</span>
                    </div>
                  ) : cloudStatus ? (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                      <div className="rounded-lg border border-slate-800/90 bg-[#0B1120] p-3 space-y-1">
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-slate-200">Private R2 Storage</span>
                          <span
                            className={
                              cloudStatus.r2.ok
                                ? 'text-emerald-400'
                                : 'text-slate-500'
                            }
                          >
                            {cloudStatus.r2.ok ? 'Connected' : 'Unconfigured'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {cloudStatus.r2.message}
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-800/90 bg-[#0B1120] p-3 space-y-1">
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-slate-200">Cloudflare D1 Jobs DB</span>
                          <span
                            className={
                              cloudStatus.d1.ok
                                ? 'text-emerald-400'
                                : 'text-slate-500'
                            }
                          >
                            {cloudStatus.d1.ok ? 'Connected' : 'Unconfigured'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {cloudStatus.d1.message}
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-800/90 bg-[#0B1120] p-3 space-y-1">
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-slate-200">Cloudflare Queues</span>
                          <span
                            className={
                              cloudStatus.queue.ok
                                ? 'text-emerald-400'
                                : 'text-slate-500'
                            }
                          >
                            {cloudStatus.queue.ok ? 'Connected' : 'Unconfigured'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {cloudStatus.queue.message}
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-800/90 bg-[#0B1120] p-3 space-y-1">
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-slate-200">FFmpeg Worker Server</span>
                          <span
                            className={
                              cloudStatus.worker.status === 'online'
                                ? 'text-emerald-400'
                                : cloudStatus.worker.status === 'stale'
                                  ? 'text-amber-400'
                                  : 'text-slate-400'
                            }
                          >
                            {cloudStatus.worker.status === 'online'
                              ? 'Online'
                              : cloudStatus.worker.status === 'stale'
                                ? 'Idle / Stale'
                                : 'Standby'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {cloudStatus.worker.message}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              {cloudFeedback && (
                <div
                  className={`rounded-xl border px-4 py-3 text-xs ${
                    cloudFeedback.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                  }`}
                >
                  {cloudFeedback.text}
                </div>
              )}

              {/* Encrypted Cloud Credentials Form */}
              <form
                onSubmit={handleSaveCloudSettings}
                className="space-y-4 border-t border-slate-800/80 pt-5"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">
                      Optional Cloudflare R2, D1 &amp; Queues Connection
                    </h3>
                    {hasSavedLocalCloudConfig && (
                      <span className="text-[11px] font-mono text-emerald-400">
                        Encrypted in Browser Vault
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Configure via server environment variables or save encrypted credentials below. Cloud rendering is optional—Local FFmpeg.wasm works without any cloud account.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Cloudflare Account ID (CF_ACCOUNT_ID)
                    </label>
                    <input
                      type="text"
                      value={cloudForm.cfAccountId}
                      onChange={(e) =>
                        setCloudForm((p) => ({...p, cfAccountId: e.target.value}))
                      }
                      placeholder="32-char Account ID"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Cloudflare API Token (D1 + Queues Edit)
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={cloudForm.cfApiToken}
                      onChange={(e) =>
                        setCloudForm((p) => ({...p, cfApiToken: e.target.value}))
                      }
                      placeholder="Masked API Token"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      D1 Database UUID (CF_D1_DATABASE_ID)
                    </label>
                    <input
                      type="text"
                      value={cloudForm.cfD1DatabaseId}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          cfD1DatabaseId: e.target.value,
                        }))
                      }
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Cloudflare Queue ID (CF_QUEUE_ID)
                    </label>
                    <input
                      type="text"
                      value={cloudForm.cfQueueId}
                      onChange={(e) =>
                        setCloudForm((p) => ({...p, cfQueueId: e.target.value}))
                      }
                      placeholder="32-char Queue ID"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Private R2 Bucket Name (R2_BUCKET_NAME)
                    </label>
                    <input
                      type="text"
                      value={cloudForm.r2BucketName}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          r2BucketName: e.target.value,
                        }))
                      }
                      placeholder="ai-shorts-private"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      R2 Account ID (Defaults to CF Account ID)
                    </label>
                    <input
                      type="text"
                      value={cloudForm.r2AccountId}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          r2AccountId: e.target.value,
                        }))
                      }
                      placeholder="Optional if same account"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      R2 S3 Access Key ID
                    </label>
                    <input
                      type="text"
                      value={cloudForm.r2AccessKeyId}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          r2AccessKeyId: e.target.value,
                        }))
                      }
                      placeholder="R2 Access Key ID"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      R2 S3 Secret Access Key
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={cloudForm.r2SecretAccessKey}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          r2SecretAccessKey: e.target.value,
                        }))
                      }
                      placeholder="Masked R2 Secret Key"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Optional Worker Wake URL
                    </label>
                    <input
                      type="url"
                      value={cloudForm.workerWakeUrl || ''}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          workerWakeUrl: e.target.value,
                        }))
                      }
                      placeholder="https://my-ffmpeg-worker.example.com/wake"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Optional Worker Wake Secret
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={cloudForm.workerSharedSecret || ''}
                      onChange={(e) =>
                        setCloudForm((p) => ({
                          ...p,
                          workerSharedSecret: e.target.value,
                        }))
                      }
                      placeholder="Shared secret header"
                      className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-[#080D1A] px-3 py-1.5 text-xs font-mono text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  {hasSavedLocalCloudConfig ? (
                    <button
                      type="button"
                      disabled={cloudLoading}
                      onClick={handleClearCloudOverrides}
                      className="min-h-[40px] rounded-xl border border-slate-800 px-3.5 py-2 text-xs text-slate-300 hover:border-rose-800 hover:text-rose-300"
                    >
                      Clear Browser Cloud Credentials
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      Private R2 signed URLs expire automatically after 10 minutes.
                    </span>
                  )}

                  <button
                    type="submit"
                    disabled={cloudLoading}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Save &amp; Verify Cloud Config</span>
                  </button>
                </div>
              </form>

              {/* Separate FFmpeg Worker Note */}
              <div className="rounded-xl border border-slate-800 bg-[#080D1A] p-4 space-y-1.5 text-xs text-slate-400">
                <div className="flex items-center gap-2 font-semibold text-slate-200">
                  <Server className="h-4 w-4 text-blue-400 shrink-0" />
                  <span>Standalone Long-Running FFmpeg Worker (`/cloud-worker`)</span>
                </div>
                <p className="leading-relaxed">
                  Large video rendering never runs inside Vercel Serverless Functions. Run the included Docker worker (`./cloud-worker/Dockerfile`) on any VPS, home server, Railway, or Fly.io instance—it pulls validated EDL manifests from Cloudflare Queues without ever receiving your Gemini API key.
                </p>
              </div>
            </>
          )}

          {activeTab === 'device' && (
            <>
              {/* Default Rendering Mode */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Default Rendering Mode
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      {
                        id: 'local',
                        title: 'Local Browser (FFmpeg.wasm)',
                        desc: 'Zero cloud cost. Keep browser active while encoding.',
                      },
                      {
                        id: 'cloud',
                        title: 'Cloud Background (R2 + Worker)',
                        desc: 'Close Chrome or turn off phone once queued.',
                      },
                    ] as Array<{id: RenderMode; title: string; desc: string}>
                  ).map((mode) => {
                    const active = settings.defaultRenderMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          onSaveSettings({
                            ...settings,
                            defaultRenderMode: mode.id,
                          })
                        }
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          active
                            ? 'border-blue-500 bg-blue-950/20'
                            : 'border-slate-800 bg-[#080D1A] hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-white">
                          <span>{mode.title}</span>
                          {active && (
                            <Check className="h-4 w-4 text-blue-400 shrink-0" />
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {mode.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Memory & Resolution */}
              <section className="space-y-3 border-t border-slate-800/80 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Device Memory &amp; Output Resolution
                    </h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {deviceMemoryGB
                      ? `${deviceMemoryGB} GB RAM class`
                      : 'Standard Browser'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#080D1A] p-3.5">
                  <div>
                    <p className="text-xs font-medium text-white">
                      Default Output Resolution
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Use 720p on low-memory phones during local FFmpeg.wasm rendering.
                    </p>
                  </div>
                  <div className="flex rounded-lg border border-slate-800 bg-[#0B1120] p-1 shrink-0">
                    {(['1080p', '720p'] as OutputResolution[]).map((res) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() =>
                          onSaveSettings({
                            ...settings,
                            defaultResolution: res,
                          })
                        }
                        className={`min-h-[34px] rounded-md px-3 text-xs font-mono font-medium ${
                          settings.defaultResolution === res
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#080D1A] p-3.5 cursor-pointer">
                  <div>
                    <p className="text-xs font-medium text-white">
                      Automatic 720p Memory Recovery (Local Mode)
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Automatically retry in 720p if 1080p exceeds mobile WebAssembly memory limits.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoLowMemoryFallback}
                    onChange={(e) =>
                      onSaveSettings({
                        ...settings,
                        autoLowMemoryFallback: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>
              </section>

              {/* Local IndexedDB Storage */}
              <section className="space-y-3 border-t border-slate-800/80 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Local IndexedDB Project Storage
                    </h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {storageStats.projectCount} projects ·{' '}
                    {formatBytes(storageStats.totalBytes)}
                  </span>
                </div>

                {!confirmClear ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:border-rose-700 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clear All Local Projects &amp; Media</span>
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-rose-300">
                      Permanently delete all local projects &amp; media blobs? (Encrypted API keys are kept.)
                    </span>
                    <button
                      type="button"
                      disabled={clearing}
                      onClick={async () => {
                        setClearing(true);
                        try {
                          await onClearAllStorage();
                        } finally {
                          setClearing(false);
                          setConfirmClear(false);
                        }
                      }}
                      className="min-h-[38px] rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                    >
                      {clearing ? 'Clearing…' : 'Confirm Delete All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="min-h-[38px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
