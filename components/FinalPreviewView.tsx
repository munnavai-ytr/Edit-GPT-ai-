'use client';

import React, {useEffect, useRef, useState} from 'react';
import {
  Check,
  Cloud,
  Cpu,
  Download,
  Music,
  RefreshCw,
  RotateCcw,
  Sliders,
  Stamp,
  Trash2,
  Upload,
} from 'lucide-react';
import {CAPTION_STYLE_PRESETS, PRESET_LIST} from '@/lib/presets';
import {renderCaptionCueToCanvas} from '@/lib/caption-engine';
import {formatBytes, formatDurationShort, formatTimecode} from '@/lib/format';
import {
  CaptionPosition,
  CaptionStyleConfig,
  CloudJobRecord,
  CropMode,
  EditDecisionList,
  EditingPresetId,
  MediaAssetRole,
  OutputAspectRatio,
  OutputResolution,
  ProjectRecord,
  RenderMode,
} from '@/lib/types';

interface FinalPreviewViewProps {
  project: ProjectRecord;
  videoUrl: string | null;
  cloudJob?: CloudJobRecord | null;
  onRefreshCloudSignedUrl?: () => Promise<void>;
  onUpdateEDL: (updatedEdl: EditDecisionList) => Promise<void>;
  onUploadAuxFile: (role: MediaAssetRole, file: File) => Promise<string | null>;
  onRemoveAuxFile: (assetId: string) => Promise<void>;
  onRerenderVideo: (
    overrideEdl?: EditDecisionList,
    modeOverride?: RenderMode
  ) => Promise<void>;
  onRegeneratePlan: (presetOverride?: EditingPresetId) => Promise<void>;
  isBusy: boolean;
}

export default function FinalPreviewView({
  project,
  videoUrl,
  cloudJob,
  onRefreshCloudSignedUrl,
  onUpdateEDL,
  onUploadAuxFile,
  onRemoveAuxFile,
  onRerenderVideo,
  onRegeneratePlan,
  isBusy,
}: FinalPreviewViewProps) {
  const edl = project.edl;
  const [draftEdl, setDraftEdl] = useState<EditDecisionList | null>(edl ?? null);
  const [selectedPresetForRegen, setSelectedPresetForRegen] =
    useState<EditingPresetId>(project.preset);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState(false);

  const musicInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);
  const sampleCanvasContainerRef = useRef<HTMLDivElement>(null);

  // Live preview of current caption style on a mini canvas
  useEffect(() => {
    if (!draftEdl || !sampleCanvasContainerRef.current) return;
    const container = sampleCanvasContainerRef.current;
    container.innerHTML = '';

    if (!draftEdl.captionStyle.enabled) {
      return;
    }

    const sampleCue = draftEdl.captions[0] || {
      id: 'sample',
      text: 'Automatic AI Captions Ready',
      startTime: 0,
      endTime: 2,
      highlightKeywords: ['AI'],
      words: [
        {word: 'Automatic', startTime: 0, endTime: 0.5, highlight: false},
        {word: 'AI', startTime: 0.5, endTime: 1.0, highlight: true},
        {word: 'Captions', startTime: 1.0, endTime: 1.5, highlight: false},
      ],
    };

    const {canvas} = renderCaptionCueToCanvas({
      cue: sampleCue,
      activeWordIndex: Math.min(1, Math.max(0, sampleCue.words.length - 1)),
      style: draftEdl.captionStyle,
      videoWidth: 540,
      videoHeight: 960,
      scaleFactor: 0.5,
    });
    canvas.className = 'max-w-full h-auto mx-auto';
    container.appendChild(canvas);
  }, [draftEdl]);

  const resolvedVideoSrc = cloudJob?.outputVideoSignedUrl || videoUrl;

  if (!draftEdl) {
    if (cloudJob && cloudJob.outputVideoSignedUrl) {
      const cloudFilename = `${(cloudJob.projectName || 'cloud-short')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')}-${cloudJob.id.slice(-6)}.mp4`;

      return (
        <div className="mx-auto max-w-xl px-4 py-10 space-y-5 pb-28 md:pb-16">
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="text-lg font-bold text-white truncate">
                {cloudJob.projectName}
              </h1>
              <span className="text-xs font-mono text-emerald-400">
                Cloud R2 MP4
              </span>
            </div>

            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-black">
              <video
                key={cloudJob.outputVideoSignedUrl}
                src={cloudJob.outputVideoSignedUrl}
                controls
                playsInline
                className="max-h-[620px] w-auto bg-black"
              />
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <a
                href={cloudJob.outputVideoSignedUrl}
                download={cloudFilename}
                className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500"
              >
                <Download className="h-4 w-4" />
                <span>Download Cloud MP4</span>
              </a>
              {onRefreshCloudSignedUrl && (
                <button
                  type="button"
                  disabled={refreshingUrl}
                  onClick={async () => {
                    setRefreshingUrl(true);
                    try {
                      await onRefreshCloudSignedUrl();
                    } finally {
                      setRefreshingUrl(false);
                    }
                  }}
                  className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 px-4 py-3 text-xs font-medium text-slate-200 hover:bg-slate-800"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshingUrl ? 'animate-spin' : ''}`}
                  />
                  <span>Refresh Signed Link</span>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <p className="text-sm text-slate-400">
          No Edit Decision List is available yet for this project.
        </p>
      </div>
    );
  }

  const updateDraft = (updater: (prev: EditDecisionList) => EditDecisionList) => {
    setDraftEdl((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setHasUnsavedEdits(true);
      return next;
    });
  };

  const handleStylePresetChange = (
    presetKey: CaptionStyleConfig['stylePreset']
  ) => {
    const def = CAPTION_STYLE_PRESETS[presetKey];
    updateDraft((prev) => ({
      ...prev,
      captionStyle: {
        ...prev.captionStyle,
        enabled: true,
        stylePreset: presetKey,
        primaryColor: def.primaryColor,
        highlightColor: def.highlightColor,
        backgroundColor: def.backgroundColor,
        backgroundOpacity: def.backgroundOpacity,
        strokeColor: def.strokeColor,
        strokeWidth: def.strokeWidth,
        fontSize: def.fontSize,
      },
    }));
  };

  const handleGlobalCropChange = (cropMode: CropMode) => {
    updateDraft((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => ({
        ...s,
        cropMode,
      })),
    }));
  };

  const handleApplyAndRerender = async (modeOverride?: RenderMode) => {
    if (!draftEdl) return;
    await onUpdateEDL(draftEdl);
    setHasUnsavedEdits(false);
    await onRerenderVideo(draftEdl, modeOverride);
  };

  const musicAsset = project.assets.find(
    (a) => a.id === draftEdl.audioMix.musicAssetId || a.role === 'music'
  );
  const watermarkAsset = project.assets.find(
    (a) => a.id === draftEdl.watermark.assetId || a.role === 'watermark'
  );

  const safeFilename = `${(draftEdl.projectTitle || project.name || 'ai-short')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ai-short'}-${draftEdl.aspectRatio.replace(':', 'x')}-${draftEdl.resolution}.mp4`;

  const currentCropMode = draftEdl.scenes[0]?.cropMode || 'cover_center';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 pb-28 md:pb-16">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* LEFT COLUMN: Video Player & MP4 Download */}
        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="text-lg font-bold text-white truncate">
                {draftEdl.projectTitle}
              </h1>
              <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                {draftEdl.aspectRatio} · {draftEdl.resolution}
              </span>
            </div>

            {/* Video Container */}
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-black">
              {resolvedVideoSrc ? (
                <video
                  key={resolvedVideoSrc}
                  src={resolvedVideoSrc}
                  controls
                  playsInline
                  className={
                    draftEdl.aspectRatio === '9:16'
                      ? 'max-h-[620px] w-auto aspect-[9/16] bg-black'
                      : draftEdl.aspectRatio === '1:1'
                        ? 'max-h-[460px] w-full aspect-square bg-black'
                        : 'w-full aspect-video bg-black'
                  }
                />
              ) : (
                <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
                  <p className="text-sm font-medium text-slate-300">
                    Video not rendered yet
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Click Re-render Locally or Queue in Cloud to generate the MP4 file.
                  </p>
                </div>
              )}
            </div>

            {/* Metadata Line */}
            {cloudJob?.outputVideoSignedUrl ? (
              <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-emerald-400">
                <span>Private R2 Signed Stream</span>
                <span aria-hidden="true">·</span>
                <span>10m Short-Lived URL</span>
                {onRefreshCloudSignedUrl && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      disabled={refreshingUrl}
                      onClick={async () => {
                        setRefreshingUrl(true);
                        try {
                          await onRefreshCloudSignedUrl();
                        } finally {
                          setRefreshingUrl(false);
                        }
                      }}
                      className="underline text-blue-300 hover:text-white"
                    >
                      {refreshingUrl ? 'Refreshing…' : 'Refresh URL'}
                    </button>
                  </>
                )}
              </div>
            ) : (
              project.renderedVideoMeta && (
                <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-400">
                  <span>H.264 + AAC</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {project.renderedVideoMeta.width}×
                    {project.renderedVideoMeta.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {formatDurationShort(project.renderedVideoMeta.duration)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(project.renderedVideoMeta.sizeBytes)}</span>
                </div>
              )
            )}

            {/* Primary Download MP4 Action */}
            {resolvedVideoSrc && (
              <a
                href={resolvedVideoSrc}
                download={safeFilename}
                className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
              >
                <Download className="h-4 w-4" />
                <span>Download MP4 ({safeFilename})</span>
              </a>
            )}
          </div>

          {/* Scene Timeline Summary */}
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white">
              Rendered Scene Cuts ({draftEdl.scenes.length})
            </h2>
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/70 pr-1">
              {draftEdl.scenes.map((s) => (
                <div
                  key={s.sceneNumber}
                  className="py-2 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-mono tabular-nums text-blue-400 mr-2">
                      {formatTimecode(s.startTime)}–{formatTimecode(s.endTime)}
                    </span>
                    <span className="text-slate-300 truncate">
                      {s.sceneDescription}
                    </span>
                  </div>
                  <span className="text-slate-500 font-mono shrink-0">
                    {s.zoomAnimation.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Post-AI Editing Controls & Re-Render */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-blue-400" />
                  <h2 className="text-lg font-bold text-white">
                    Post-Edit Controls &amp; Export Settings
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  Adjust captions, audio mix, framing, watermark, or output resolution, then re-render your MP4 locally.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleApplyAndRerender('local')}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
                >
                  <Cpu className="h-3.5 w-3.5" />
                  <span>
                    {hasUnsavedEdits
                      ? 'Apply & Render Local'
                      : 'Re-render Local'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleApplyAndRerender('cloud')}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-950/25 px-4 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600 hover:text-white disabled:opacity-50 whitespace-nowrap"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  <span>Queue Cloud Render</span>
                </button>
              </div>
            </div>

            {/* 1. Subtitle Style & Live Caption Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-white">
                  Subtitle Style &amp; Safe-Area Position
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      captionStyle: {
                        ...prev.captionStyle,
                        enabled: !prev.captionStyle.enabled,
                      },
                    }))
                  }
                  className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                    draftEdl.captionStyle.enabled
                      ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  {draftEdl.captionStyle.enabled ? 'Captions Enabled' : 'Captions Off'}
                </button>
              </div>

              {draftEdl.captionStyle.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(
                      Object.keys(CAPTION_STYLE_PRESETS) as Array<
                        CaptionStyleConfig['stylePreset']
                      >
                    ).map((key) => {
                      const active = draftEdl.captionStyle.stylePreset === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleStylePresetChange(key)}
                          className={`min-h-[40px] rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap truncate ${
                            active
                              ? 'border-blue-500 bg-blue-600/20 text-white'
                              : 'border-slate-800 bg-[#080D1A] text-slate-400 hover:text-white'
                          }`}
                        >
                          {CAPTION_STYLE_PRESETS[key].label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Caption Position & Font Size */}
                  <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                    <div>
                      <span className="block text-xs text-slate-400 mb-1.5">
                        Caption Position
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-800 bg-[#080D1A] p-1">
                        {(
                          [
                            {id: 'bottom_safe', label: 'Bottom Safe'},
                            {id: 'middle_center', label: 'Center'},
                            {id: 'upper_third', label: 'Upper Safe'},
                          ] as Array<{id: CaptionPosition; label: string}>
                        ).map((pos) => (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() =>
                              updateDraft((prev) => ({
                                ...prev,
                                captionStyle: {
                                  ...prev.captionStyle,
                                  position: pos.id,
                                },
                              }))
                            }
                            className={`min-h-[34px] rounded-lg px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                              draftEdl.captionStyle.position === pos.id
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {pos.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <span>Caption Size &amp; Highlight Color</span>
                        <span className="font-mono tabular-nums">
                          {draftEdl.captionStyle.fontSize}px
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={36}
                          max={76}
                          step={2}
                          value={draftEdl.captionStyle.fontSize}
                          onChange={(e) =>
                            updateDraft((prev) => ({
                              ...prev,
                              captionStyle: {
                                ...prev.captionStyle,
                                fontSize: Number(e.target.value),
                              },
                            }))
                          }
                          className="w-full accent-blue-500"
                        />
                        <input
                          type="color"
                          aria-label="Highlight keyword color"
                          value={draftEdl.captionStyle.highlightColor}
                          onChange={(e) =>
                            updateDraft((prev) => ({
                              ...prev,
                              captionStyle: {
                                ...prev.captionStyle,
                                highlightColor: e.target.value,
                              },
                            }))
                          }
                          className="h-9 w-11 cursor-pointer rounded border border-slate-700 bg-transparent p-0.5 shrink-0"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live Canvas Preview Strip */}
                  <div className="rounded-xl border border-slate-800/80 bg-[#060B16] p-3">
                    <p className="text-[11px] text-slate-500 mb-1">
                      Live Caption Style Sample
                    </p>
                    <div
                      ref={sampleCanvasContainerRef}
                      className="flex min-h-[64px] items-center justify-center overflow-hidden"
                    />
                  </div>
                </>
              )}
            </div>

            {/* 2. Background Music & Audio Mix Controls */}
            <div className="border-t border-slate-800/80 pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Music className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Background Music &amp; Voiceover Ducking
                  </h3>
                </div>
                <input
                  ref={musicInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const newId = await onUploadAuxFile('music', f);
                      if (newId) {
                        updateDraft((prev) => ({
                          ...prev,
                          audioMix: {
                            ...prev.audioMix,
                            musicAssetId: newId,
                          },
                        }));
                      }
                    }
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => musicInputRef.current?.click()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-blue-400" />
                  <span>{musicAsset ? 'Change Music' : 'Upload Music'}</span>
                </button>
              </div>

              {musicAsset && draftEdl.audioMix.musicAssetId && (
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs">
                  <span className="truncate text-slate-200">
                    Active music: {musicAsset.name}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await onRemoveAuxFile(musicAsset.id);
                      updateDraft((prev) => ({
                        ...prev,
                        audioMix: {
                          ...prev.audioMix,
                          musicAssetId: null,
                        },
                      }));
                    }}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                    <span>Music Volume</span>
                    <span className="font-mono tabular-nums">
                      {Math.round(draftEdl.audioMix.musicVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.02}
                    value={draftEdl.audioMix.musicVolume}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        audioMix: {
                          ...prev.audioMix,
                          musicVolume: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full accent-blue-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 sm:pt-4">
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        audioMix: {
                          ...prev.audioMix,
                          duckingEnabled: !prev.audioMix.duckingEnabled,
                        },
                      }))
                    }
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      draftEdl.audioMix.duckingEnabled
                        ? 'border-blue-500/50 bg-blue-950/25 text-blue-200'
                        : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    {draftEdl.audioMix.duckingEnabled && (
                      <Check className="h-3.5 w-3.5 text-blue-400" />
                    )}
                    <span>Auto Voice Ducking</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        audioMix: {
                          ...prev.audioMix,
                          noiseReduction: !prev.audioMix.noiseReduction,
                        },
                      }))
                    }
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      draftEdl.audioMix.noiseReduction
                        ? 'border-blue-500/50 bg-blue-950/25 text-blue-200'
                        : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    {draftEdl.audioMix.noiseReduction && (
                      <Check className="h-3.5 w-3.5 text-blue-400" />
                    )}
                    <span>Rumble Filter</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Framing, Aspect Ratio, Resolution & Watermark */}
            <div className="border-t border-slate-800/80 pt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* Video Crop Mode */}
              <div>
                <span className="block text-xs font-semibold text-white mb-2">
                  Video Crop &amp; Framing
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      {id: 'cover_center', label: 'Fill Center'},
                      {id: 'cover_top', label: 'Upper Subject'},
                      {id: 'fit_blur', label: 'Fit + Blur BG'},
                      {id: 'cover_bottom', label: 'Lower Subject'},
                    ] as Array<{id: CropMode; label: string}>
                  ).map((cm) => (
                    <button
                      key={cm.id}
                      type="button"
                      onClick={() => handleGlobalCropChange(cm.id)}
                      className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        currentCropMode === cm.id
                          ? 'border-blue-500 bg-blue-600/20 text-white'
                          : 'border-slate-800 bg-[#080D1A] text-slate-400 hover:text-white'
                      }`}
                    >
                      {cm.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio & Output Resolution */}
              <div className="space-y-3">
                <div>
                  <span className="block text-xs font-semibold text-white mb-2">
                    Aspect Ratio &amp; Resolution
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <div className="flex rounded-lg border border-slate-800 bg-[#080D1A] p-1">
                      {(['9:16', '1:1', '16:9'] as OutputAspectRatio[]).map(
                        (ar) => (
                          <button
                            key={ar}
                            type="button"
                            onClick={() =>
                              updateDraft((prev) => ({
                                ...prev,
                                aspectRatio: ar,
                              }))
                            }
                            className={`min-h-[32px] rounded-md px-2.5 text-xs font-mono font-medium ${
                              draftEdl.aspectRatio === ar
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {ar}
                          </button>
                        )
                      )}
                    </div>

                    <div className="flex rounded-lg border border-slate-800 bg-[#080D1A] p-1">
                      {(['1080p', '720p'] as OutputResolution[]).map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() =>
                            updateDraft((prev) => ({
                              ...prev,
                              resolution: res,
                            }))
                          }
                          className={`min-h-[32px] rounded-md px-2.5 text-xs font-mono font-medium ${
                            draftEdl.resolution === res
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Watermark Toggle */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Stamp className="h-4 w-4 text-slate-400" />
                    <span className="text-xs font-medium text-slate-200">
                      Logo Watermark
                    </span>
                  </div>
                  <input
                    ref={watermarkInputRef}
                    type="file"
                    accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const wmId = await onUploadAuxFile('watermark', f);
                        if (wmId) {
                          updateDraft((prev) => ({
                            ...prev,
                            watermark: {
                              ...prev.watermark,
                              enabled: true,
                              assetId: wmId,
                            },
                          }));
                        }
                      }
                      e.target.value = '';
                    }}
                  />
                  {watermarkAsset ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateDraft((prev) => ({
                          ...prev,
                          watermark: {
                            ...prev.watermark,
                            enabled: !prev.watermark.enabled,
                            assetId: watermarkAsset.id,
                          },
                        }))
                      }
                      className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-medium ${
                        draftEdl.watermark.enabled
                          ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {draftEdl.watermark.enabled ? 'Watermark On' : 'Watermark Off'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => watermarkInputRef.current?.click()}
                      className="min-h-[34px] rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Upload Logo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Regenerate AI Editing Plan Card */}
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Regenerate AI Editing Plan
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Want different scene cuts, B-roll selections, or pacing? Pick a preset and let Gemini build a brand-new Edit Decision List from your voiceover.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                aria-label="Select preset for regenerating editing plan"
                value={selectedPresetForRegen}
                onChange={(e) =>
                  setSelectedPresetForRegen(e.target.value as EditingPresetId)
                }
                className="min-h-[42px] flex-1 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
              >
                {PRESET_LIST.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.tagline}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => onRegeneratePlan(selectedPresetForRegen)}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-950/25 px-4 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Regenerate Editing Plan &amp; Render</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
