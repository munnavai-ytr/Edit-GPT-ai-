import {z} from 'zod';
import {EDITING_PRESETS} from './presets';
import {
  CaptionCue,
  CropMode,
  EDLScene,
  EditDecisionList,
  EditingPresetId,
  MediaAssetMeta,
  OutputAspectRatio,
  OutputResolution,
  SceneTransition,
  SoundEffectType,
  TranscriptData,
  TranscriptWord,
  ZoomAnimation,
} from './types';

const CropModeSchema = z.enum([
  'cover_center',
  'cover_top',
  'cover_bottom',
  'cover_left',
  'cover_right',
  'fit_blur',
]);

const ZoomAnimationSchema = z.enum([
  'none',
  'zoom_in_slow',
  'zoom_out_slow',
  'zoom_in_punch',
  'pan_left_right',
  'pan_right_left',
]);

const TransitionSchema = z.enum([
  'cut',
  'fade',
  'dissolve',
  'wipeleft',
  'slideup',
]);

const SoundEffectSchema = z.enum([
  'none',
  'whoosh_soft',
  'pop_subtle',
  'riser_cinematic',
  'click_clean',
]);

export const RawAISceneSchema = z.object({
  sceneNumber: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  assetId: z.string(),
  sourceInPoint: z.number().optional().default(0),
  sourceOutPoint: z.number().optional().default(3),
  sceneDescription: z.string().default('Visual scene'),
  visualMatchingReason: z.string().default('Matched to spoken narrative'),
  cropMode: CropModeSchema.catch('cover_center'),
  zoomAnimation: ZoomAnimationSchema.catch('zoom_in_slow'),
  transition: TransitionSchema.catch('cut'),
  subtitleText: z.string().default(''),
  highlightKeywords: z.array(z.string()).default([]),
  soundEffect: SoundEffectSchema.catch('none'),
  audioGainDb: z.number().optional().default(0),
});

export const RawAIEDLResponseSchema = z.object({
  projectTitle: z.string().default('Untitled Short'),
  storyArc: z
    .object({
      hookSummary: z.string().default('Opening hook'),
      bodySummary: z.string().default('Core message'),
      endingSummary: z.string().default('Closing takeaway'),
    })
    .default({
      hookSummary: 'Opening hook',
      bodySummary: 'Core message',
      endingSummary: 'Closing takeaway',
    }),
  titleOverlay: z
    .object({
      enabled: z.boolean().default(true),
      text: z.string().default(''),
      subtext: z.string().default(''),
      startTime: z.number().default(0.1),
      endTime: z.number().default(2.6),
      style: z
        .enum(['modern_bold', 'minimal_line', 'kinetic_box'])
        .catch('modern_bold'),
    })
    .default({
      enabled: false,
      text: '',
      subtext: '',
      startTime: 0.1,
      endTime: 2.6,
      style: 'modern_bold',
    }),
  colorGradePreset: z
    .enum([
      'neutral',
      'cinematic_warm',
      'cool_crisp',
      'vibrant',
      'moody_contrast',
      'clean_bright',
    ])
    .catch('clean_bright'),
  musicVolume: z.number().min(0).max(0.5).optional(),
  scenes: z.array(RawAISceneSchema).min(1),
});

const CROP_ROTATION: CropMode[] = [
  'cover_center',
  'cover_top',
  'cover_bottom',
  'cover_left',
  'cover_right',
];

const ZOOM_ROTATION: ZoomAnimation[] = [
  'zoom_in_slow',
  'zoom_out_slow',
  'pan_left_right',
  'zoom_in_punch',
  'pan_right_left',
];

export const MAX_VIDEO_DURATION_SECONDS = 180;

export function buildCaptionsFromTranscript(
  transcript: TranscriptData,
  maxDuration: number,
  sceneKeywords: Map<number, string[]>
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let cueIndex = 0;

  // Gather global keywords from scriptAnalysis + scene highlights
  const globalKeywordSet = new Set<string>(
    (transcript.scriptAnalysis.keywords || []).map((k) =>
      k.trim().toLowerCase()
    )
  );
  sceneKeywords.forEach((list) => {
    list.forEach((k) => {
      if (k.trim()) globalKeywordSet.add(k.trim().toLowerCase());
    });
  });

  for (const seg of transcript.segments) {
    if (seg.startTime >= maxDuration) break;
    const segStart = Math.max(0, seg.startTime);
    const segEnd = Math.min(maxDuration, Math.max(segStart + 0.25, seg.endTime));

    const words =
      seg.words && seg.words.length > 0
        ? seg.words.filter((w) => w.startTime < maxDuration)
        : splitSentenceToTimedWords(seg.sentence, segStart, segEnd);

    // Group words into short readable vertical-video chunks (max 4-5 words per cue)
    const MAX_WORDS_PER_CUE = 4;
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_CUE) {
      const chunk = words.slice(i, i + MAX_WORDS_PER_CUE);
      if (chunk.length === 0) continue;

      const cueStart = Math.max(0, chunk[0].startTime);
      const cueEnd = Math.min(
        maxDuration,
        Math.max(cueStart + 0.25, chunk[chunk.length - 1].endTime)
      );
      const cueText = chunk.map((w) => w.word).join(' ').trim();
      if (!cueText) continue;

      const cueHighlights: string[] = [];
      const cueWords = chunk.map((w) => {
        const cleaned = w.word
          .replace(/[.,!?;:"'()[\]{}।]/g, '')
          .trim()
          .toLowerCase();
        const isHigh =
          Boolean(w.isKeyword) ||
          (cleaned.length >= 3 && globalKeywordSet.has(cleaned));
        if (isHigh) cueHighlights.push(w.word);
        return {
          word: w.word,
          startTime: Math.max(cueStart, w.startTime),
          endTime: Math.min(cueEnd, Math.max(w.startTime + 0.08, w.endTime)),
          highlight: isHigh,
        };
      });

      // Guarantee at least one emphasized word in multi-word cues if none matched
      if (!cueWords.some((cw) => cw.highlight) && cueWords.length >= 2) {
        let longestIdx = 0;
        for (let j = 1; j < cueWords.length; j++) {
          if (cueWords[j].word.length > cueWords[longestIdx].word.length) {
            longestIdx = j;
          }
        }
        if (cueWords[longestIdx].word.length >= 4) {
          cueWords[longestIdx].highlight = true;
          cueHighlights.push(cueWords[longestIdx].word);
        }
      }

      cues.push({
        id: `cue_${cueIndex++}`,
        text: cueText,
        startTime: Number(cueStart.toFixed(3)),
        endTime: Number(cueEnd.toFixed(3)),
        highlightKeywords: cueHighlights,
        words: cueWords,
      });
    }
  }

  return cues;
}

function splitSentenceToTimedWords(
  sentence: string,
  start: number,
  end: number
): TranscriptWord[] {
  const tokens = sentence
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const totalChars = tokens.reduce((sum, t) => sum + Math.max(1, t.length), 0);
  const totalDur = Math.max(0.2, end - start);
  let cursor = start;

  return tokens.map((token, idx) => {
    const weight = Math.max(1, token.length) / totalChars;
    const wordDur =
      idx === tokens.length - 1 ? Math.max(0.06, end - cursor) : totalDur * weight;
    const wStart = cursor;
    const wEnd = Math.min(end, cursor + wordDur);
    cursor = wEnd;
    return {
      word: token,
      startTime: Number(wStart.toFixed(3)),
      endTime: Number(wEnd.toFixed(3)),
    };
  });
}

export function validateAndRepairEDL(params: {
  rawResponse: unknown;
  assets: MediaAssetMeta[];
  transcript: TranscriptData;
  voiceDuration: number;
  presetId: EditingPresetId;
  aspectRatio: OutputAspectRatio;
  resolution: OutputResolution;
}): EditDecisionList {
  const {
    rawResponse,
    assets,
    transcript,
    voiceDuration,
    presetId,
    aspectRatio,
    resolution,
  } = params;

  const notes: string[] = [];
  const totalDuration = Number(
    Math.min(MAX_VIDEO_DURATION_SECONDS, Math.max(1, voiceDuration)).toFixed(3)
  );
  if (voiceDuration > MAX_VIDEO_DURATION_SECONDS) {
    notes.push(
      `Voiceover exceeded 180s limit; capped master timeline at ${MAX_VIDEO_DURATION_SECONDS}s.`
    );
  }

  const visualAssets = assets.filter(
    (a) =>
      a.role === 'video' ||
      a.role === 'image' ||
      a.role === 'extra_video' ||
      a.role === 'extra_image'
  );
  if (visualAssets.length === 0) {
    throw new Error(
      'At least one visual asset (video clip or image) is required to build an Edit Decision List.'
    );
  }

  const visualMap = new Map<string, MediaAssetMeta>(
    visualAssets.map((a) => [a.id, a])
  );
  const musicAsset = assets.find((a) => a.role === 'music') || null;
  const watermarkAsset = assets.find((a) => a.role === 'watermark') || null;
  const customFontAsset = assets.find((a) => a.role === 'custom_font') || null;
  const presetDef = EDITING_PRESETS[presetId] || EDITING_PRESETS.auto;

  const parsed = RawAIEDLResponseSchema.safeParse(rawResponse);
  let rawScenes = parsed.success ? parsed.data.scenes : [];
  if (!parsed.success) {
    notes.push(
      'AI response had schema deviations; rebuilt timeline structure from voiceover segments.'
    );
    rawScenes = transcript.segments.map((seg, i) => ({
      sceneNumber: i + 1,
      startTime: seg.startTime,
      endTime: seg.endTime,
      assetId: visualAssets[i % visualAssets.length].id,
      sourceInPoint: 0,
      sourceOutPoint: Math.max(1.5, seg.endTime - seg.startTime),
      sceneDescription: seg.sentence,
      visualMatchingReason: 'Synchronized directly with spoken sentence boundary.',
      cropMode: CROP_ROTATION[i % CROP_ROTATION.length],
      zoomAnimation: ZOOM_ROTATION[i % ZOOM_ROTATION.length],
      transition: (i === 0 ? 'cut' : 'fade') as SceneTransition,
      subtitleText: seg.sentence,
      highlightKeywords: [],
      soundEffect: (i === 0 && presetDef.sfxDefault
        ? 'whoosh_soft'
        : 'none') as SoundEffectType,
      audioGainDb: 0,
    }));
  }

  // Sort scenes by startTime and repair timeline continuity across [0, totalDuration]
  const sortedRaw = [...rawScenes].sort((a, b) => a.startTime - b.startTime);
  const validScenes: EDLScene[] = [];
  const assetUsageCursor = new Map<string, number>();
  let timelineCursor = 0;

  for (let i = 0; i < sortedRaw.length; i++) {
    if (timelineCursor >= totalDuration - 0.05) break;
    const item = sortedRaw[i];

    // Resolve actual uploaded visual asset (never invent assets)
    let chosenAsset = visualMap.get(item.assetId);
    let reusedFallback = false;
    if (!chosenAsset) {
      chosenAsset = visualAssets[i % visualAssets.length];
      reusedFallback = true;
      notes.push(
        `Scene ${i + 1}: Remapped unknown asset ID "${item.assetId}" to uploaded asset "${chosenAsset.name}".`
      );
    }

    const startTime = Number(timelineCursor.toFixed(3));
    let proposedEnd =
      i === sortedRaw.length - 1
        ? totalDuration
        : Math.min(totalDuration, Math.max(startTime + 1.0, item.endTime));

    // Prevent tiny sliver at the very end
    if (totalDuration - proposedEnd < 0.6) {
      proposedEnd = totalDuration;
    }
    const endTime = Number(proposedEnd.toFixed(3));
    const sceneDur = Math.max(0.5, endTime - startTime);

    // Clamp source in/out points for video assets and advance cursor on reuse
    let sourceIn = Math.max(0, item.sourceInPoint || 0);
    let sourceOut = sourceIn + sceneDur;

    if (chosenAsset.analysis?.kind === 'video') {
      const vidDur = Math.max(0.5, chosenAsset.analysis.duration);
      const prevCursor = assetUsageCursor.get(chosenAsset.id) ?? 0;

      if (sourceIn >= vidDur - 0.3) {
        sourceIn = prevCursor < vidDur - 0.5 ? prevCursor : 0;
      }
      if (sourceIn + sceneDur <= vidDur) {
        sourceOut = sourceIn + sceneDur;
        assetUsageCursor.set(
          chosenAsset.id,
          sourceOut >= vidDur - 0.5 ? 0 : sourceOut
        );
      } else {
        // Clip is shorter than scene duration: start from 0 (renderer loops seamlessly if needed)
        sourceIn = Math.max(0, Math.min(sourceIn, Math.max(0, vidDur - sceneDur)));
        sourceOut = Math.min(vidDur, sourceIn + sceneDur);
        assetUsageCursor.set(chosenAsset.id, 0);
      }
    } else {
      sourceIn = 0;
      sourceOut = sceneDur;
    }

    // If the same asset appears in consecutive scenes, vary crop/zoom automatically so it feels intentional
    let cropMode: CropMode = item.cropMode;
    let zoomAnimation: ZoomAnimation = item.zoomAnimation;
    const prevScene = validScenes[validScenes.length - 1];
    if (
      (reusedFallback || (prevScene && prevScene.assetId === chosenAsset.id)) &&
      prevScene
    ) {
      if (prevScene.cropMode === cropMode) {
        cropMode = CROP_ROTATION[(i + 1) % CROP_ROTATION.length];
      }
      if (prevScene.zoomAnimation === zoomAnimation) {
        zoomAnimation = ZOOM_ROTATION[(i + 1) % ZOOM_ROTATION.length];
      }
    }

    // Ensure still images always have subtle motion unless minimal/none requested
    if (chosenAsset.analysis?.kind === 'image' && zoomAnimation === 'none') {
      zoomAnimation = 'zoom_in_slow';
    }

    validScenes.push({
      sceneNumber: validScenes.length + 1,
      startTime,
      endTime,
      assetId: chosenAsset.id,
      sourceInPoint: Number(sourceIn.toFixed(3)),
      sourceOutPoint: Number(sourceOut.toFixed(3)),
      sceneDescription: item.sceneDescription || chosenAsset.name,
      visualMatchingReason: reusedFallback
        ? `Reused "${chosenAsset.name}" with varied framing to maintain visual continuity.`
        : item.visualMatchingReason,
      cropMode,
      zoomAnimation,
      transition: validScenes.length === 0 ? 'cut' : item.transition,
      subtitleText: item.subtitleText || '',
      subtitleStartTime: startTime,
      subtitleEndTime: endTime,
      highlightKeywords: item.highlightKeywords || [],
      soundEffect: presetDef.sfxDefault ? item.soundEffect : 'none',
      audioGainDb: Math.max(-12, Math.min(6, item.audioGainDb ?? 0)),
    });

    timelineCursor = endTime;
  }

  // Extend final scene if timelineCursor fell short of totalDuration
  if (validScenes.length > 0 && timelineCursor < totalDuration) {
    const last = validScenes[validScenes.length - 1];
    const diff = totalDuration - last.endTime;
    last.endTime = totalDuration;
    last.subtitleEndTime = totalDuration;
    last.sourceOutPoint = Number((last.sourceOutPoint + diff).toFixed(3));
  }

  const sceneKeywordsMap = new Map<number, string[]>();
  validScenes.forEach((s) => sceneKeywordsMap.set(s.sceneNumber, s.highlightKeywords));

  const captions = buildCaptionsFromTranscript(
    transcript,
    totalDuration,
    sceneKeywordsMap
  );

  const fontName =
    customFontAsset?.analysis?.kind === 'font'
      ? customFontAsset.analysis.fontFamilyName
      : 'Plus Jakarta Sans, Noto Sans Bengali, sans-serif';

  const rawData = parsed.success ? parsed.data : null;

  const colorGradePreset = rawData?.colorGradePreset || presetDef.colorGrade.preset;
  const colorGrade = buildColorGradeFromPreset(colorGradePreset, presetDef.colorGrade);

  const hookHeadline =
    rawData?.titleOverlay?.text?.trim() ||
    transcript.scriptAnalysis.hook.split(/\s+/).slice(0, 6).join(' ');

  return {
    projectTitle: rawData?.projectTitle || 'AI Edited Short',
    presetUsed: presetId,
    detectedLanguage: transcript.language || 'en',
    aspectRatio,
    resolution,
    fps: 30,
    totalDuration,
    storyArc: rawData?.storyArc || {
      hookSummary: transcript.scriptAnalysis.hook || 'Opening hook',
      bodySummary: transcript.scriptAnalysis.body || 'Main narrative',
      endingSummary: transcript.scriptAnalysis.ending || 'Closing callout',
    },
    colorGrade,
    titleOverlay: {
      enabled: Boolean(hookHeadline) && totalDuration >= 4,
      text: hookHeadline.slice(0, 48),
      subtext: (rawData?.titleOverlay?.subtext || '').slice(0, 48),
      startTime: 0.15,
      endTime: Math.min(2.6, Math.max(1.4, totalDuration * 0.25)),
      style: rawData?.titleOverlay?.style || 'modern_bold',
    },
    scenes: validScenes,
    captions,
    captionStyle: {
      enabled: true,
      fontFamily: fontName,
      ...presetDef.captionStyle,
    },
    audioMix: {
      voiceVolume: 1.0,
      normalizeVoice: true,
      noiseReduction: true,
      musicAssetId: musicAsset ? musicAsset.id : null,
      musicVolume: rawData?.musicVolume ?? presetDef.musicVolumeDefault,
      musicStartOffset: 0,
      duckingEnabled: true,
      fadeInSeconds: 0.35,
      fadeOutSeconds: Math.min(1.2, totalDuration * 0.15),
      sfxEnabled: presetDef.sfxDefault,
      sfxVolume: 0.22,
    },
    watermark: {
      enabled: Boolean(watermarkAsset),
      assetId: watermarkAsset ? watermarkAsset.id : null,
      position: 'top_right',
      opacity: 0.85,
      scale: 0.14,
    },
    validationNotes: notes,
  };
}

function buildColorGradeFromPreset(
  preset: EditDecisionList['colorGrade']['preset'],
  fallback: EditDecisionList['colorGrade']
): EditDecisionList['colorGrade'] {
  switch (preset) {
    case 'cinematic_warm':
      return {preset, contrast: 1.12, brightness: -0.01, saturation: 1.1};
    case 'cool_crisp':
      return {preset, contrast: 1.08, brightness: 0.0, saturation: 1.03};
    case 'vibrant':
      return {preset, contrast: 1.13, brightness: 0.02, saturation: 1.18};
    case 'moody_contrast':
      return {preset, contrast: 1.16, brightness: -0.03, saturation: 0.94};
    case 'clean_bright':
      return {preset, contrast: 1.05, brightness: 0.02, saturation: 1.06};
    case 'neutral':
      return {preset, contrast: 1.0, brightness: 0.0, saturation: 1.0};
    default:
      return fallback;
  }
}
