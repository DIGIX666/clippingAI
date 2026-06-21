import { buildClipAnalysisPrompt, buildYouTubeVideoAnalysisPrompt } from "@/lib/ai/prompts";
import {
  analyzeResponseSchema,
  type AnalyzeResponse,
  type ClipCandidate,
  type VideoMetadata
} from "@/lib/types";

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
  return callGemini({
    video: params.video,
    parts: [{ text: buildClipAnalysisPrompt(params.video, params.transcript) }],
    model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite"
  });
}

export async function analyzeYouTubeUrlWithGemini(params: {
  video: VideoMetadata;
  youtubeUrl: string;
}): Promise<AnalyzeResponse> {
  return callGemini({
    video: params.video,
    parts: [
      {
        file_data: {
          file_uri: params.youtubeUrl,
          mime_type: "video/*"
        }
      },
      { text: buildYouTubeVideoAnalysisPrompt(params.video) }
    ],
    model: process.env.GEMINI_VIDEO_MODEL ?? "gemini-2.5-flash"
  });
}

async function callGemini(params: {
  video: VideoMetadata;
  parts: Array<{ text: string } | { file_data: { file_uri: string; mime_type?: string } }>;
  model: string;
}): Promise<AnalyzeResponse> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to .env.local before testing.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: params.parts
        }
      ],
      generation_config: {
        temperature: 0.45,
        response_mime_type: "application/json",
        media_resolution: "MEDIA_RESOLUTION_LOW"
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
  const clipsOnly = analyzeResponseSchema.shape.clips.parse(normalizeGeminiClips(parsed));

  return analyzeResponseSchema.parse({
    video: params.video,
    clips: clipsOnly
  });
}

function normalizeGeminiClips(parsed: unknown): ClipCandidate[] {
  const clips = (parsed as { clips?: unknown }).clips;

  if (!Array.isArray(clips)) {
    throw new Error("Gemini returned JSON without a clips array.");
  }

  return clips.map((clip, index) => {
    const value = clip as Partial<ClipCandidate>;
    const startTime = Number(value.startTime ?? 0);
    const endTime = Number(value.endTime ?? startTime + 45);
    const title = String(value.title ?? `Clip ${index + 1}`);
    const hook = String(value.hook ?? title);
    const subtitles = String(value.subtitles ?? value.description ?? hook);
    const description = String(value.description ?? value.reason ?? hook);
    const reason = String(value.reason ?? "Gemini selected this moment as a candidate clip.");
    const hashtags = Array.isArray(value.hashtags) ? value.hashtags : [];

    return {
      id: String(value.id ?? `clip-${index + 1}`),
      startTime,
      endTime,
      hook,
      subtitles,
      reason,
      score: Number(value.score ?? 75),
      title,
      description,
      hashtags: hashtags
        .filter((hashtag): hashtag is string => typeof hashtag === "string")
        .map((hashtag) => (hashtag.startsWith("#") ? hashtag : `#${hashtag}`))
        .slice(0, 12)
    };
  });
}
