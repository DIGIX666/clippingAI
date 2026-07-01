import { NextResponse } from "next/server";
import { z } from "zod";
import { renderClipToMp4 } from "@/lib/mp4";

export const runtime = "nodejs";
export const maxDuration = 300;

const exportRequestSchema = z.object({
  source: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("youtube"),
      url: z.string().url()
    }),
    z.object({
      type: z.literal("upload"),
      sourceId: z.string().uuid()
    })
  ]),
  includeCaptions: z.boolean().default(true),
  clip: z.object({
    id: z.string(),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
    hook: z.string().min(1),
    subtitles: z.string().min(1)
  })
});

export async function POST(request: Request) {
  try {
    const body = exportRequestSchema.parse(await request.json());
    const mp4 = await renderClipToMp4({
      source: body.source,
      startTime: body.clip.startTime,
      endTime: body.clip.endTime,
      hook: body.clip.hook,
      subtitles: body.clip.subtitles,
      includeCaptions: body.includeCaptions
    });

    const bodyBuffer = new Uint8Array(mp4);

    return new NextResponse(bodyBuffer, {
      headers: {
        "content-disposition": `attachment; filename="${body.clip.id}.mp4"`,
        "content-length": String(mp4.length),
        "content-type": "video/mp4"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MP4 export failed.";
    console.error("[api/export-mp4]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
