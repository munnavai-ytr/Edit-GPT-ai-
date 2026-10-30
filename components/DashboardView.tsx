'use client';

import React, {useMemo, useState} from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cloud,
  HardDrive,
  KeyRound,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Video,
} from 'lucide-react';
import heroStudio from '@/src/assets/images/hero_editing_studio_1793364629391.jpg';
import CloudJobsPanel from './CloudJobsPanel';
import type {SettingsModalTab} from './SettingsModal';
import {EDITING_PRESETS} from '@/lib/presets';
import {
  formatBytes,
  formatDurationShort,
  formatRelativeDate,
} from '@/lib/format';
import {CloudJobRecord, ProjectRecord} from '@/lib/types';

interface DashboardViewProps {
  projects: ProjectRecord[];
  cloudConfigured: boolean;
  cloudJobs: CloudJobRecord[];
  cloudJobsLoading: boolean;
  onRefreshCloudJobs: () => Promise<void>;
  onPreviewCloudJob: (job: CloudJobRecord) => Promise<void>;
  onRetryCloudJob: (job: CloudJobRecord) => Promise<void>;
  onCancelCloudJob: (job: CloudJobRecord) => Promise<void>;
  onResumeInterruptedUpload: (projectId: string) => Promise<void>;
  onDeleteCloudJob: (job: CloudJobRecord, tempOnly: boolean) => Promise<void>;
  storageStats: {
    projectCount: number;
    totalBytes: number;
    quotaBytes?: number;
  };
  onCreateNew: () => void;
  onOpenProject: (project: ProjectRecord) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onClearAllStorage: () => Promise<void>;
  onOpenSettings: (tab?: SettingsModalTab) => void;
}

export default function DashboardView({
  projects,
  cloudConfigured,
  cloudJobs,
  cloudJobsLoading,
  onRefreshCloudJobs,
  onPreviewCloudJob,
  onRetryCloudJob,
  onCancelCloudJob,
  onResumeInterruptedUpload,
  onDeleteCloudJob,
  storageStats,
  onCreateNew,
  onOpenProject,
  onDeleteProject,
  onClearAllStorage,
  onOpenSettings,
}: DashboardViewProps) {
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [heroImgError, setHeroImgError] = useState(false);

  const localProjectIds = useMemo(
    () => new Set(projects.map((p) => p.id)),
    [projects]
  );

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await onDeleteProject(id);
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleClearStorage = async () => {
    setBusyId('all');
    try {
      await onClearAllStorage();
    } finally {
      setBusyId(null);
      setConfirmClearAll(false);
    }
  };

  const renderStatusText = (p: ProjectRecord) => {
    if (p.status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Rendered MP4</span>
        </span>
      );
    }
    if (p.status === 'cloud_queued') {
      return (
        <span className="inline-flex items-center gap-1.5 text-blue-400">
          <Cloud className="h-3.5 w-3.5 shrink-0" />
          <span>Queued in Cloud Worker</span>
        </span>
      );
    }
    if (p.status === 'interrupted') {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-400">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span>Interrupted · Ready to Resume</span>
        </span>
      );
    }
    if (p.status === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Needs Attention</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-400">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Draft</span>
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-12 pb-28 md:pb-16">
      {/* Studio Hero Split */}
      <section className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <div className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 sm:p-10 lg:col-span-7">
          <div className="space-y-5">
            <p className="text-xs font-medium tracking-wide text-blue-400">
              Private Personal Video Studio · BYOK Vault · Local FFmpeg.wasm &amp; Cloud R2 Queue
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.65rem] lg:leading-[1.15] [text-wrap:balance]">
              Turn raw voiceovers and clips into finished 9:16 Shorts in one click.
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-300">
              Bring your own encrypted Gemini API key, upload your voiceover and
              footage, and choose Local Browser Rendering (zero cloud cost) or
              Cloud Background Rendering (close Chrome or turn off your phone
              while your private FFmpeg worker finishes the MP4).
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3.5 pt-4 border-t border-slate-800/70">
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex min-h-[46px] items-center gap-2.5 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Start New Video Project</span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onOpenSettings('keys')}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-700/80 bg-transparent px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800/40 whitespace-nowrap shrink-0"
            >
              <KeyRound className="h-4 w-4 text-blue-400" />
              <span>BYOK API Key Manager</span>
            </button>
          </div>
        </div>

        <div className="relative min-h-[260px] overflow-hidden rounded-2xl border border-slate-800/80 bg-[#090E1A] lg:col-span-5">
          {!heroImgError ? (
            <Image
              src={heroStudio}
              alt="Dark post-production vertical video editing suite with 9:16 reference monitor"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 42vw"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#0B1120] to-[#060B16] p-8 text-center">
              <Video className="h-10 w-10 text-blue-500 mb-3" />
              <p className="text-sm font-medium text-slate-300">
                9:16 Vertical Mastering Pipeline
              </p>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#060B16] via-[#060B16]/35 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-200">
              <span>1080×1920 H.264</span>
              <span aria-hidden="true">·</span>
              <span>AAC 44.1kHz</span>
              <span aria-hidden="true">·</span>
              <span>Local WASM + Cloud R2</span>
              <span aria-hidden="true">·</span>
              <span>EN / বাংলা Captions</span>
            </div>
          </div>
        </div>
      </section>

      {/* Persistent Cloud Background Rendering Jobs (Cloudflare D1 + R2) */}
      <CloudJobsPanel
        cloudConfigured={cloudConfigured}
        jobs={cloudJobs}
        isLoading={cloudJobsLoading}
        localProjectIds={localProjectIds}
        onRefreshJobs={onRefreshCloudJobs}
        onOpenCloudConfig={() => onOpenSettings('cloud')}
        onPreviewCloudJob={onPreviewCloudJob}
        onRetryCloudJob={onRetryCloudJob}
        onCancelCloudJob={onCancelCloudJob}
        onResumeInterruptedUpload={onResumeInterruptedUpload}
        onDeleteCloudJob={onDeleteCloudJob}
      />

      {/* Local IndexedDB Projects & Storage Control */}
      <section className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              Local IndexedDB Projects
            </h2>
            <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
              {storageStats.projectCount}{' '}
              {storageStats.projectCount === 1 ? 'project' : 'projects'} stored
              locally
              <span aria-hidden="true"> · </span>
              <HardDrive className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-slate-400" />
              {formatBytes(storageStats.totalBytes)} used in IndexedDB
              {storageStats.quotaBytes
                ? ` / ${formatBytes(storageStats.quotaBytes)} available`
                : ''}
            </p>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-3">
              {!confirmClearAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-rose-800/80 hover:text-rose-300 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear Local Storage</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-rose-300 whitespace-nowrap">
                    Delete all local projects &amp; media?
                  </span>
                  <button
                    type="button"
                    disabled={busyId === 'all'}
                    onClick={handleClearStorage}
                    className="min-h-[38px] rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 whitespace-nowrap shrink-0"
                  >
                    {busyId === 'all' ? 'Clearing…' : 'Confirm Clear'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="min-h-[38px] rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] px-6 py-14 text-center">
            <Video className="mx-auto h-9 w-9 text-slate-500" />
            <h3 className="mt-4 text-base font-semibold text-white">
              No local video projects yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-400">
              Uploaded voiceovers, footage, validated Edit Decision Lists, and
              local renders persist across refreshes in your browser&apos;s
              IndexedDB storage.
            </p>
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Short</span>
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0B1120] divide-y divide-slate-800/80">
            {projects.map((project) => {
              const presetLabel =
                EDITING_PRESETS[project.preset]?.name || 'Auto Style';
              const durationSec =
                project.renderedVideoMeta?.duration ||
                project.edl?.totalDuration ||
                (project.assets.find((a) => a.role === 'voiceover')?.analysis
                  ?.kind === 'voice'
                  ? (
                      project.assets.find((a) => a.role === 'voiceover')!
                        .analysis as {duration: number}
                    ).duration
                  : 0) ||
                0;

              return (
                <div
                  key={project.id}
                  className="flex flex-col gap-4 p-5 transition-colors hover:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="truncate text-base font-semibold text-white">
                        {project.edl?.projectTitle || project.name}
                      </h3>
                      <span className="text-xs font-medium">
                        {renderStatusText(project)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 font-mono tabular-nums">
                      <span>
                        {project.renderMode === 'cloud'
                          ? 'Cloud R2 Mode'
                          : 'Local WASM Mode'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{presetLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.aspectRatio}</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.outputResolution}</span>
                      {durationSec > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatDurationShort(durationSec)}</span>
                        </>
                      )}
                      {project.renderedVideoMeta && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatBytes(project.renderedVideoMeta.sizeBytes)}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Updated {formatRelativeDate(project.updatedAt)}</span>
                    </div>

                    {project.errorMessage && project.status === 'error' && (
                      <p className="text-xs text-rose-400 truncate max-w-2xl">
                        {project.errorMessage}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenProject(project)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-600/15 px-4 py-2 text-xs font-semibold text-blue-300 border border-blue-500/30 transition-colors hover:bg-blue-600 hover:text-white whitespace-nowrap shrink-0"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>
                        {project.status === 'completed'
                          ? 'Preview & Download'
                          : project.status === 'cloud_queued'
                            ? 'View Cloud Status'
                            : project.edl
                              ? 'Resume / Render'
                              : 'Open Project'}
                      </span>
                    </button>

                    {confirmDeleteId === project.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === project.id}
                          onClick={() => handleDelete(project.id)}
                          className="min-h-[42px] rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 whitespace-nowrap shrink-0"
                        >
                          {busyId === project.id ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[42px] rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => setConfirmDeleteId(project.id)}
                        className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-800 text-slate-400 transition-colors hover:border-rose-800/80 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
