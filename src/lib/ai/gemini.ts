import { buildClipAnalysisPrompt } from "@/lib/ai/prompts";
import { analyzeResponseSchema, type AnalyzeResponse, type VideoMetadata } from "@/lib/types";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export async function analyzeWithGemini(params: {
  video: VideoMetadata;
  transcript: string;
}): Promise<AnalyzeResponse> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to .env.local before testing.");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const prompt = buildClipAnalysisPrompt(params.video, params.transcript);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.45,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Gemini request failed: ${details}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini did not return any text.");
  }

  const parsed = JSON.parse(text) as unknown;
  const clipsOnly = analyzeResponseSchema.shape.clips.parse((parsed as { clips?: unknown }).clips);

  return analyzeResponseSchema.parse({
    video: params.video,
    clips: clipsOnly
  });
}
