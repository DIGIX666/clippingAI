import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { analyzeTranscript, analyzeYouTubeUrl } from "@/lib/ai";
import {
  compactTranscript,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTranscript
} from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: "A YouTube URL is required." }, { status: 400 });
    }

    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
      return NextResponse.json({ error: "Invalid YouTube URL." }, { status: 400 });
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      const { metadata, transcript } = await fetchYouTubeTranscript(videoId);
      const analysis = await analyzeTranscript({
        video: metadata,
        transcript: compactTranscript(transcript)
      });

      return NextResponse.json({
        ...analysis,
        analysisMode: "transcript",
        transcriptPreview: transcript.slice(0, 12),
        transcriptSegmentCount: transcript.length
      });
    } catch (transcriptError) {
      const transcriptMessage =
        transcriptError instanceof Error ? transcriptError.message : String(transcriptError);
      console.warn(
        "[api/analyze] Transcript unavailable:",
        transcriptMessage
      );

      if (!isGeminiVideoFallbackEnabled()) {
        return NextResponse.json(
          {
            error:
              "No readable public transcript was available for this video. Direct Gemini video analysis is disabled on hosted deployments because it can exceed Vercel request limits. Try a YouTube video with captions enabled, or set ENABLE_GEMINI_VIDEO_FALLBACK=1 to opt into the slower fallback."
          },
          { status: 422 }
        );
      }

      const metadata = await fetchYouTubeMetadata(videoId);
      const analysis = await withTimeout(
        analyzeYouTubeUrl({
          video: metadata,
          youtubeUrl: watchUrl
        }),
        getGeminiVideoFallbackTimeoutMs(),
        "Gemini direct video analysis timed out. Try a video with public captions, or run this fallback in an async worker instead of a Vercel request."
      );

      return NextResponse.json({
        ...analysis,
        analysisMode: "youtube-video",
        transcriptPreview: [],
        transcriptSegmentCount: 0,
        warning:
          "No readable public transcript was available, so Gemini analyzed the YouTube video directly."
      });
    }
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "Gemini returned incomplete clip data. Please retry the analysis."
        : error instanceof Error
          ? error.message
          : "Unexpected analysis error.";
    console.error("[api/analyze]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isGeminiVideoFallbackEnabled(): boolean {
  return process.env.ENABLE_GEMINI_VIDEO_FALLBACK === "1";
}

function getGeminiVideoFallbackTimeoutMs(): number {
  const value = Number.parseInt(process.env.GEMINI_VIDEO_FALLBACK_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 55_000;
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
