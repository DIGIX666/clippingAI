import { NextResponse } from "next/server";
import { getAnalyzeJob } from "@/lib/analyze-jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const job = await getAnalyzeJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Analysis job not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
