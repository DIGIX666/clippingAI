import { NextResponse } from "next/server";
import { createAnalyzeJob } from "@/lib/analyze-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: "A YouTube URL is required." }, { status: 400 });
    }

    const job = await createAnalyzeJob(url);
    return NextResponse.json({ jobId: job.id, job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create analysis job.";
    console.error("[api/analyze-jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
