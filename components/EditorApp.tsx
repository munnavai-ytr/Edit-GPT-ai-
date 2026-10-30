'use client';

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import TopNav, {WorkspaceTab} from './TopNav';
import DashboardView from './DashboardView';
import CreateProjectView from './CreateProjectView';
import EditingWorkspaceView from './EditingWorkspaceView';
import FinalPreviewView from './FinalPreviewView';
import SettingsModal from './SettingsModal';
import {analyzeAllProjectAssets, analyzeAuxAudioFile, analyzeImageFile} from '@/lib/media-analysis';
import {transcribeAndSyncVoiceover} from '@/lib/transcription';
import {generateProjectEDL} from '@/lib/edit-decision-engine';
import {FFmpegRenderController, RenderCancelledError} from '@/lib/ffmpeg-engine';
import {
  clearAllStorage,
   DEFAULT_APP_SETTINGS,
  deleteProject,
  detectDeviceMemoryGB,
  getProjectMediaBlobs,
  getRenderedVideo,
  getStorageSummary,
  listProjects,
  loadAppSettings,
  saveAppSettings,
  saveMediaAssetBlob,
  saveProject,
  saveRenderedVideo,
} from '@/lib/storage';
import {
  AppSettings,
  EditDecisionList,
  EditingPresetId,
  MediaAssetMeta,
  MediaAssetRole,
  OutputAspectRatio,
  OutputResolution,
  PipelineProgress,
  ProjectRecord,
} from '@/lib/types';

function createFreshDraftProject(defaultRes: OutputResolution): ProjectRecord {
  const now = Date.now();
  const id = `proj_${now}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: 'Untitled Vertical Short',
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    preset: 'auto',
    scriptText: '',
    editingInstructions: '',
    outputResolution: defaultRes,
    aspectRatio: '9:16',
    assets: [],
  };
}

const SINGLETON_ROLES = new Set<MediaAssetRole>([
  'voiceover',
  'music',
  'watermark',
  'reference_video',
  'custom_font',
]);

function validateFileFormatForRole(role: MediaAssetRole, file: File): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (role === 'voiceover') {
    if (!['mp3', 'wav', 'm4a', 'aac'].includes(ext)) {
      return `Unsupported voiceover format ".${ext}". Supported formats: MP3, WAV, M4A, AAC.`;
    }
  } else if (role === 'music') {
    if (!['mp3', 'wav', 'm4a'].includes(ext)) {
      return `Unsupported music format ".${ext}". Supported formats: MP3, WAV, M4A.`;
    }
  } else if (
    role === 'video' ||
    role === 'extra_video' ||
    role === 'reference_video'
  ) {
    if (!['mp4', 'mov', 'webm'].includes(ext)) {
      return `Unsupported video format ".${ext}". Supported formats: MP4, MOV, WEBM.`;
    }
  } else if (role === 'image' || role === 'extra_image') {
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return `Unsupported image format ".${ext}". Supported formats: JPG, PNG, WEBP.`;
    }
  } else if (role === 'watermark') {
    if (!['png', 'svg', 'webp'].includes(ext)) {
      return `Unsupported watermark format ".${ext}". Supported formats: PNG, SVG, WEBP.`;
    }
  } else if (role === 'custom_font') {
    if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
      return `Unsupported font format ".${ext}". Supported formats: TTF, OTF, WOFF, WOFF2.`;
    }
  }
  return null;
}

export default function EditorApp() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [storageStats, setStorageStats] = useState<{
    projectCount: number;
    totalBytes: number;
    quotaBytes?: number;
  }>({projectCount: 0, totalBytes: 0});

  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deviceMemoryGB] = useState<number | null>(() => detectDeviceMemoryGB());

  const [currentProject, setCurrentProject] = useState<ProjectRecord>(() => {
    const initialSettings = loadAppSettings();
    const mem = detectDeviceMemoryGB();
    return createFreshDraftProject(
      mem && mem <= 4 ? '720p' : initialSettings.defaultResolution
    );
  });
  const [currentBlobs, setCurrentBlobs] = useState<Map<string, Blob>>(
    () => new Map()
  );
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'idle',
    stageLabel: 'Ready',
    detail: 'Waiting to start automatic editing.',
    percent: 0,
  });

  const renderControllerRef = useRef<FFmpegRenderController | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  const setManagedVideoUrl = useCallback((blob: Blob | null) => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    if (blob) {
      const nextUrl = URL.createObjectURL(blob);
      videoUrlRef.current = nextUrl;
      setRenderedVideoUrl(nextUrl);
    } else {
      setRenderedVideoUrl(null);
    }
  }, []);

  const refreshDashboardData = useCallback(async () => {
    try {
      const loadedProjects = await listProjects();
      // Recover any project left in 'processing' state from an earlier browser session
      const normalized: ProjectRecord[] = [];
      for (const p of loadedProjects) {
        if (p.status === 'processing') {
          const recovered: ProjectRecord = {
            ...p,
            status: 'interrupted',
            errorMessage:
              'Previous session ended before rendering finished. You can resume rendering directly.',
          };
          await saveProject(recovered);
          normalized.push(recovered);
        } else {
          normalized.push(p);
        }
      }
      setProjects(normalized);
      const summary = await getStorageSummary();
      setStorageStats({
        projectCount: summary.projectCount,
        totalBytes: summary.totalBytes,
        quotaBytes: summary.quotaBytes,
      });
    } catch {
      // IndexedDB unavailable in restricted mode
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        void refreshDashboardData();
      }
    });

    return () => {
      active = false;
      renderControllerRef.current?.dispose();
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }
    };
  }, [refreshDashboardData]);

  const handleSaveSettings = (next: AppSettings) => {
    setSettings(next);
    saveAppSettings(next);
  };

  const handleStartNewProject = () => {
    if (isPipelineRunning) return;
    setManagedVideoUrl(null);
    setUploadError(null);
    const defaultRes =
      deviceMemoryGB && deviceMemoryGB <= 4
        ? '720p'
        : settings.defaultResolution;
    setCurrentProject(createFreshDraftProject(defaultRes));
    setCurrentBlobs(new Map());
    setProgress({
      stage: 'idle',
      stageLabel: 'Ready',
      detail: 'Upload your voiceover and visual media.',
      percent: 0,
    });
    setActiveTab('create');
  };

  const handleOpenProject = async (project: ProjectRecord) => {
    if (isPipelineRunning) return;
    setUploadError(null);
    const blobs = await getProjectMediaBlobs(project.id);
    const renderedBlob = await getRenderedVideo(project.id);

    setCurrentProject(project);
    setCurrentBlobs(blobs);
    setManagedVideoUrl(renderedBlob ?? null);

    if (project.status === 'completed' && renderedBlob && project.edl) {
      setProgress({
        stage: 'completed',
        stageLabel: 'Video Ready',
        detail: 'Rendered MP4 loaded from local IndexedDB.',
        percent: 100,
      });
      setActiveTab('preview');
    } else if (project.edl || project.status === 'interrupted' || project.status === 'error') {
      setProgress({
        stage: project.status === 'error' ? 'error' : 'validating_edl',
        stageLabel:
          project.status === 'interrupted'
            ? 'Interrupted Render · Ready to Resume'
            : 'Saved Project Workspace',
        detail:
          project.errorMessage ||
          'Validated Edit Decision List restored from IndexedDB. Ready to render.',
        percent: project.edl ? 55 : 15,
        error: project.status === 'error' ? project.errorMessage : undefined,
      });
      setActiveTab('workspace');
    } else {
      setActiveTab('create');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    if (currentProject.id === projectId) {
      setManagedVideoUrl(null);
      setCurrentProject(createFreshDraftProject(settings.defaultResolution));
      setCurrentBlobs(new Map());
    }
    await refreshDashboardData();
  };

  const handleClearAllStorage = async () => {
    await clearAllStorage();
    setManagedVideoUrl(null);
    setCurrentProject(createFreshDraftProject(settings.defaultResolution));
    setCurrentBlobs(new Map());
    await refreshDashboardData();
    setActiveTab('dashboard');
  };

  const handleAddFiles = async (
    role: MediaAssetRole,
    fileList: FileList | File[]
  ) => {
    setUploadError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    for (const file of incoming) {
      const validationErr = validateFileFormatForRole(role, file);
      if (validationErr) {
        setUploadError(validationErr);
        return;
      }
    }

    const updatedBlobs = new Map(currentBlobs);
    let updatedAssets = [...currentProject.assets];

    if (SINGLETON_ROLES.has(role)) {
      const existing = updatedAssets.filter((a) => a.role === role);
      for (const old of existing) {
        updatedBlobs.delete(old.id);
      }
      updatedAssets = updatedAssets.filter((a) => a.role !== role);
    }

    const toProcess = SINGLETON_ROLES.has(role) ? [incoming[0]] : incoming;
    let derivedProjectName = currentProject.name;

    for (const file of toProcess) {
      const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const meta: MediaAssetMeta = {
        id: assetId,
        projectId: currentProject.id,
        role,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        createdAt: Date.now(),
      };

      await saveMediaAssetBlob(meta, file);
      updatedBlobs.set(assetId, file);
      updatedAssets.push(meta);

      if (
        role === 'voiceover' &&
        (derivedProjectName === 'Untitled Vertical Short' || !derivedProjectName.trim())
      ) {
        derivedProjectName = file.name.replace(/\.[^.]+$/, '');
      }
    }

    const nextProj: ProjectRecord = {
      ...currentProject,
      name: derivedProjectName,
      assets: updatedAssets,
      updatedAt: Date.now(),
    };

    setCurrentBlobs(updatedBlobs);
    setCurrentProject(nextProj);
    await saveProject(nextProj);
    await refreshDashboardData();
  };

  const handleRemoveAsset = async (assetId: string) => {
    const updatedBlobs = new Map(currentBlobs);
    updatedBlobs.delete(assetId);
    const nextProj: ProjectRecord = {
      ...currentProject,
      assets: currentProject.assets.filter((a) => a.id !== assetId),
      updatedAt: Date.now(),
    };
    setCurrentBlobs(updatedBlobs);
    setCurrentProject(nextProj);
    await saveProject(nextProj);
    await refreshDashboardData();
  };

  // Helper used by FinalPreviewView to upload/replace music or watermark
  const handleUploadAuxFileInPreview = async (
    role: MediaAssetRole,
    file: File
  ): Promise<string | null> => {
    const err = validateFileFormatForRole(role, file);
    if (err) {
      setUploadError(err);
      return null;
    }

    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const meta: MediaAssetMeta = {
      id: assetId,
      projectId: currentProject.id,
      role,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      createdAt: Date.now(),
    };

    if (role === 'music') {
      meta.analysis = await analyzeAuxAudioFile(file);
    } else if (role === 'watermark') {
      const {analysis} = await analyzeImageFile(file);
      meta.analysis = analysis;
    }

    await saveMediaAssetBlob(meta, file);
    const updatedBlobs = new Map(currentBlobs);
    updatedBlobs.set(assetId, file);

    const filteredAssets = currentProject.assets.filter((a) => a.role !== role);
    const nextProj: ProjectRecord = {
      ...currentProject,
      assets: [...filteredAssets, meta],
      updatedAt: Date.now(),
    };
    setCurrentBlobs(updatedBlobs);
    setCurrentProject(nextProj);
    await saveProject(nextProj);
    await refreshDashboardData();
    return assetId;
  };

  const executeFFmpegRenderPhase = async (
    projToRender: ProjectRecord,
    blobsMap: Map<string, Blob>,
    edlToRender: EditDecisionList
  ) => {
    const controller = new FFmpegRenderController();
    renderControllerRef.current = controller;

    let activeEdl = edlToRender;

    const attemptRender = async (edlAttempt: EditDecisionList) => {
      return controller.renderProjectVideo({
        edl: edlAttempt,
        assets: projToRender.assets,
        blobs: blobsMap,
        onProgress: (info) => {
          setProgress({
            stage: info.stage,
            stageLabel:
              info.stage === 'mixing_audio'
                ? 'Stage F · Mixing & Ducking Master Audio'
                : info.stage === 'rendering_captions'
                  ? 'Stage E · Generating Captions & Safe Overlays'
                  : 'Stage G · Rendering H.264 MP4 via FFmpeg.wasm',
            detail: info.detail,
            percent: 55 + Math.round((info.percent / 100) * 44),
            sceneCurrent: info.sceneCurrent,
            sceneTotal: info.sceneTotal,
          });
        },
      });
    };

    let renderResult: {
      mp4Blob: Blob;
      width: number;
      height: number;
      duration: number;
    };

    try {
      renderResult = await attemptRender(activeEdl);
    } catch (err) {
      if (err instanceof RenderCancelledError) {
        throw err;
      }
      // Automatic low-memory 720p fallback if 1080p failed due to WASM heap limits
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const looksLikeMemoryError =
        msg.includes('memory') ||
        msg.includes('oom') ||
        msg.includes('out of bounds') ||
        msg.includes('allocation');

      if (
        activeEdl.resolution === '1080p' &&
        settings.autoLowMemoryFallback &&
        looksLikeMemoryError
      ) {
        controller.dispose();
        const fallbackController = new FFmpegRenderController();
        renderControllerRef.current = fallbackController;
        activeEdl = {
          ...activeEdl,
          resolution: '720p',
          validationNotes: [
            ...activeEdl.validationNotes,
            'Automatically switched output from 1080p to 720p to fit browser WebAssembly memory.',
          ],
        };
        setProgress({
          stage: 'rendering_video',
          stageLabel: 'Recovering in 720p Mobile-Safe Mode',
          detail: '1080p exceeded browser memory limit; re-encoding cleanly at 720p...',
          percent: 58,
        });
        renderResult = await fallbackController.renderProjectVideo({
          edl: activeEdl,
          assets: projToRender.assets,
          blobs: blobsMap,
          onProgress: (info) => {
            setProgress({
              stage: info.stage,
              stageLabel: 'Stage G · Rendering 720p H.264 MP4',
              detail: info.detail,
              percent: 58 + Math.round((info.percent / 100) * 41),
              sceneCurrent: info.sceneCurrent,
              sceneTotal: info.sceneTotal,
            });
          },
        });
      } else {
        throw err;
      }
    }

    await saveRenderedVideo(projToRender.id, renderResult.mp4Blob);
    setManagedVideoUrl(renderResult.mp4Blob);

    const completedProj: ProjectRecord = {
      ...projToRender,
      name: activeEdl.projectTitle || projToRender.name,
      status: 'completed',
      lastStage: 'completed',
      errorMessage: undefined,
      outputResolution: activeEdl.resolution,
      aspectRatio: activeEdl.aspectRatio,
      edl: activeEdl,
      renderedVideoMeta: {
        sizeBytes: renderResult.mp4Blob.size,
        duration: renderResult.duration,
        width: renderResult.width,
        height: renderResult.height,
        completedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };

    setCurrentProject(completedProj);
    await saveProject(completedProj);
    await refreshDashboardData();

    setProgress({
      stage: 'completed',
      stageLabel: 'MP4 Video Ready',
      detail: `Successfully rendered ${renderResult.width}×${renderResult.height} H.264 + AAC MP4.`,
      percent: 100,
    });
    setActiveTab('preview');
  };

  // ONE-CLICK FULL PIPELINE: Analyze -> Transcribe -> Plan EDL -> Validate -> Render MP4
  const handleStartOneClickCreate = async () => {
    if (isPipelineRunning) return;

    const voiceAsset = currentProject.assets.find((a) => a.role === 'voiceover');
    const visualCount = currentProject.assets.filter(
      (a) =>
        a.role === 'video' ||
        a.role === 'image' ||
        a.role === 'extra_video' ||
        a.role === 'extra_image'
    ).length;

    if (!voiceAsset || visualCount === 0) {
      setUploadError(
        'Please upload one mandatory voiceover file and at least one video clip or image.'
      );
      return;
    }

    setIsPipelineRunning(true);
    setActiveTab('workspace');
    setManagedVideoUrl(null);

    let workingProject: ProjectRecord = {
      ...currentProject,
      status: 'processing',
      errorMessage: undefined,
      updatedAt: Date.now(),
    };
    await saveProject(workingProject);

    try {
      let blobsMap = currentBlobs;
      if (blobsMap.size < workingProject.assets.length) {
        blobsMap = await getProjectMediaBlobs(workingProject.id);
        setCurrentBlobs(blobsMap);
      }

      // STAGE A: Media Analysis
      setProgress({
        stage: 'analyzing_media',
        stageLabel: 'Stage A · Analyzing Media & Voiceover',
        detail: 'Extracting video resolutions, scene changes, keyframes, and voice pauses...',
        percent: 5,
      });

      const {updatedAssets, referenceVideoSummary} =
        await analyzeAllProjectAssets({
          assets: workingProject.assets,
          blobs: blobsMap,
          directorModel: settings.directorModel,
          onProgress: (detail, fraction) => {
            setProgress({
              stage: 'analyzing_media',
              stageLabel: 'Stage A · Analyzing Media & Voiceover',
              detail,
              percent: Math.round(5 + fraction * 18),
            });
          },
        });

      workingProject = {
        ...workingProject,
        assets: updatedAssets,
      };
      setCurrentProject(workingProject);
      await saveProject(workingProject);

      const analyzedVoice = updatedAssets.find((a) => a.role === 'voiceover');
      if (!analyzedVoice || analyzedVoice.analysis?.kind !== 'voice') {
        throw new Error('Voiceover analysis failed.');
      }
      const voiceBlob = blobsMap.get(analyzedVoice.id);
      if (!voiceBlob) {
        throw new Error('Voiceover file missing from local storage.');
      }

      // STAGE B: Speech Transcription & Voice Synchronization
      setProgress({
        stage: 'transcribing_voice',
        stageLabel: 'Stage B · Transcribing & Synchronizing Speech',
        detail: 'Running Gemini speech transcription on master voiceover...',
        percent: 25,
      });

      const rawTranscript = await transcribeAndSyncVoiceover({
        voiceBlob,
        pauses: analyzedVoice.analysis.pauses,
        directorModel: settings.directorModel,
        onProgress: (detail, fraction) => {
          setProgress({
            stage: 'transcribing_voice',
            stageLabel: 'Stage B · Transcribing & Synchronizing Speech',
            detail,
            percent: Math.round(25 + fraction * 15),
          });
        },
      });

      workingProject = {
        ...workingProject,
        transcript: rawTranscript,
      };
      setCurrentProject(workingProject);
      await saveProject(workingProject);

      // STAGE C & D: AI Edit Decision Engine & EDL Validation
      setProgress({
        stage: 'generating_edl',
        stageLabel: 'Stage C · Generating AI Edit Decision List',
        detail:
          'Matching spoken meaning to uploaded footage, zooms, crops, and captions...',
        percent: 42,
      });

      const {edl, updatedTranscript} = await generateProjectEDL({
        assets: updatedAssets,
        transcript: rawTranscript,
        voiceDuration: analyzedVoice.analysis.duration,
        pauses: analyzedVoice.analysis.pauses,
        userScript: workingProject.scriptText,
        editingInstructions: workingProject.editingInstructions,
        presetId: workingProject.preset,
        aspectRatio: workingProject.aspectRatio,
        resolution: workingProject.outputResolution,
        referenceVideoSummary,
        directorModel: settings.directorModel,
      });

      // Save validated EDL to IndexedDB BEFORE FFmpeg rendering for crash recovery
      setProgress({
        stage: 'validating_edl',
        stageLabel: 'Stage D · Timeline Validated & Saved',
        detail: `Verified ${edl.scenes.length} scenes and ${edl.captions.length} caption cues. Starting FFmpeg.wasm...`,
        percent: 54,
      });

      workingProject = {
        ...workingProject,
        name: edl.projectTitle || workingProject.name,
        transcript: updatedTranscript,
        edl,
        lastStage: 'validating_edl',
        updatedAt: Date.now(),
      };
      setCurrentProject(workingProject);
      await saveProject(workingProject);
      await refreshDashboardData();

      // STAGE E, F & G: Audio Mixing, Captions & FFmpeg.wasm Rendering
      await executeFFmpegRenderPhase(workingProject, blobsMap, edl);
    } catch (err) {
      if (err instanceof RenderCancelledError) {
        const interruptedProj: ProjectRecord = {
          ...workingProject,
          status: 'interrupted',
          errorMessage: 'Rendering cancelled by user. Saved EDL is ready to resume.',
          updatedAt: Date.now(),
        };
        setCurrentProject(interruptedProj);
        await saveProject(interruptedProj);
        await refreshDashboardData();
        setProgress((prev) => ({
          ...prev,
          stage: 'cancelled',
          stageLabel: 'Rendering Cancelled',
          detail: 'FFmpeg Web Worker stopped cleanly. Click Retry Render whenever you are ready.',
        }));
      } else {
        const message =
          err instanceof Error ? err.message : 'Unexpected editing pipeline error.';
        const erroredProj: ProjectRecord = {
          ...workingProject,
          status: 'error',
          errorMessage: message,
          updatedAt: Date.now(),
        };
        setCurrentProject(erroredProj);
        await saveProject(erroredProj);
        await refreshDashboardData();
        setProgress((prev) => ({
          ...prev,
          stage: 'error',
          stageLabel: 'Editing Pipeline Error',
          detail: 'Review the error message below and retry.',
          error: message,
        }));
      }
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const handleCancelRender = () => {
    renderControllerRef.current?.cancel();
  };

  // Re-render video directly from an existing/edited EDL without re-transcribing
  const handleRerenderFromEDL = async (
    overrideEdl?: EditDecisionList,
    force720p?: boolean
  ) => {
    if (isPipelineRunning) return;
    const baseEdl = overrideEdl || currentProject.edl;
    if (!baseEdl) return;

    const targetEdl: EditDecisionList = force720p
      ? {...baseEdl, resolution: '720p'}
      : baseEdl;

    setIsPipelineRunning(true);
    setActiveTab('workspace');

    const workingProject: ProjectRecord = {
      ...currentProject,
      status: 'processing',
      outputResolution: targetEdl.resolution,
      aspectRatio: targetEdl.aspectRatio,
      edl: targetEdl,
      errorMessage: undefined,
      updatedAt: Date.now(),
    };
    setCurrentProject(workingProject);
    await saveProject(workingProject);

    try {
      let blobsMap = currentBlobs;
      if (blobsMap.size < workingProject.assets.length) {
        blobsMap = await getProjectMediaBlobs(workingProject.id);
        setCurrentBlobs(blobsMap);
      }
      await executeFFmpegRenderPhase(workingProject, blobsMap, targetEdl);
    } catch (err) {
      if (err instanceof RenderCancelledError) {
        const interrupted: ProjectRecord = {
          ...workingProject,
          status: 'interrupted',
          errorMessage: 'Rendering cancelled.',
        };
        setCurrentProject(interrupted);
        await saveProject(interrupted);
        setProgress((prev) => ({
          ...prev,
          stage: 'cancelled',
          stageLabel: 'Rendering Cancelled',
          detail: 'You can resume rendering at any time.',
        }));
      } else {
        const msg = err instanceof Error ? err.message : 'Video rendering failed.';
        const errored: ProjectRecord = {
          ...workingProject,
          status: 'error',
          errorMessage: msg,
        };
        setCurrentProject(errored);
        await saveProject(errored);
        setProgress((prev) => ({
          ...prev,
          stage: 'error',
          stageLabel: 'Rendering Failed',
          detail: 'Try switching to 720p Low-Memory Mode if your browser ran out of memory.',
          error: msg,
        }));
      }
      await refreshDashboardData();
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Regenerate AI Editing Plan using already-analyzed assets & transcript, then render
  const handleRegeneratePlan = async (presetOverride?: EditingPresetId) => {
    if (isPipelineRunning) return;
    const voiceAsset = currentProject.assets.find((a) => a.role === 'voiceover');
    if (
      !currentProject.transcript ||
      !voiceAsset ||
      voiceAsset.analysis?.kind !== 'voice'
    ) {
      await handleStartOneClickCreate();
      return;
    }

    const chosenPreset = presetOverride || currentProject.preset;
    setIsPipelineRunning(true);
    setActiveTab('workspace');

    let workingProject: ProjectRecord = {
      ...currentProject,
      preset: chosenPreset,
      status: 'processing',
      errorMessage: undefined,
      updatedAt: Date.now(),
    };
    setCurrentProject(workingProject);
    await saveProject(workingProject);

    try {
      let blobsMap = currentBlobs;
      if (blobsMap.size < workingProject.assets.length) {
        blobsMap = await getProjectMediaBlobs(workingProject.id);
        setCurrentBlobs(blobsMap);
      }

      setProgress({
        stage: 'generating_edl',
        stageLabel: 'Regenerating AI Edit Decision List',
        detail: 'Building fresh scene cuts, camera motion, and framing with Gemini...',
        percent: 40,
      });

      const {edl, updatedTranscript} = await generateProjectEDL({
        assets: workingProject.assets,
        transcript: workingProject.transcript!,
        voiceDuration: voiceAsset.analysis.duration,
        pauses: voiceAsset.analysis.pauses,
        userScript: workingProject.scriptText,
        editingInstructions: workingProject.editingInstructions,
        presetId: chosenPreset,
        aspectRatio: workingProject.aspectRatio,
        resolution: workingProject.outputResolution,
        directorModel: settings.directorModel,
      });

      workingProject = {
        ...workingProject,
        name: edl.projectTitle || workingProject.name,
        transcript: updatedTranscript,
        edl,
        updatedAt: Date.now(),
      };
      setCurrentProject(workingProject);
      await saveProject(workingProject);

      await executeFFmpegRenderPhase(workingProject, blobsMap, edl);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to regenerate editing plan.';
      const errored: ProjectRecord = {
        ...workingProject,
        status: 'error',
        errorMessage: msg,
      };
      setCurrentProject(errored);
      await saveProject(errored);
      await refreshDashboardData();
      setProgress((prev) => ({
        ...prev,
        stage: 'error',
        stageLabel: 'Regeneration Error',
        detail: 'Could not complete plan regeneration.',
        error: msg,
      }));
    } finally {
      setIsPipelineRunning(false);
    }
  };

  const hasActiveProject =
    currentProject.assets.length > 0 || Boolean(currentProject.edl);
  const hasRenderedVideo = Boolean(renderedVideoUrl && currentProject.edl);

  return (
    <div className="min-h-screen flex flex-col bg-[#060B16] text-slate-100">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onNewProject={handleStartNewProject}
        onOpenSettings={() => setSettingsOpen(true)}
        hasActiveProject={hasActiveProject}
        hasRenderedVideo={hasRenderedVideo}
      />

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -6}}
              transition={{duration: 0.16}}
            >
              <DashboardView
                projects={projects}
                storageStats={storageStats}
                onCreateNew={handleStartNewProject}
                onOpenProject={handleOpenProject}
                onDeleteProject={handleDeleteProject}
                onClearAllStorage={handleClearAllStorage}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </motion.div>
          )}

          {activeTab === 'create' && (
            <motion.div
              key="create"
              initial={{opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -6}}
              transition={{duration: 0.16}}
            >
              <CreateProjectView
                projectName={currentProject.name}
                onChangeProjectName={(name) =>
                  setCurrentProject((p) => ({...p, name}))
                }
                assets={currentProject.assets}
                onAddFiles={handleAddFiles}
                onRemoveAsset={handleRemoveAsset}
                scriptText={currentProject.scriptText}
                onChangeScriptText={(scriptText) =>
                  setCurrentProject((p) => ({...p, scriptText}))
                }
                editingInstructions={currentProject.editingInstructions}
                onChangeEditingInstructions={(editingInstructions) =>
                  setCurrentProject((p) => ({...p, editingInstructions}))
                }
                preset={currentProject.preset}
                onChangePreset={(preset) =>
                  setCurrentProject((p) => ({...p, preset}))
                }
                outputResolution={currentProject.outputResolution}
                onChangeResolution={(outputResolution) =>
                  setCurrentProject((p) => ({...p, outputResolution}))
                }
                aspectRatio={currentProject.aspectRatio}
                onChangeAspectRatio={(aspectRatio: OutputAspectRatio) =>
                  setCurrentProject((p) => ({...p, aspectRatio}))
                }
                onStartOneClickCreate={handleStartOneClickCreate}
                uploadError={uploadError}
                onClearUploadError={() => setUploadError(null)}
                isBusy={isPipelineRunning}
                deviceMemoryGB={deviceMemoryGB}
              />
            </motion.div>
          )}

          {activeTab === 'workspace' && (
            <motion.div
              key="workspace"
              initial={{opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -6}}
              transition={{duration: 0.16}}
            >
              <EditingWorkspaceView
                project={currentProject}
                progress={progress}
                isRunning={isPipelineRunning}
                onCancelRender={handleCancelRender}
                onRetryFullPipeline={handleStartOneClickCreate}
                onRetryRenderOnly={(force720p) =>
                  handleRerenderFromEDL(undefined, force720p)
                }
                onGoToPreview={() => setActiveTab('preview')}
              />
            </motion.div>
          )}

          {activeTab === 'preview' && (
            <motion.div
              key="preview"
              initial={{opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -6}}
              transition={{duration: 0.16}}
            >
              <FinalPreviewView
                key={`${currentProject.id}_${currentProject.updatedAt}`}
                project={currentProject}
                videoUrl={renderedVideoUrl}
                onUpdateEDL={async (updatedEdl) => {
                  const next: ProjectRecord = {
                    ...currentProject,
                    edl: updatedEdl,
                    aspectRatio: updatedEdl.aspectRatio,
                    outputResolution: updatedEdl.resolution,
                    updatedAt: Date.now(),
                  };
                  setCurrentProject(next);
                  await saveProject(next);
                }}
                onUploadAuxFile={handleUploadAuxFileInPreview}
                onRemoveAuxFile={handleRemoveAsset}
                onRerenderVideo={(edlOverride) =>
                  handleRerenderFromEDL(edlOverride, false)
                }
                onRegeneratePlan={handleRegeneratePlan}
                isBusy={isPipelineRunning}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="hidden md:block border-t border-slate-800/70 py-5 px-8 text-xs text-slate-500">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <span>AI Shorts Editor · Personal Local Video Editing Assistant</span>
          <span>Media stored locally in IndexedDB · Rendered in-browser via FFmpeg.wasm</span>
        </div>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        deviceMemoryGB={deviceMemoryGB}
        storageStats={storageStats}
        onClearAllStorage={handleClearAllStorage}
      />
    </div>
  );
}
