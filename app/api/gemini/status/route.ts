import {NextRequest, NextResponse} from 'next/server';
import {
  formatGeminiError,
  getServerGeminiClient,
  resolveDirectorModel,
  TRANSCRIPTION_MODEL,
} from '@/lib/gemini';

async function runStatusProbe(req: NextRequest, requestedModel?: string) {
  const start = Date.now();
  const directorModel = resolveDirectorModel(requestedModel);

  try {
    const {ai, keySource} = getServerGeminiClient(req);
    const response = await ai.models.generateContent({
      model: directorModel,
      contents: 'Reply with OK',
    });

    const ok = Boolean(response.text);
    return NextResponse.json({
      connected: ok,
      keySource,
      directorModel,
      transcriptionModel: TRANSCRIPTION_MODEL,
      latencyMs: Date.now() - start,
      message:
        keySource === 'byok'
          ? 'Connected using your active encrypted BYOK Gemini API key.'
          : 'Connected using server environment Gemini API key.',
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    const hasHeader = Boolean(req.headers.get('x-gemini-api-key')?.trim());
    return NextResponse.json(
      {
        connected: false,
        keySource: hasHeader ? 'byok' : 'none',
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

export async function GET(req: NextRequest) {
  const modelParam = req.nextUrl.searchParams.get('model') ?? undefined;
  return runStatusProbe(req, modelParam);
}

export async function POST(req: NextRequest) {
  let modelParam: string | undefined;
  try {
    const body = await req.json();
    modelParam = body?.model;
  } catch {
    modelParam = undefined;
  }
  return runStatusProbe(req, modelParam);
}
