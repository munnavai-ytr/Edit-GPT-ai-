import {Type} from '@google/genai';
import {NextRequest, NextResponse} from 'next/server';
import {
  formatGeminiError,
  getServerGeminiClient,
  resolveDirectorModel,
  withGeminiRetry,
} from '@/lib/gemini';

interface VisualInputItem {
  id: string;
  name: string;
  kind: 'video' | 'image';
  framesBase64: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {items, directorModel: rawModel} = body as {
      items?: VisualInputItem[];
      directorModel?: string;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({results: []});
    }

    const {ai} = getServerGeminiClient(req);
    const directorModel = resolveDirectorModel(rawModel);

    const parts: Array<
      | {text: string}
      | {inlineData: {mimeType: string; data: string}}
    > = [];

    parts.push({
      text: `Analyze the following uploaded visual assets for a vertical short-form video editor.
For each asset ID, inspect its keyframe image(s) and describe:
1. visualContent: Concise factual description of subjects, action, setting, and framing.
2. visualTags: 3-6 specific keywords for semantic matching with a voiceover script.
3. mood: Emotional tone (e.g., energetic, calm, dramatic, informative, warm).`,
    });

    for (const item of items) {
      parts.push({
        text: `Asset ID: "${item.id}" | Filename: "${item.name}" | Type: ${item.kind}`,
      });
      for (const frameB64 of item.framesBase64.slice(0, 2)) {
        const cleanB64 = frameB64.replace(/^data:image\/\w+;base64,/, '');
        if (cleanB64) {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanB64,
            },
          });
        }
      }
    }

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: directorModel,
        contents: {parts},
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: {type: Type.STRING},
                visualContent: {type: Type.STRING},
                visualTags: {
                  type: Type.ARRAY,
                  items: {type: Type.STRING},
                },
                mood: {type: Type.STRING},
              },
              required: ['id', 'visualContent', 'visualTags', 'mood'],
            },
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '[]').trim());
    return NextResponse.json({results: parsed});
  } catch (err) {
    const formatted = formatGeminiError(err);
    return NextResponse.json(
      {error: formatted.message, code: formatted.code},
      {status: formatted.status}
    );
  }
}
