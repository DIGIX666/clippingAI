import {
  analyzeUploadedVideoWithGemini,
  analyzeWithGemini,
  analyzeYouTubeUrlWithGemini
} from "@/lib/ai/gemini";
import type { AnalyzeResponse, VideoMetadata } from "@/lib/types";
import type { UploadedVideo } from "@/lib/uploaded-videos";

export async function analyzeTranscript(params: {
  video: VideoMetadata;
  transcript: string;
}): Promise<AnalyzeResponse> {
  const provider = process.env.AI_PROVIDER ?? "gemini";

  if (provider === "gemini") {
    return analyzeWithGemini(params);
  }

  if (provider === "openai") {
    throw new Error(
      "OpenAI provider is reserved for later. Use AI_PROVIDER=gemini for the current POC."
    );
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

export async function analyzeYouTubeUrl(params: {
  video: VideoMetadata;
  youtubeUrl: string;
}): Promise<AnalyzeResponse> {
  const provider = process.env.AI_PROVIDER ?? "gemini";

  if (provider === "gemini") {
    return analyzeYouTubeUrlWithGemini(params);
  }

  if (provider === "openai") {
    throw new Error(
      "OpenAI provider is reserved for later. Use AI_PROVIDER=gemini for the current POC."
    );
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

export async function analyzeUploadedVideo(params: {
  video: VideoMetadata;
  uploadedVideo: UploadedVideo;
}): Promise<AnalyzeResponse> {
  const provider = process.env.AI_PROVIDER ?? "gemini";

  if (provider === "gemini") {
    return analyzeUploadedVideoWithGemini(params);
  }

  if (provider === "openai") {
    throw new Error(
      "OpenAI provider is reserved for later. Use AI_PROVIDER=gemini for the current POC."
    );
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}
