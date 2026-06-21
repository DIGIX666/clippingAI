import { NextResponse } from "next/server";
import { analyzeTranscript } from "@/lib/ai";
import { compactTranscript, extractYouTubeVideoId, fetchYouTubeTranscript } from "@/lib/youtube";

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

    const { metadata, transcript } = await fetchYouTubeTranscript(videoId);
    const analysis = await analyzeTranscript({
      video: metadata,
      transcript: compactTranscript(transcript)
    });

    return NextResponse.json({
      ...analysis,
      transcriptPreview: transcript.slice(0, 12),
      transcriptSegmentCount: transcript.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected analysis error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
