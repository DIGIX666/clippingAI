import { NextResponse } from "next/server";
import { runAnalyzeJob } from "@/lib/analyze-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;

  try {
    const job = await runAnalyzeJob(jobId);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis job failed.";
    console.error("[api/analyze-jobs/run]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
