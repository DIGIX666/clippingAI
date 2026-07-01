import {
  buildClipAnalysisPrompt,
  buildUploadedVideoAnalysisPrompt,
  buildYouTubeVideoAnalysisPrompt
} from "@/lib/ai/prompts";
import { createUploadedVideoReadStream, type UploadedVideo } from "@/lib/uploaded-videos";
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

type GeminiFile = {
  name: string;
  uri: string;
  mimeType?: string;
  state?: "PROCESSING" | "ACTIVE" | "FAILED";
  error?: {
    message?: string;
  };
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

export async function analyzeUploadedVideoWithGemini(params: {
  video: VideoMetadata;
  uploadedVideo: UploadedVideo;
}): Promise<AnalyzeResponse> {
  const uploadedFile = await uploadFileToGemini(params.uploadedVideo);

  try {
    const activeFile = await waitForGeminiFile(uploadedFile);

    return await callGemini({
      video: params.video,
      parts: [
        {
          file_data: {
            file_uri: activeFile.uri,
            mime_type: activeFile.mimeType ?? "video/mp4"
          }
        },
        { text: buildUploadedVideoAnalysisPrompt(params.video) }
      ],
      model: process.env.GEMINI_VIDEO_MODEL ?? "gemini-2.5-flash"
    });
  } finally {
    await deleteGeminiFile(uploadedFile.name);
  }
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

async function uploadFileToGemini(uploadedVideo: UploadedVideo): Promise<GeminiFile> {
  const apiKey = getGeminiApiKey();
  const startResponse = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(uploadedVideo.size),
        "x-goog-upload-header-content-type": uploadedVideo.mimeType,
        "x-goog-upload-protocol": "resumable"
      },
      body: JSON.stringify({
        file: {
          display_name: uploadedVideo.fileName
        }
      })
    }
  );

  if (!startResponse.ok) {
    throw new Error(`Gemini file upload could not start: ${await startResponse.text()}`);
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");

  if (!uploadUrl) {
    throw new Error("Gemini did not return a resumable upload URL.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-length": String(uploadedVideo.size),
      "content-type": uploadedVideo.mimeType,
      "x-goog-upload-command": "upload, finalize",
      "x-goog-upload-offset": "0"
    },
    body: createUploadedVideoReadStream(uploadedVideo.id) as unknown as BodyInit,
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  if (!uploadResponse.ok) {
    throw new Error(`Gemini file upload failed: ${await uploadResponse.text()}`);
  }

  const payload = (await uploadResponse.json()) as { file?: GeminiFile };

  if (!payload.file?.name || !payload.file.uri) {
    throw new Error("Gemini returned incomplete uploaded-file metadata.");
  }

  return payload.file;
}

async function waitForGeminiFile(initialFile: GeminiFile): Promise<GeminiFile> {
  let file = initialFile;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (file.state === "ACTIVE") {
      return file;
    }

    if (file.state === "FAILED") {
      throw new Error(file.error?.message ?? "Gemini could not process the uploaded MP4.");
    }

    await sleep(2000);
    file = await getGeminiFile(file.name);
  }

  throw new Error("Gemini timed out while processing the uploaded MP4.");
}

async function getGeminiFile(name: string): Promise<GeminiFile> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    {
      headers: {
        "x-goog-api-key": getGeminiApiKey()
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`Could not read Gemini file status: ${await response.text()}`);
  }

  return (await response.json()) as GeminiFile;
}

async function deleteGeminiFile(name: string): Promise<void> {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      method: "DELETE",
      headers: {
        "x-goog-api-key": getGeminiApiKey()
      }
    });
  } catch (error) {
    console.warn(
      "[gemini] Uploaded file cleanup failed:",
      error instanceof Error ? error.message : error
    );
  }
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to .env before testing.");
  }

  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
