import {NextRequest, NextResponse} from 'next/server';
import {
  formatGeminiError,
  getServerGeminiClient,
  resolveDirectorModel,
  TRANSCRIPTION_MODEL,
} from '@/lib/gemini';

export async function GET(req: NextRequest) {
  const start = Date.now();
  const modelParam = req.nextUrl.searchParams.get('model') ?? undefined;
  const directorModel = resolveDirectorModel(modelParam);

  try {
    const ai = getServerGeminiClient();
    const response = await ai.models.generateContent({
      model: directorModel,
      contents: 'Reply with OK',
    });

    const ok = Boolean(response.text);
    return NextResponse.json({
      connected: ok,
      directorModel,
      transcriptionModel: TRANSCRIPTION_MODEL,
      latencyMs: Date.now() - start,
      message: 'Connected to Gemini API via server-side environment key.',
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    return NextResponse.json(
      {
        connected: false,
        directorModel,
        transcriptionModel: TRANSCRIPTION_MODEL,
        latencyMs: Date.now() - start,
        code: formatted.code,
        message: formatted.message,
      },
      {status: formatted.status}
    );
  }
}
