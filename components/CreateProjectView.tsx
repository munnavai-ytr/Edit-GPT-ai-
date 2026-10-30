'use client';

import React, {useRef, useState} from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  FileAudio,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Play,
  Sliders,
  Stamp,
  Trash2,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';
import {PRESET_LIST} from '@/lib/presets';
import {formatBytes} from '@/lib/format';
import {
  EditingPresetId,
  MediaAssetMeta,
  MediaAssetRole,
  OutputAspectRatio,
  OutputResolution,
} from '@/lib/types';

interface CreateProjectViewProps {
  projectName: string;
  onChangeProjectName: (val: string) => void;
  assets: MediaAssetMeta[];
  onAddFiles: (role: MediaAssetRole, files: FileList | File[]) => Promise<void>;
  onRemoveAsset: (assetId: string) => Promise<void>;
  scriptText: string;
  onChangeScriptText: (val: string) => void;
  editingInstructions: string;
  onChangeEditingInstructions: (val: string) => void;
  preset: EditingPresetId;
  onChangePreset: (preset: EditingPresetId) => void;
  outputResolution: OutputResolution;
  onChangeResolution: (res: OutputResolution) => void;
  aspectRatio: OutputAspectRatio;
  onChangeAspectRatio: (ar: OutputAspectRatio) => void;
  onStartOneClickCreate: () => Promise<void>;
  uploadError: string | null;
  onClearUploadError: () => void;
  isBusy: boolean;
  deviceMemoryGB: number | null;
}

const VOICE_ACCEPT = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a';
const VIDEO_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const VISUAL_COMBINED_ACCEPT = `${VIDEO_ACCEPT},${IMAGE_ACCEPT}`;
const MUSIC_ACCEPT = '.mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a';
const WATERMARK_ACCEPT = '.png,.svg,.webp,image/png,image/svg+xml,image/webp';
const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

export default function CreateProjectView({
  projectName,
  onChangeProjectName,
  assets,
  onAddFiles,
  onRemoveAsset,
  scriptText,
  onChangeScriptText,
  editingInstructions,
  onChangeEditingInstructions,
  preset,
  onChangePreset,
  outputResolution,
  onChangeResolution,
  aspectRatio,
  onChangeAspectRatio,
  onStartOneClickCreate,
  uploadError,
  onClearUploadError,
  isBusy,
  deviceMemoryGB,
}: CreateProjectViewProps) {
  const [showOptionalAssets, setShowOptionalAssets] = useState(true);

  const voiceInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scriptFileRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const extraVideoRef = useRef<HTMLInputElement>(null);
  const extraImageRef = useRef<HTMLInputElement>(null);
  const watermarkRef = useRef<HTMLInputElement>(null);
  const referenceVideoRef = useRef<HTMLInputElement>(null);
  const fontRef = useRef<HTMLInputElement>(null);

  const voiceoverAsset = assets.find((a) => a.role === 'voiceover');
  const primaryVisuals = assets.filter(
    (a) => a.role === 'video' || a.role === 'image'
  );
  const extraVideos = assets.filter((a) => a.role === 'extra_video');
  const extraImages = assets.filter((a) => a.role === 'extra_image');
  const musicAsset = assets.find((a) => a.role === 'music');
  const watermarkAsset = assets.find((a) => a.role === 'watermark');
  const referenceAsset = assets.find((a) => a.role === 'reference_video');
  const customFontAsset = assets.find((a) => a.role === 'custom_font');

  const totalVisualCount =
    primaryVisuals.length + extraVideos.length + extraImages.length;
  const readyToCreate = Boolean(voiceoverAsset) && totalVisualCount >= 1 && !isBusy;

  const handleScriptTxtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onChangeScriptText(text);
    e.target.value = '';
  };

  const handleVisualMixedFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const vids: File[] = [];
    const imgs: File[] = [];
    Array.from(files).forEach((f) => {
      const lower = f.name.toLowerCase();
      if (
        f.type.startsWith('video/') ||
        lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm')
      ) {
        vids.push(f);
      } else {
        imgs.push(f);
      }
    });
    if (vids.length > 0) await onAddFiles('video', vids);
    if (imgs.length > 0) await onAddFiles('image', imgs);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-10 pb-28 md:pb-16">
      {/* Header & Project Title */}
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-blue-400">
            Step 1 of 3 · Upload Media &amp; Choose Style
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Create Short Video Project
          </h1>
          <p className="text-sm text-slate-400">
            Upload your mandatory voiceover and at least one video or image. Optional assets enhance pacing, branding, and audio mix.
          </p>
        </div>

        <div className="w-full lg:w-80">
          <label
            htmlFor="project-title-input"
            className="block text-xs font-medium text-slate-400 mb-1.5"
          >
            Project Name
          </label>
          <input
            id="project-title-input"
            type="text"
            value={projectName}
            onChange={(e) => onChangeProjectName(e.target.value)}
            placeholder="My Vertical Short"
            className="w-full min-h-[42px] rounded-xl border border-slate-800 bg-[#0B1120] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Validation / Format Error Alert */}
      {uploadError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
          <button
            type="button"
            onClick={onClearUploadError}
            className="text-xs font-medium text-rose-300 underline hover:text-white shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Low-memory mobile guidance if detected <= 6GB RAM */}
      {deviceMemoryGB !== null && deviceMemoryGB <= 6 && (
        <div className="rounded-xl border border-slate-800 bg-[#0B1120] px-4 py-3 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Detected {deviceMemoryGB} GB device memory class · Sequential Web Worker rendering is active to protect browser RAM.
          </span>
          {outputResolution === '1080p' && (
            <button
              type="button"
              onClick={() => onChangeResolution('720p')}
              className="font-semibold text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
            >
              Switch to 720p fast mobile output
            </button>
          )}
        </div>
      )}

      {/* SECTION 1: REQUIRED INPUTS */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-white">
            01. Required Media Inputs
          </h2>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            Voiceover: {voiceoverAsset ? 'Ready' : 'Missing'} · Visuals:{' '}
            {totalVisualCount} uploaded
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 1. Mandatory Voiceover */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <FileAudio className="h-5 w-5 text-blue-400 shrink-0" />
                  <h3 className="text-base font-semibold text-white">
                    1. Master Voiceover
                  </h3>
                </div>
                <span className="text-xs font-semibold text-blue-400">
                  Mandatory
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                Supports MP3, WAV, M4A, AAC (up to 3 minutes). Your voiceover sets the master timeline—original speech is never altered or replaced.
              </p>

              <input
                ref={voiceInputRef}
                type="file"
                accept={VOICE_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('voiceover', e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              {voiceoverAsset ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/15 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="truncate">{voiceoverAsset.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums">
                      {formatBytes(voiceoverAsset.sizeBytes)}
                      {voiceoverAsset.analysis?.kind === 'voice'
                        ? ` · ${voiceoverAsset.analysis.duration.toFixed(1)}s`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => voiceInputRef.current?.click()}
                      className="min-h-[38px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      aria-label="Remove voiceover"
                      onClick={() => onRemoveAsset(voiceoverAsset.id)}
                      className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => voiceInputRef.current?.click()}
                  className="mt-4 flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-[#080D1A] px-4 py-6 text-center transition-colors hover:border-blue-500/70 hover:bg-slate-900/50"
                >
                  <Upload className="h-5 w-5 text-blue-400" />
                  <span className="text-sm font-medium text-white">
                    Select Voiceover Audio File
                  </span>
                  <span className="text-xs text-slate-400">
                    MP3 · WAV · M4A · AAC
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* 2. Mandatory Visual Assets */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Film className="h-5 w-5 text-blue-400 shrink-0" />
                  <h3 className="text-base font-semibold text-white">
                    2. Primary Visual Assets
                  </h3>
                </div>
                <span className="text-xs font-semibold text-blue-400">
                  Mandatory (1+ File)
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                Upload at least one video clip (MP4, MOV, WEBM) or image (JPG, PNG, WEBP). Multiple files are matched automatically to spoken phrases.
              </p>

              <input
                ref={videoInputRef}
                type="file"
                multiple
                accept={VISUAL_COMBINED_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  await handleVisualMixedFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('image', e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-[#080D1A] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:border-blue-500/70 hover:bg-slate-900/60 whitespace-nowrap"
                >
                  <Upload className="h-4 w-4 text-blue-400" />
                  <span>Add Videos or Photos</span>
                </button>
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-4 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white whitespace-nowrap"
                >
                  <ImageIcon className="h-4 w-4 text-slate-400" />
                  <span>Photos Only</span>
                </button>
              </div>

              {primaryVisuals.length > 0 && (
                <div className="mt-3 max-h-48 overflow-y-auto divide-y divide-slate-800/70 border-t border-slate-800/70 pt-2">
                  {primaryVisuals.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {item.role === 'video' ? (
                          <Film className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate font-medium text-slate-200">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums text-slate-400">
                        <span>{formatBytes(item.sizeBytes)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => onRemoveAsset(item.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: EDITING PRESETS & OUTPUT FORMAT */}
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              02. Editing Style Preset &amp; Output Format
            </h2>
            <p className="text-xs text-slate-400">
              Auto Style is selected by default. Presets control cut speed, color grading, zoom cadence, and caption styling.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 sm:pt-0">
            {/* Aspect Ratio Selector */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-1">
              {(['9:16', '1:1', '16:9'] as OutputAspectRatio[]).map((ar) => (
                <button
                  key={ar}
                  type="button"
                  onClick={() => onChangeAspectRatio(ar)}
                  className={`min-h-[34px] rounded-md px-2.5 py-1 text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                    aspectRatio === ar
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>

            {/* Resolution Selector */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-1">
              {(['1080p', '720p'] as OutputResolution[]).map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => onChangeResolution(res)}
                  className={`min-h-[34px] rounded-md px-2.5 py-1 text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                    outputResolution === res
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRESET_LIST.map((item) => {
            const active = preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangePreset(item.id)}
                className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-950/20'
                    : 'border-slate-800/80 bg-[#0B1120] hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {item.name}
                    </span>
                    {active && (
                      <Check className="h-4 w-4 text-blue-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {item.tagline}
                  </p>
                </div>
                <p className="mt-3 text-[11px] font-mono tabular-nums text-slate-500">
                  Target cut: {item.targetSceneSeconds[0]}s–
                  {item.targetSceneSeconds[1]}s · {item.colorGrade.preset.replace('_', ' ')}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* SECTION 3: OPTIONAL INPUTS (3 through 10) */}
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setShowOptionalAssets((v) => !v)}
          className="flex w-full items-center justify-between border-b border-slate-800/80 pb-3 text-left"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">
              03. Optional Inputs &amp; Creative Enhancements
            </h2>
            <p className="text-xs text-slate-400">
              All fields below are optional—leave any blank to let Gemini handle them automatically.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap">
            <span>{showOptionalAssets ? 'Hide Optional' : 'Show Optional'}</span>
            {showOptionalAssets ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </button>

        {showOptionalAssets && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 3. Video Script (Optional) */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    3. Video Script
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    ref={scriptFileRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={handleScriptTxtUpload}
                  />
                  <button
                    type="button"
                    onClick={() => scriptFileRef.current?.click()}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
                  >
                    Load .TXT File
                  </button>
                  <span className="text-xs text-slate-500">Optional</span>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                If provided, Gemini compares it against your spoken voiceover. If omitted, a full transcript is generated automatically from your voice.
              </p>
              <textarea
                rows={4}
                value={scriptText}
                onChange={(e) => onChangeScriptText(e.target.value)}
                placeholder="Paste your English or বাংলা script here (optional)..."
                className="w-full rounded-xl border border-slate-800 bg-[#080D1A] p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* 9. Editing Instructions (Optional) */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    9. Editing Instructions
                  </h3>
                </div>
                <span className="text-xs text-slate-500">Optional</span>
              </div>
              <p className="text-xs text-slate-400">
                Describe any specific pacing, mood, B-roll priority, or subtitle emphasis you want the AI director to follow.
              </p>
              <textarea
                rows={4}
                value={editingInstructions}
                onChange={(e) => onChangeEditingInstructions(e.target.value)}
                placeholder="e.g., Start with a fast zoom hook on the first sentence, keep cuts calm during the explanation, highlight numbers..."
                className="w-full rounded-xl border border-slate-800 bg-[#080D1A] p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* 4. Background Music (Optional) */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Music className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    4. Background Music
                  </h3>
                </div>
                <span className="text-xs text-slate-500">Optional</span>
              </div>
              <p className="text-xs text-slate-400">
                MP3, WAV, M4A. Automatically ducked under spoken sentences so your voice stays crystal clear.
              </p>
              <input
                ref={musicInputRef}
                type="file"
                accept={MUSIC_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('music', e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              {musicAsset ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2.5 text-xs">
                  <span className="truncate text-slate-200 font-medium">
                    {musicAsset.name} · {formatBytes(musicAsset.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAsset(musicAsset.id)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => musicInputRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-4 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5 text-blue-400" />
                  <span>Upload Music Track</span>
                </button>
              )}
            </div>

            {/* 5 & 6. Extra Video Clips & Extra Images (Optional) */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    5 &amp; 6. Extra B-Roll Videos &amp; Extra Images
                  </h3>
                </div>
                <span className="text-xs text-slate-500">Optional</span>
              </div>
              <p className="text-xs text-slate-400">
                Upload supplemental B-roll clips or Cutaway stills for Gemini to weave into secondary clauses.
              </p>

              <input
                ref={extraVideoRef}
                type="file"
                multiple
                accept={VIDEO_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('extra_video', e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <input
                ref={extraImageRef}
                type="file"
                multiple
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('extra_image', e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => extraVideoRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-blue-400" />
                  <span>Add Extra Clips ({extraVideos.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => extraImageRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Add Extra Images ({extraImages.length})</span>
                </button>
              </div>

              {(extraVideos.length > 0 || extraImages.length > 0) && (
                <div className="max-h-32 overflow-y-auto divide-y divide-slate-800/70 pt-1">
                  {[...extraVideos, ...extraImages].map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-1.5 text-xs text-slate-300"
                    >
                      <span className="truncate">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveAsset(item.id)}
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 7. Logo / Watermark & 10. Custom Subtitle Font */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Stamp className="h-4 w-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-white">
                      7. Logo / Watermark (PNG, SVG, WEBP)
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">Optional</span>
                </div>
                <input
                  ref={watermarkRef}
                  type="file"
                  accept={WATERMARK_ACCEPT}
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files?.length) {
                      await onAddFiles('watermark', e.target.files);
                    }
                    e.target.value = '';
                  }}
                />
                {watermarkAsset ? (
                  <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs">
                    <span className="truncate text-slate-200">
                      {watermarkAsset.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(watermarkAsset.id)}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => watermarkRef.current?.click()}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    <Upload className="h-3.5 w-3.5 text-blue-400" />
                    <span>Upload Brand Logo</span>
                  </button>
                )}
              </div>

              <div className="border-t border-slate-800/70 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TypeIcon className="h-4 w-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-white">
                      10. Custom Subtitle Font (TTF, OTF, WOFF2)
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">Optional</span>
                </div>
                <input
                  ref={fontRef}
                  type="file"
                  accept={FONT_ACCEPT}
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files?.length) {
                      await onAddFiles('custom_font', e.target.files);
                    }
                    e.target.value = '';
                  }}
                />
                {customFontAsset ? (
                  <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs">
                    <span className="truncate text-slate-200">
                      {customFontAsset.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(customFontAsset.id)}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fontRef.current?.click()}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    <Upload className="h-3.5 w-3.5 text-blue-400" />
                    <span>Upload Custom Font</span>
                  </button>
                )}
              </div>
            </div>

            {/* 8. Reference Video (Optional) */}
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">
                    8. Reference Video Inspiration
                  </h3>
                </div>
                <span className="text-xs text-slate-500">Optional</span>
              </div>
              <p className="text-xs text-slate-400">
                Upload an example Short or Reel. We measure its shot cut rate and visual mood so Gemini mirrors its energy.
              </p>
              <input
                ref={referenceVideoRef}
                type="file"
                accept={VIDEO_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await onAddFiles('reference_video', e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              {referenceAsset ? (
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#080D1A] px-3.5 py-2.5 text-xs">
                  <span className="truncate text-slate-200 font-medium">
                    {referenceAsset.name} · {formatBytes(referenceAsset.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAsset(referenceAsset.id)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => referenceVideoRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-800 bg-[#080D1A] px-4 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5 text-blue-400" />
                  <span>Upload Reference Video</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ONE-CLICK PRIMARY ACTION BAR */}
      <section className="rounded-2xl border border-blue-500/30 bg-[#0B1120] p-6 sm:p-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-white">
            Ready for One-Click Automatic Editing
          </h2>
          <p className="text-xs text-slate-400">
            {readyToCreate
              ? `Voiceover + ${totalVisualCount} visual ${totalVisualCount === 1 ? 'asset' : 'assets'} ready · Output: ${aspectRatio} ${outputResolution} MP4 (max 180s)`
              : 'Upload 1 mandatory voiceover and at least 1 video clip or image above to enable creation.'}
          </p>
        </div>

        <button
          type="button"
          disabled={!readyToCreate}
          onClick={onStartOneClickCreate}
          className={`inline-flex min-h-[52px] items-center justify-center gap-3 rounded-xl px-8 py-3.5 text-sm font-bold tracking-wide transition-all whitespace-nowrap shrink-0 ${
            readyToCreate
              ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-950/50 cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          <Play className="h-4 w-4 fill-current" />
          <span>CREATE MY VIDEO</span>
        </button>
      </section>
    </div>
  );
}
