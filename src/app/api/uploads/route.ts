import { NextResponse } from "next/server";
import { saveUploadedVideo } from "@/lib/uploaded-videos";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new Error("Missing MP4 file.");
    }

    const uploaded = await saveUploadedVideo(file);

    return NextResponse.json(
      {
        sourceId: uploaded.id,
        fileName: uploaded.fileName,
        size: uploaded.size
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "MP4 upload failed.";
    console.error("[api/uploads]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
