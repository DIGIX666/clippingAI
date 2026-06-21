import { NextResponse } from "next/server";
import { analyzeTranscript, analyzeYouTubeUrl } from "@/lib/ai";
import {
  compactTranscript,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTranscript
} from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      console.warn(
        "[api/analyze] Transcript unavailable, falling back to Gemini YouTube video input:",
        transcriptError instanceof Error ? transcriptError.message : transcriptError
      );

      const metadata = await fetchYouTubeMetadata(videoId);
      const analysis = await analyzeYouTubeUrl({
        video: metadata,
        youtubeUrl: watchUrl
      });

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
    const message = error instanceof Error ? error.message : "Unexpected analysis error.";
    console.error("[api/analyze]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
