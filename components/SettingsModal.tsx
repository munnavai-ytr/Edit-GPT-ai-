'use client';

import React, {useCallback, useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {formatBytes} from '@/lib/format';
import {AppSettings, OutputResolution} from '@/lib/types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  deviceMemoryGB: number | null;
  storageStats: {
    projectCount: number;
    totalBytes: number;
    quotaBytes?: number;
  };
  onClearAllStorage: () => Promise<void>;
}

interface ApiStatusState {
  loading: boolean;
  connected: boolean | null;
  latencyMs?: number;
  directorModel?: string;
  transcriptionModel?: string;
  message?: string;
  code?: string;
}

export default function SettingsModal({
  open,
  onClose,
  settings,
  onSaveSettings,
  deviceMemoryGB,
  storageStats,
  onClearAllStorage,
}: SettingsModalProps) {
  const [apiStatus, setApiStatus] = useState<ApiStatusState>({
    loading: false,
    connected: null,
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const checkApiConnection = useCallback(async (model: string) => {
    setApiStatus({loading: true, connected: null});
    try {
      const res = await fetch(
        `/api/gemini/status?model=${encodeURIComponent(model)}`
      );
      const data = await res.json();
      setApiStatus({
        loading: false,
        connected: Boolean(data.connected),
        latencyMs: data.latencyMs,
        directorModel: data.directorModel,
        transcriptionModel: data.transcriptionModel,
        message: data.message,
        code: data.code,
      });
    } catch (err) {
      setApiStatus({
        loading: false,
        connected: false,
        message:
          err instanceof Error
            ? err.message
            : 'Network error reaching server API status route.',
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const runProbe = async () => {
      try {
        const res = await fetch(
          `/api/gemini/status?model=${encodeURIComponent(settings.directorModel)}`
        );
        const data = await res.json();
        if (!cancelled) {
          setApiStatus({
            loading: false,
            connected: Boolean(data.connected),
            latencyMs: data.latencyMs,
            directorModel: data.directorModel,
            transcriptionModel: data.transcriptionModel,
            message: data.message,
            code: data.code,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setApiStatus({
            loading: false,
            connected: false,
            message:
              err instanceof Error
                ? err.message
                : 'Network error reaching server API status route.',
          });
        }
      }
    };
    void runProbe();
    return () => {
      cancelled = true;
    };
  }, [open, settings.directorModel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-800 bg-[#0B1120] p-6 sm:p-7 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white">
            Studio &amp; Gemini API Settings
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 1. Server-Side Gemini API Connection Status */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Server-Side Gemini API Connection
            </h3>
            <button
              type="button"
              disabled={apiStatus.loading}
              onClick={() => checkApiConnection(settings.directorModel)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${apiStatus.loading ? 'animate-spin' : ''}`}
              />
              <span>Test Connection</span>
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#080D1A] p-4 space-y-2">
            {apiStatus.loading ? (
              <div className="flex items-center gap-2.5 text-xs text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                <span>Verifying server-side GEMINI_API_KEY connection...</span>
              </div>
            ) : apiStatus.connected ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Connected · Server Key Active</span>
                  </span>
                  {typeof apiStatus.latencyMs === 'number' && (
                    <span className="font-mono tabular-nums text-slate-400">
                      {apiStatus.latencyMs} ms
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {apiStatus.message} FFmpeg video rendering runs locally and does not consume API quota.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Connection Issue ({apiStatus.code || 'OFFLINE'})</span>
                </div>
                <p className="text-xs text-rose-200/90 leading-relaxed">
                  {apiStatus.message ||
                    'Could not connect to Gemini API. Ensure GEMINI_API_KEY is configured in server environment secrets.'}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* 2. Configurable Gemini Model Identifier */}
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <div>
            <label
              htmlFor="director-model-select"
              className="block text-sm font-semibold text-white"
            >
              AI Editing &amp; Vision Model
            </label>
            <p className="mt-0.5 text-xs text-slate-400">
              Selects the free-tier compatible Gemini model used for visual analysis, script matching, and JSON Edit Decision List generation.
            </p>
          </div>

          <select
            id="director-model-select"
            value={settings.directorModel}
            onChange={(e) =>
              onSaveSettings({
                ...settings,
                directorModel: e.target.value as AppSettings['directorModel'],
              })
            }
            className="w-full min-h-[42px] rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="gemini-3.8-flash">
              gemini-3.8-flash (Recommended · Balanced Reasoning &amp; Vision)
            </option>
            <option value="gemini-3.1-flash-lite">
              gemini-3.1-flash-lite (High-Throughput Lightweight Free Tier)
            </option>
          </select>

          <p className="text-xs font-mono tabular-nums text-slate-400">
            Speech Transcription Model: {settings.transcriptionModel}
          </p>
        </section>

        {/* 3. Mobile & Memory Performance Controls */}
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-white">
                Device Memory &amp; Default Output
              </h3>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {deviceMemoryGB ? `${deviceMemoryGB} GB RAM class` : 'Standard Browser'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#080D1A] p-3.5">
            <div>
              <p className="text-xs font-medium text-white">
                Default Render Resolution
              </p>
              <p className="text-[11px] text-slate-400">
                Use 720p on low-memory phones for faster encoding.
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
                  className={`min-h-[32px] rounded-md px-3 text-xs font-mono font-medium ${
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
                Automatic 720p Memory Recovery
              </p>
              <p className="text-[11px] text-slate-400">
                Automatically retry in 720p if 1080p hits mobile WebAssembly RAM limits.
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

        {/* 4. Local Privacy & Storage */}
        <section className="space-y-3 border-t border-slate-800/80 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-white">
                Local IndexedDB Storage
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
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:border-rose-700 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear All Local Projects &amp; Media</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-rose-300">
                Permanently delete all local files?
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
                className="min-h-[36px] rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                {clearing ? 'Clearing…' : 'Confirm Delete All'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[36px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
