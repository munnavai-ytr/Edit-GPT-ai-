import {Type} from '@google/genai';
import {NextRequest, NextResponse} from 'next/server';
import {
  formatGeminiError,
  getServerGeminiClient,
  resolveDirectorModel,
  TRANSCRIPTION_MODEL,
  withGeminiRetry,
} from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      audioBase64,
      mimeType = 'audio/wav',
      chunkDuration = 30,
      directorModel: rawModel,
    } = body as {
      audioBase64?: string;
      mimeType?: string;
      chunkDuration?: number;
      directorModel?: string;
    };

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return NextResponse.json(
        {error: 'Missing audioBase64 payload for transcription.'},
        {status: 400}
      );
    }

    const {ai} = getServerGeminiClient(req);
    const directorModel = resolveDirectorModel(rawModel);

    // Pass 1: Verbatim speech transcription via gemini-3.5-transcribe
    let verbatimText = '';
    try {
      const transcribeResp = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: TRANSCRIPTION_MODEL,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioBase64,
                },
              },
              {
                text: 'Transcribe this voiceover audio verbatim. Preserve exact Bengali (বাংলা), English, or mixed Bengali-English words as spoken without translating or altering wording.',
              },
            ],
          },
        })
      );
      verbatimText = (transcribeResp.text ?? '').trim();
    } catch {
      // Fallback to multimodal director model if dedicated transcribe endpoint has transient issue
      verbatimText = '';
    }

    // Pass 2: Timestamped sentence & word alignment anchored to [0, chunkDuration]
    const alignmentPrompt = `You are an audio-visual speech alignment engine.
The attached voiceover audio clip has an exact duration of ${Number(chunkDuration).toFixed(2)} seconds (from 0.00s to ${Number(chunkDuration).toFixed(2)}s).
${verbatimText ? `Reference verbatim transcription from pass 1:\n"""\n${verbatimText}\n"""\n` : ''}
Task:
1. Detect the spoken language ("en" for English, "bn" for Bengali, "mixed" for mixed Bengali-English, or ISO code).
2. Keep the exact spoken words in their original script (Bengali script for বাংলা words, Latin script for English words). NEVER translate or rewrite the speaker's words.
3. Segment the speech into natural sentences or spoken clauses with accurate startTime and endTime in seconds within [0.0, ${Number(chunkDuration).toFixed(2)}].
4. Provide word-level startTime and endTime for each word in every sentence when discernible from the audio; set alignmentPrecision to "word" if word timings are discerned from speech cadence, or "sentence-approximate" if estimated across the sentence.
5. Mark 1-2 high-impact words per sentence with isKeyword: true.`;

    const alignedResp = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: directorModel,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: alignmentPrompt,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              language: {
                type: Type.STRING,
                description: 'Detected language code: en, bn, or mixed.',
              },
              languageLabel: {
                type: Type.STRING,
                description: 'Human-readable language name such as English, Bengali, or Mixed Bengali-English.',
              },
              alignmentPrecision: {
                type: Type.STRING,
                description: '"word" or "sentence-approximate"',
              },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sentence: {type: Type.STRING},
                    startTime: {type: Type.NUMBER},
                    endTime: {type: Type.NUMBER},
                    speaker: {type: Type.STRING},
                    words: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          word: {type: Type.STRING},
                          startTime: {type: Type.NUMBER},
                          endTime: {type: Type.NUMBER},
                          isKeyword: {type: Type.BOOLEAN},
                        },
                        required: ['word', 'startTime', 'endTime'],
                      },
                    },
                  },
                  required: ['sentence', 'startTime', 'endTime', 'words'],
                },
              },
            },
            required: ['language', 'languageLabel', 'alignmentPrecision', 'segments'],
          },
        },
      })
    );

    const parsed = JSON.parse((alignedResp.text ?? '{}').trim());
    return NextResponse.json({
      verbatimText,
      ...parsed,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    return NextResponse.json(
      {error: formatted.message, code: formatted.code},
      {status: formatted.status}
    );
  }
}
