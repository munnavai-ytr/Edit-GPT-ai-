import {validateAndRepairEDL} from './edl-validator';
import {
  EditDecisionList,
  EditingPresetId,
  MediaAssetMeta,
  OutputAspectRatio,
  OutputResolution,
  PauseInterval,
  TranscriptData,
} from './types';

export async function generateProjectEDL(params: {
  assets: MediaAssetMeta[];
  transcript: TranscriptData;
  voiceDuration: number;
  pauses: PauseInterval[];
  userScript: string;
  editingInstructions: string;
  presetId: EditingPresetId;
  aspectRatio: OutputAspectRatio;
  resolution: OutputResolution;
  referenceVideoSummary?: string;
  directorModel: string;
}): Promise<{edl: EditDecisionList; updatedTranscript: TranscriptData}> {
  const {
    assets,
    transcript,
    voiceDuration,
    pauses,
    userScript,
    editingInstructions,
    presetId,
    aspectRatio,
    resolution,
    referenceVideoSummary,
    directorModel,
  } = params;

  const visualAssetsPayload = assets
    .filter(
      (a) =>
        a.role === 'video' ||
        a.role === 'image' ||
        a.role === 'extra_video' ||
        a.role === 'extra_image'
    )
    .map((a) => {
      if (a.analysis?.kind === 'video') {
        return {
          id: a.id,
          name: a.name,
          kind: 'video' as const,
          duration: a.analysis.duration,
          aspectRatio: a.analysis.aspectRatio,
          sceneChanges: a.analysis.sceneChanges,
          visualContent: a.analysis.visualContent,
          visualTags: a.analysis.visualTags,
          mood: a.analysis.mood,
        };
      }
      return {
        id: a.id,
        name: a.name,
        kind: 'image' as const,
        aspectRatio:
          a.analysis?.kind === 'image' ? a.analysis.orientation : 'portrait',
        visualContent:
          a.analysis?.kind === 'image'
            ? a.analysis.visualContent
            : 'Uploaded image',
        visualTags:
          a.analysis?.kind === 'image' ? a.analysis.visualTags : [],
        mood: a.analysis?.kind === 'image' ? a.analysis.mood : 'neutral',
      };
    });

  const res = await fetch('/api/gemini/generate-edl', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      voiceDuration,
      pauses,
      transcriptSegments: transcript.segments.map((s) => ({
        sentence: s.sentence,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      fullTranscriptText: transcript.fullText,
      detectedLanguage: transcript.language,
      userScript,
      editingInstructions,
      presetId,
      visualAssets: visualAssetsPayload,
      referenceVideoSummary,
      directorModel,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to generate AI Edit Decision List.');
  }

  const updatedTranscript: TranscriptData = {
    ...transcript,
    scriptAnalysis: {
      sentences: transcript.segments.map((s) => s.sentence),
      keywords: Array.isArray(data.scriptAnalysis?.keywords)
        ? data.scriptAnalysis.keywords
        : transcript.scriptAnalysis.keywords,
      hook: data.scriptAnalysis?.hook || transcript.scriptAnalysis.hook,
      body: data.scriptAnalysis?.body || transcript.scriptAnalysis.body,
      ending: data.scriptAnalysis?.ending || transcript.scriptAnalysis.ending,
    },
    scriptComparison: userScript.trim()
      ? {
          provided: true,
          matchPercentage:
            typeof data.scriptComparison?.matchPercentage === 'number'
              ? Math.max(0, Math.min(100, Math.round(data.scriptComparison.matchPercentage)))
              : 90,
          summary:
            data.scriptComparison?.summary ||
            'Compared provided script against master voiceover.',
          differences: Array.isArray(data.scriptComparison?.differences)
            ? data.scriptComparison.differences
            : [],
        }
      : undefined,
  };

  const edl = validateAndRepairEDL({
    rawResponse: data.edl,
    assets,
    transcript: updatedTranscript,
    voiceDuration,
    presetId,
    aspectRatio,
    resolution,
  });

  return {edl, updatedTranscript};
}
