export type EditingPresetId =
  | 'auto'
  | 'cinematic'
  | 'documentary'
  | 'business'
  | 'educational'
  | 'storytelling'
  | 'viral_fast'
  | 'minimal_clean'
  | 'gaming';

export type RenderMode = 'local' | 'cloud';

export type MediaAssetRole =
  | 'voiceover'
  | 'video'
  | 'image'
  | 'extra_video'
  | 'extra_image'
  | 'music'
  | 'watermark'
  | 'reference_video'
  | 'custom_font';

export interface PauseInterval {
  start: number;
  end: number;
  duration: number;
}

export interface VideoAnalysisData {
  kind: 'video';
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
  fps: number;
  sceneChanges: number[];
  audioPresence: boolean;
  visualContent: string;
  visualTags: string[];
  mood: string;
  thumbnailDataUrl?: string;
}

export interface ImageAnalysisData {
  kind: 'image';
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape' | 'square';
  visualContent: string;
  visualTags: string[];
  mood: string;
  thumbnailDataUrl?: string;
}

export interface VoiceAnalysisData {
  kind: 'voice';
  duration: number;
  sampleRate: number;
  peakDb: number;
  rmsDb: number;
  pauses: PauseInterval[];
  waveformPeaks: number[];
  detectedLanguage?: string;
}

export interface AudioAuxAnalysisData {
  kind: 'audio_aux';
  duration: number;
  sampleRate: number;
}

export interface FontAnalysisData {
  kind: 'font';
  fontFamilyName: string;
}

export type AssetAnalysis =
  | VideoAnalysisData
  | ImageAnalysisData
  | VoiceAnalysisData
  | AudioAuxAnalysisData
  | FontAnalysisData;

export interface MediaAssetMeta {
  id: string;
  projectId: string;
  role: MediaAssetRole;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  analysis?: AssetAnalysis;
}

export interface TranscriptWord {
  word: string;
  startTime: number;
  endTime: number;
  isKeyword?: boolean;
}

export interface TranscriptSegment {
  id: string;
  sentence: string;
  startTime: number;
  endTime: number;
  speaker?: string;
  words: TranscriptWord[];
}

export interface ScriptAnalysis {
  sentences: string[];
  keywords: string[];
  hook: string;
  body: string;
  ending: string;
}

export interface ScriptComparison {
  provided: boolean;
  matchPercentage: number;
  summary: string;
  differences: string[];
}

export interface TranscriptData {
  fullText: string;
  language: string;
  languageLabel: string;
  alignmentPrecision: 'word' | 'sentence-approximate';
  segments: TranscriptSegment[];
  scriptAnalysis: ScriptAnalysis;
  scriptComparison?: ScriptComparison;
}

export type CropMode =
  | 'cover_center'
  | 'cover_top'
  | 'cover_bottom'
  | 'cover_left'
  | 'cover_right'
  | 'fit_blur';

export type ZoomAnimation =
  | 'none'
  | 'zoom_in_slow'
  | 'zoom_out_slow'
  | 'zoom_in_punch'
  | 'pan_left_right'
  | 'pan_right_left';

export type SceneTransition =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'wipeleft'
  | 'slideup';

export type SoundEffectType =
  | 'none'
  | 'whoosh_soft'
  | 'pop_subtle'
  | 'riser_cinematic'
  | 'click_clean';

export type ColorGradePreset =
  | 'neutral'
  | 'cinematic_warm'
  | 'cool_crisp'
  | 'vibrant'
  | 'moody_contrast'
  | 'clean_bright';

export type CaptionStylePreset =
  | 'hormozi_bold'
  | 'clean_boxed'
  | 'minimal_stroke'
  | 'neon_gaming'
  | 'editorial_clean';

export type CaptionPosition = 'bottom_safe' | 'middle_center' | 'upper_third';

export type CaptionAnimation = 'pop' | 'fade' | 'slide_up' | 'none';

export type OutputAspectRatio = '9:16' | '1:1' | '16:9';

export type OutputResolution = '1080p' | '720p';

export interface EDLScene {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  assetId: string;
  sourceInPoint: number;
  sourceOutPoint: number;
  sceneDescription: string;
  visualMatchingReason: string;
  cropMode: CropMode;
  zoomAnimation: ZoomAnimation;
  transition: SceneTransition;
  subtitleText: string;
  subtitleStartTime: number;
  subtitleEndTime: number;
  highlightKeywords: string[];
  soundEffect: SoundEffectType;
  audioGainDb: number;
}

export interface CaptionCueWord {
  word: string;
  startTime: number;
  endTime: number;
  highlight: boolean;
}

export interface CaptionCue {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  highlightKeywords: string[];
  words: CaptionCueWord[];
}

export interface TitleOverlayConfig {
  enabled: boolean;
  text: string;
  subtext: string;
  startTime: number;
  endTime: number;
  style: 'modern_bold' | 'minimal_line' | 'kinetic_box';
}

export interface CaptionStyleConfig {
  enabled: boolean;
  stylePreset: CaptionStylePreset;
  position: CaptionPosition;
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  shadowOpacity: number;
  animation: CaptionAnimation;
}

export interface AudioMixConfig {
  voiceVolume: number;
  normalizeVoice: boolean;
  noiseReduction: boolean;
  musicAssetId: string | null;
  musicVolume: number;
  musicStartOffset: number;
  duckingEnabled: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  sfxEnabled: boolean;
  sfxVolume: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  assetId: string | null;
  position: 'top_right' | 'top_left';
  opacity: number;
  scale: number;
}

export interface ColorGradeConfig {
  preset: ColorGradePreset;
  contrast: number;
  brightness: number;
  saturation: number;
}

export interface EditDecisionList {
  projectTitle: string;
  presetUsed: EditingPresetId;
  detectedLanguage: string;
  aspectRatio: OutputAspectRatio;
  resolution: OutputResolution;
  fps: number;
  totalDuration: number;
  storyArc: {
    hookSummary: string;
    bodySummary: string;
    endingSummary: string;
  };
  colorGrade: ColorGradeConfig;
  titleOverlay: TitleOverlayConfig;
  scenes: EDLScene[];
  captions: CaptionCue[];
  captionStyle: CaptionStyleConfig;
  audioMix: AudioMixConfig;
  watermark: WatermarkConfig;
  validationNotes: string[];
}

export type PipelineStage =
  | 'idle'
  | 'analyzing_media'
  | 'transcribing_voice'
  | 'generating_edl'
  | 'validating_edl'
  | 'uploading_cloud'
  | 'queued_cloud'
  | 'mixing_audio'
  | 'rendering_captions'
  | 'rendering_video'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  stageLabel: string;
  detail: string;
  percent: number;
  sceneCurrent?: number;
  sceneTotal?: number;
  startedAt?: number;
  error?: string;
}

export type ProjectStatus =
  | 'draft'
  | 'processing'
  | 'cloud_queued'
  | 'interrupted'
  | 'completed'
  | 'error';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: ProjectStatus;
  renderMode?: RenderMode;
  cloudJobId?: string;
  lastStage?: PipelineStage;
  errorMessage?: string;
  preset: EditingPresetId;
  scriptText: string;
  editingInstructions: string;
  outputResolution: OutputResolution;
  aspectRatio: OutputAspectRatio;
  assets: MediaAssetMeta[];
  transcript?: TranscriptData;
  edl?: EditDecisionList;
  renderedVideoMeta?: {
    sizeBytes: number;
    duration: number;
    width: number;
    height: number;
    completedAt: number;
  };
}

export interface AppSettings {
  directorModel: string;
  transcriptionModel: string;
  defaultResolution: OutputResolution;
  defaultRenderMode: RenderMode;
  autoLowMemoryFallback: boolean;
}

// --- BYOK API KEY VAULT TYPES ---
export interface StoredApiKeySummary {
  id: string;
  label: string;
  maskedPreview: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastTestedAt?: number;
  lastTestStatus?: 'valid' | 'invalid' | 'quota_exceeded' | 'error';
  lastTestMessage?: string;
}

// --- CLOUD INFRASTRUCTURE & PERSISTENT JOB TYPES ---
export type CloudJobState =
  | 'QUEUED'
  | 'UPLOADING'
  | 'ANALYZING'
  | 'PLANNING'
  | 'RENDERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CloudJobRecord {
  id: string;
  projectId: string;
  projectName: string;
  state: CloudJobState;
  uploadStatus: StepStatus;
  analysisStatus: StepStatus;
  planStatus: StepStatus;
  renderStatus: StepStatus;
  completionStatus: 'incomplete' | 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  progressDetail: string;
  errorDetails: string | null;
  r2Prefix: string;
  manifestKey: string | null;
  outputVideoKey: string | null;
  outputVideoSignedUrl?: string | null;
  outputSignedUrlExpiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CloudConnectionSettings {
  cfAccountId: string;
  cfApiToken: string;
  cfD1DatabaseId: string;
  cfQueueId: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  workerWakeUrl?: string;
  workerSharedSecret?: string;
}

export interface CloudManifestSceneOverlay {
  r2Key: string;
  x: number;
  y: number;
  localStart: number;
  localEnd: number;
}

export interface CloudRenderManifest {
  version: 1;
  jobId: string;
  projectId: string;
  projectName: string;
  createdAt: number;
  width: number;
  height: number;
  fps: number;
  totalDuration: number;
  masterAudioKey: string;
  watermark?: {
    r2Key: string;
    x: number;
    y: number;
  } | null;
  scenes: Array<{
    sceneIndex: number;
    assetKind: 'video' | 'image';
    assetDuration: number;
    assetExt: string;
    sourceR2Key: string;
    sourceInPoint: number;
    duration: number;
    cropMode: CropMode;
    zoomAnimation: ZoomAnimation;
    fadeIn: boolean;
    fadeOut: boolean;
    fadeOutDuration: number;
    contrast: number;
    brightness: number;
    saturation: number;
    overlays: CloudManifestSceneOverlay[];
  }>;
}
