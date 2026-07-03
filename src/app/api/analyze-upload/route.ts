import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeUploadedVideo } from "@/lib/ai";
import { toAnalysisError } from "@/lib/analyze";
import { getUploadedVideo } from "@/lib/uploaded-videos";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  sourceId: z.string().uuid(),
  durationSeconds: z.number().positive().max(86_400).optional()
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const uploadedVideo = await getUploadedVideo(body.sourceId);
    const video = {
      videoId: uploadedVideo.id,
      title: uploadedVideo.fileName.replace(/\.mp4$/i, ""),
      author: "Local upload",
      durationSeconds: body.durationSeconds
    };
    const analysis = await analyzeUploadedVideo({
      video,
      uploadedVideo
    });

    return NextResponse.json({
      ...analysis,
      analysisMode: "uploaded-video",
      transcriptPreview: [],
      transcriptSegmentCount: 0
    });
  } catch (error) {
    const message = toAnalysisError(error);
    console.error("[api/analyze-upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
