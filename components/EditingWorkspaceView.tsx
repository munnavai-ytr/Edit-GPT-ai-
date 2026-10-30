'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import {formatTimecode} from '@/lib/format';
import {
  MediaAssetMeta,
  PipelineProgress,
  PipelineStage,
  ProjectRecord,
} from '@/lib/types';

interface EditingWorkspaceViewProps {
  project: ProjectRecord;
  progress: PipelineProgress;
  isRunning: boolean;
  onCancelRender: () => void;
  onRetryFullPipeline: () => void;
  onRetryRenderOnly: (force720p?: boolean) => void;
  onGoToPreview: () => void;
}

const ORDERED_STAGES: Array<{
  key: PipelineStage;
  title: string;
  desc: string;
}> = [
  {
    key: 'analyzing_media',
    title: 'Stage A · Media & Waveform Analysis',
    desc: 'Inspecting resolution, scene changes, keyframe content, voice pauses, and loudness.',
  },
  {
    key: 'transcribing_voice',
    title: 'Stage B · Voice Transcription & Script Sync',
    desc: 'Transcribing spoken English / বাংলা words and anchoring timestamps to master voiceover.',
  },
  {
    key: 'generating_edl',
    title: 'Stage C · AI Editing Decision Engine',
    desc: 'Matching spoken sentences to visual clips, framing, camera zooms, and pacing.',
  },
  {
    key: 'validating_edl',
    title: 'Stage D · Timeline & Asset Validation',
    desc: 'Verifying uploaded asset IDs, source in/out points, and saving EDL to IndexedDB.',
  },
  {
    key: 'mixing_audio',
    title: 'Stage E & F · Master Audio Ducking & Captions',
    desc: 'Normalizing voiceover, ducking background music, and shaping Bengali/English subtitles.',
  },
  {
    key: 'rendering_video',
    title: 'Stage G · FFmpeg.wasm H.264 MP4 Rendering',
    desc: 'Encoding scenes sequentially in Web Worker and muxing synchronized AAC audio.',
  },
];

function getStageOrderIndex(stage: PipelineStage): number {
  switch (stage) {
    case 'analyzing_media':
      return 0;
    case 'transcribing_voice':
      return 1;
    case 'generating_edl':
      return 2;
    case 'validating_edl':
      return 3;
    case 'mixing_audio':
    case 'rendering_captions':
      return 4;
    case 'rendering_video':
      return 5;
    case 'completed':
      return 6;
    default:
      return -1;
  }
}

export default function EditingWorkspaceView({
  project,
  progress,
  isRunning,
  onCancelRender,
  onRetryFullPipeline,
  onRetryRenderOnly,
  onGoToPreview,
}: EditingWorkspaceViewProps) {
  const voiceAsset = project.assets.find((a) => a.role === 'voiceover');
  const voiceAnalysis =
    voiceAsset?.analysis?.kind === 'voice' ? voiceAsset.analysis : null;

  const assetNameMap = new Map<string, MediaAssetMeta>(
    project.assets.map((a) => [a.id, a])
  );

  const activeIdx = getStageOrderIndex(progress.stage);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-10 pb-28 md:pb-16">
      {/* Top Progress Banner */}
      <section className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 sm:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-blue-400">
              AI Editing Workspace · {project.edl?.projectTitle || project.name}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {progress.stageLabel || 'Automatic Video Editing Pipeline'}
            </h1>
            <p className="text-sm text-slate-400">{progress.detail}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {isRunning && (
              <button
                type="button"
                onClick={onCancelRender}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 whitespace-nowrap"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Cancel Rendering</span>
              </button>
            )}

            {!isRunning && progress.stage === 'completed' && (
              <button
                type="button"
                onClick={onGoToPreview}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Open Final Video Preview</span>
              </button>
            )}

            {!isRunning &&
              (progress.stage === 'error' ||
                progress.stage === 'cancelled' ||
                project.status === 'interrupted') && (
                <>
                  {project.edl ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRetryRenderOnly(false)}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Retry Render ({project.edl.resolution})</span>
                      </button>
                      {project.edl.resolution === '1080p' && (
                        <button
                          type="button"
                          onClick={() => onRetryRenderOnly(true)}
                          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-950/30 px-4 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-900/40 whitespace-nowrap"
                        >
                          <span>Retry in 720p Low-Memory Mode</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={onRetryFullPipeline}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Retry AI Pipeline</span>
                    </button>
                  )}
                </>
              )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-300">
            <span>
              {progress.sceneTotal
                ? `Scene ${progress.sceneCurrent ?? 1} of ${progress.sceneTotal}`
                : progress.stage === 'completed'
                  ? 'Render verified'
                  : 'Pipeline progress'}
            </span>
            <span>{Math.round(progress.percent)}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-transform duration-200 origin-left"
              style={{
                transform: `scaleX(${Math.max(0.02, Math.min(1, progress.percent / 100))})`,
              }}
            />
          </div>
        </div>

        {/* Error Box */}
        {progress.error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
          >
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-rose-100">Pipeline Halted</p>
              <p className="text-xs leading-relaxed text-rose-200">
                {progress.error}
              </p>
            </div>
          </div>
        )}

        {/* Stage Checklist */}
        <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2 lg:grid-cols-3">
          {ORDERED_STAGES.map((st, idx) => {
            const isDone =
              progress.stage === 'completed' ||
              (activeIdx > idx && progress.stage !== 'error');
            const isCurrent = activeIdx === idx && isRunning;

            return (
              <div
                key={st.key}
                className={`rounded-xl border p-4 ${
                  isCurrent
                    ? 'border-blue-500/60 bg-blue-950/15'
                    : isDone
                      ? 'border-slate-800 bg-[#080D1A]'
                      : 'border-slate-800/60 bg-[#080D1A]/60 opacity-75'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-slate-600 shrink-0" />
                  )}
                  <h3 className="text-xs font-semibold text-white truncate">
                    {st.title}
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {st.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Voiceover Waveform & Transcript Synchronization Summary */}
      {(voiceAnalysis || project.transcript) && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Voiceover Waveform & Audio Metrics */}
          {voiceAnalysis && (
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4 lg:col-span-5">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Master Voiceover Envelope
                </h2>
                <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                  {voiceAnalysis.duration.toFixed(2)}s ·{' '}
                  {(voiceAnalysis.sampleRate / 1000).toFixed(1)}kHz · Peak{' '}
                  {voiceAnalysis.peakDb} dBFS · {voiceAnalysis.pauses.length}{' '}
                  natural pauses
                </p>
              </div>

              {/* Real 120-bar Waveform */}
              <div
                aria-label="Voiceover amplitude waveform"
                className="flex h-24 items-end gap-[2px] rounded-xl bg-[#060B16] p-3 border border-slate-800/70"
              >
                {voiceAnalysis.waveformPeaks.slice(0, 96).map((pk, idx) => (
                  <div
                    key={idx}
                    className="flex-1 rounded-sm bg-blue-500/80"
                    style={{
                      height: `${Math.max(8, Math.round(pk * 100))}%`,
                    }}
                  />
                ))}
              </div>

              {project.transcript?.scriptComparison?.provided && (
                <div className="border-t border-slate-800/80 pt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      Script vs. Spoken Voiceover Alignment
                    </span>
                    <span className="font-mono tabular-nums text-blue-400">
                      {project.transcript.scriptComparison.matchPercentage}% match
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {project.transcript.scriptComparison.summary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Synchronized Transcript */}
          {project.transcript && (
            <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4 lg:col-span-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-white">
                  Synchronized Speech Transcript
                </h2>
                <p className="text-xs font-mono tabular-nums text-slate-400">
                  Language: {project.transcript.languageLabel} · Timing:{' '}
                  {project.transcript.alignmentPrecision === 'word'
                    ? 'Word-Level Aligned'
                    : 'Sentence-Level (Approximate)'}
                </p>
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70 pr-1">
                {project.transcript.segments.map((seg) => (
                  <div
                    key={seg.id}
                    className="py-2.5 flex items-start gap-3 text-xs"
                  >
                    <span className="font-mono tabular-nums text-blue-400 shrink-0 pt-0.5">
                      {formatTimecode(seg.startTime)}–{formatTimecode(seg.endTime)}
                    </span>
                    <p className="text-slate-200 leading-relaxed">
                      {seg.sentence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* AI Edit Decision List (EDL) Preview Table */}
      {project.edl && (
        <section className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Validated Edit Decision List (EDL)
              </h2>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {project.edl.scenes.length} scenes ·{' '}
                {project.edl.totalDuration.toFixed(1)}s master duration ·{' '}
                {project.edl.captions.length} caption cues · Color:{' '}
                {project.edl.colorGrade.preset.replace('_', ' ')}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">#</th>
                  <th className="py-2.5 pr-4 font-medium">Timeline</th>
                  <th className="py-2.5 pr-4 font-medium">Matched Visual Asset</th>
                  <th className="py-2.5 pr-4 font-medium">Source In/Out</th>
                  <th className="py-2.5 pr-4 font-medium">Motion &amp; Cut</th>
                  <th className="py-2.5 font-medium">AI Visual Match Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {project.edl.scenes.map((scene) => {
                  const matched = assetNameMap.get(scene.assetId);
                  return (
                    <tr
                      key={scene.sceneNumber}
                      className="hover:bg-slate-900/40 transition-colors"
                    >
                      <td className="py-3 pr-4 font-mono tabular-nums text-slate-400">
                        {String(scene.sceneNumber).padStart(2, '0')}
                      </td>
                      <td className="py-3 pr-4 font-mono tabular-nums text-white whitespace-nowrap">
                        {formatTimecode(scene.startTime)} →{' '}
                        {formatTimecode(scene.endTime)}
                      </td>
                      <td className="py-3 pr-4 font-medium text-blue-300 max-w-[180px] truncate">
                        {matched?.name || scene.assetId}
                      </td>
                      <td className="py-3 pr-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {scene.sourceInPoint.toFixed(1)}s–
                        {scene.sourceOutPoint.toFixed(1)}s
                      </td>
                      <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                        {scene.zoomAnimation.replace(/_/g, ' ')} ·{' '}
                        {scene.transition}
                      </td>
                      <td className="py-3 text-slate-400 max-w-sm">
                        {scene.visualMatchingReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
