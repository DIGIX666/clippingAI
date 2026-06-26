import { ZodError } from "zod";
import { analyzeTranscript, analyzeYouTubeUrl } from "@/lib/ai";
import type { AnalyzeJobStatus, ApiAnalyzeResponse } from "@/lib/types";
import {
  compactTranscript,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTranscript
} from "@/lib/youtube";

export type AnalysisProgress = {
  status: AnalyzeJobStatus;
  progress: number;
  message: string;
};

type ProgressReporter = (progress: AnalysisProgress) => void | Promise<void>;

export async function runAnalyze(
  url: string,
  reportProgress: ProgressReporter = () => undefined,
  options: { allowVideoFallback?: boolean } = {}
): Promise<ApiAnalyzeResponse> {
  await reportProgress({
    status: "validating_url",
    progress: 8,
    message: "Validating the YouTube URL."
  });

  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    throw new Error("Invalid YouTube URL.");
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    await reportProgress({
      status: "checking_captions",
      progress: 24,
      message: "Looking for public YouTube captions."
    });

    const { metadata, transcript } = await fetchYouTubeTranscript(videoId);

    await reportProgress({
      status: "analyzing_transcript",
      progress: 58,
      message: "Analyzing the transcript with Gemini."
    });

    const analysis = await analyzeTranscript({
      video: metadata,
      transcript: compactTranscript(transcript)
    });

    return {
      ...analysis,
      analysisMode: "transcript",
      transcriptPreview: transcript.slice(0, 12),
      transcriptSegmentCount: transcript.length
    };
  } catch (transcriptError) {
    const transcriptMessage =
      transcriptError instanceof Error ? transcriptError.message : String(transcriptError);
    console.warn("[analyze] Transcript unavailable:", transcriptMessage);

    if (!shouldUseGeminiVideoFallback(options.allowVideoFallback)) {
      throw new Error(
        "No readable public transcript was available for this video. Async hosted analysis can support this path with Gemini direct video fallback enabled, or later with a dedicated audio transcription worker."
      );
    }

    await reportProgress({
      status: "analyzing_video",
      progress: 42,
      message: "No captions found. Asking Gemini to analyze the YouTube video directly."
    });

    const metadata = await fetchYouTubeMetadata(videoId);
    const analysis = await withTimeout(
      analyzeYouTubeUrl({
        video: metadata,
        youtubeUrl: watchUrl
      }),
      getGeminiVideoFallbackTimeoutMs(),
      "Gemini direct video analysis timed out. Keep this path in the async job flow, or move it to a dedicated worker/container for longer videos."
    );

    return {
      ...analysis,
      analysisMode: "youtube-video",
      transcriptPreview: [],
      transcriptSegmentCount: 0,
      warning:
        "No readable public transcript was available, so Gemini analyzed the YouTube video directly."
    };
  }
}

export function toAnalysisError(error: unknown): string {
  if (error instanceof ZodError) {
    return "Gemini returned incomplete clip data. Please retry the analysis.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected analysis error.";
}

function shouldUseGeminiVideoFallback(allowVideoFallback?: boolean): boolean {
  if (allowVideoFallback) {
    return true;
  }

  return process.env.ENABLE_GEMINI_VIDEO_FALLBACK === "1";
}

function getGeminiVideoFallbackTimeoutMs(): number {
  const value = Number.parseInt(process.env.GEMINI_VIDEO_FALLBACK_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 240_000;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}
