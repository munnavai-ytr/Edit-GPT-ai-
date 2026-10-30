import {Type} from '@google/genai';
import {NextRequest, NextResponse} from 'next/server';
import {
  formatGeminiError,
  getServerGeminiClient,
  resolveDirectorModel,
  withGeminiRetry,
} from '@/lib/gemini';
import {EDITING_PRESETS} from '@/lib/presets';
import {EditingPresetId} from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      voiceDuration,
      pauses,
      transcriptSegments,
      fullTranscriptText,
      detectedLanguage,
      userScript,
      editingInstructions,
      presetId = 'auto',
      visualAssets,
      referenceVideoSummary,
      directorModel: rawModel,
    } = body as {
      voiceDuration: number;
      pauses: Array<{start: number; end: number; duration: number}>;
      transcriptSegments: Array<{
        sentence: string;
        startTime: number;
        endTime: number;
      }>;
      fullTranscriptText: string;
      detectedLanguage: string;
      userScript?: string;
      editingInstructions?: string;
      presetId?: EditingPresetId;
      visualAssets: Array<{
        id: string;
        name: string;
        kind: 'video' | 'image';
        duration?: number;
        aspectRatio?: string;
        sceneChanges?: number[];
        visualContent: string;
        visualTags: string[];
        mood: string;
      }>;
      referenceVideoSummary?: string;
      directorModel?: string;
    };

    if (!visualAssets || visualAssets.length === 0) {
      return NextResponse.json(
        {error: 'At least one analyzed visual asset is required.'},
        {status: 400}
      );
    }

    const {ai} = getServerGeminiClient(req);
    const directorModel = resolveDirectorModel(rawModel);
    const preset = EDITING_PRESETS[presetId] || EDITING_PRESETS.auto;
    const cappedDuration = Math.min(180, Math.max(1, Number(voiceDuration) || 10));

    const systemInstruction = `You are a Senior Short-Form Video Editor and AI Director creating a frame-accurate JSON Edit Decision List (EDL) for YouTube Shorts, Instagram Reels, and TikTok.

STRICT ENGINEERING RULES:
1. The uploaded voiceover is the immutable MASTER TIMELINE (0.00s to ${cappedDuration.toFixed(2)}s). Never cut spoken words or invent timestamps beyond ${cappedDuration.toFixed(2)}s.
2. ONLY select assetId values from the provided UPLOADED VISUAL ASSETS list: [${visualAssets.map((v) => `"${v.id}"`).join(', ')}]. Never invent filenames or asset IDs.
3. If fewer visual assets exist than scenes, reuse available assets intelligently with DIFFERENT cropMode ("cover_center", "cover_top", "cover_bottom", "cover_left", "cover_right", "fit_blur") and DIFFERENT zoomAnimation ("zoom_in_slow", "zoom_out_slow", "zoom_in_punch", "pan_left_right", "pan_right_left") and non-overlapping sourceInPoint/sourceOutPoint ranges so the edit feels dynamic and varied.
4. For video assets, sourceInPoint and sourceOutPoint must stay within [0, asset.duration]. Avoid internal video cut glitches by aligning with asset sceneChanges when helpful.
5. Target scene duration for preset "${preset.name}": ${preset.targetSceneSeconds[0]}s to ${preset.targetSceneSeconds[1]}s (${preset.pacingDescription}). Keep visual pacing brisk during silent pauses without trimming the voiceover audio.
6. Avoid excessive transitions or random effects. Use mostly clean "cut" transitions, reserving "fade", "dissolve", "wipeleft", or "slideup" for genuine topic/emotional shifts.
7. Preserve original language (${detectedLanguage}) in subtitleText and highlightKeywords (supports English, Bengali বাংলা, or Mixed).`;

    const promptPayload = JSON.stringify(
      {
        masterVoiceDurationSeconds: Number(cappedDuration.toFixed(2)),
        detectedPauses: (pauses || []).slice(0, 25),
        spokenTranscriptSegments: transcriptSegments,
        fullTranscriptText,
        optionalUserScriptProvided: Boolean(userScript && userScript.trim()),
        optionalUserScript: userScript?.trim() || null,
        preset: {
          id: preset.id,
          name: preset.name,
          guidance: preset.aiPromptGuidance,
        },
        userEditingInstructions: editingInstructions?.trim() || null,
        referenceVideoInspiration: referenceVideoSummary || null,
        uploadedVisualAssets: visualAssets,
      },
      null,
      2
    );

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: directorModel,
        contents: `Generate the complete Edit Decision List (EDL), script structure analysis, and optional script-vs-voiceover comparison for this project:\n\n${promptPayload}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scriptAnalysis: {
                type: Type.OBJECT,
                properties: {
                  keywords: {
                    type: Type.ARRAY,
                    items: {type: Type.STRING},
                  },
                  hook: {type: Type.STRING},
                  body: {type: Type.STRING},
                  ending: {type: Type.STRING},
                },
                required: ['keywords', 'hook', 'body', 'ending'],
              },
              scriptComparison: {
                type: Type.OBJECT,
                properties: {
                  matchPercentage: {type: Type.NUMBER},
                  summary: {type: Type.STRING},
                  differences: {
                    type: Type.ARRAY,
                    items: {type: Type.STRING},
                  },
                },
                required: ['matchPercentage', 'summary', 'differences'],
              },
              edl: {
                type: Type.OBJECT,
                properties: {
                  projectTitle: {type: Type.STRING},
                  storyArc: {
                    type: Type.OBJECT,
                    properties: {
                      hookSummary: {type: Type.STRING},
                      bodySummary: {type: Type.STRING},
                      endingSummary: {type: Type.STRING},
                    },
                    required: ['hookSummary', 'bodySummary', 'endingSummary'],
                  },
                  titleOverlay: {
                    type: Type.OBJECT,
                    properties: {
                      enabled: {type: Type.BOOLEAN},
                      text: {type: Type.STRING},
                      subtext: {type: Type.STRING},
                      startTime: {type: Type.NUMBER},
                      endTime: {type: Type.NUMBER},
                      style: {type: Type.STRING},
                    },
                    required: ['enabled', 'text', 'subtext', 'startTime', 'endTime', 'style'],
                  },
                  colorGradePreset: {type: Type.STRING},
                  musicVolume: {type: Type.NUMBER},
                  scenes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        sceneNumber: {type: Type.INTEGER},
                        startTime: {type: Type.NUMBER},
                        endTime: {type: Type.NUMBER},
                        assetId: {type: Type.STRING},
                        sourceInPoint: {type: Type.NUMBER},
                        sourceOutPoint: {type: Type.NUMBER},
                        sceneDescription: {type: Type.STRING},
                        visualMatchingReason: {type: Type.STRING},
                        cropMode: {type: Type.STRING},
                        zoomAnimation: {type: Type.STRING},
                        transition: {type: Type.STRING},
                        subtitleText: {type: Type.STRING},
                        highlightKeywords: {
                          type: Type.ARRAY,
                          items: {type: Type.STRING},
                        },
                        soundEffect: {type: Type.STRING},
                        audioGainDb: {type: Type.NUMBER},
                      },
                      required: [
                        'sceneNumber',
                        'startTime',
                        'endTime',
                        'assetId',
                        'sourceInPoint',
                        'sourceOutPoint',
                        'sceneDescription',
                        'visualMatchingReason',
                        'cropMode',
                        'zoomAnimation',
                        'transition',
                        'subtitleText',
                        'highlightKeywords',
                        'soundEffect',
                      ],
                    },
                  },
                },
                required: [
                  'projectTitle',
                  'storyArc',
                  'titleOverlay',
                  'colorGradePreset',
                  'scenes',
                ],
              },
            },
            required: ['scriptAnalysis', 'scriptComparison', 'edl'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return NextResponse.json(parsed);
  } catch (err) {
    const formatted = formatGeminiError(err);
    return NextResponse.json(
      {error: formatted.message, code: formatted.code},
      {status: formatted.status}
    );
  }
}
