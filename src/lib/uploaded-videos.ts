import { createReadStream, createWriteStream } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { randomUUID } from "crypto";

const uploadDirectory = join(tmpdir(), "clippingai-uploads");
const maxUploadBytes = 1024 * 1024 * 1024;
const sourceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UploadedVideo = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: "video/mp4";
  size: number;
  createdAt: string;
};

type StoredUploadedVideo = Omit<UploadedVideo, "filePath">;

export async function saveUploadedVideo(file: File): Promise<UploadedVideo> {
  validateUploadedFile(file);
  await mkdir(uploadDirectory, { recursive: true });

  const id = randomUUID();
  const filePath = getVideoPath(id);
  const metadata: StoredUploadedVideo = {
    id,
    fileName: basename(file.name).slice(0, 240) || "uploaded-video.mp4",
    mimeType: "video/mp4",
    size: file.size,
    createdAt: new Date().toISOString()
  };

  try {
    const sourceStream = Readable.fromWeb(
      file.stream() as unknown as NodeReadableStream<Uint8Array>
    );
    await pipeline(sourceStream, createWriteStream(filePath, { flags: "wx" }));
    await writeFile(getMetadataPath(id), JSON.stringify(metadata), {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    await Promise.all([
      rm(filePath, { force: true }),
      rm(getMetadataPath(id), { force: true })
    ]);
    throw error;
  }

  return { ...metadata, filePath };
}

export async function getUploadedVideo(sourceId: string): Promise<UploadedVideo> {
  assertValidSourceId(sourceId);

  try {
    const metadata = JSON.parse(
      await readFile(getMetadataPath(sourceId), "utf8")
    ) as StoredUploadedVideo;

    if (metadata.id !== sourceId || metadata.mimeType !== "video/mp4") {
      throw new Error("Uploaded video metadata is invalid.");
    }

    return { ...metadata, filePath: getVideoPath(sourceId) };
  } catch (error) {
    if (error instanceof Error && error.message === "Uploaded video metadata is invalid.") {
      throw error;
    }

    throw new Error(
      "The uploaded MP4 is no longer available. Upload it again before analyzing or exporting."
    );
  }
}

export function createUploadedVideoReadStream(sourceId: string) {
  assertValidSourceId(sourceId);
  return createReadStream(getVideoPath(sourceId));
}

function validateUploadedFile(file: File): void {
  const hasMp4Extension = file.name.toLowerCase().endsWith(".mp4");
  const hasMp4MimeType =
    file.type === "" || file.type === "video/mp4" || file.type === "application/mp4";

  if (!hasMp4Extension || !hasMp4MimeType) {
    throw new Error("Select a valid .mp4 video file.");
  }

  if (file.size === 0) {
    throw new Error("The selected MP4 file is empty.");
  }

  if (file.size > maxUploadBytes) {
    throw new Error("The selected MP4 exceeds the 1 GB local POC limit.");
  }
}

function assertValidSourceId(sourceId: string): void {
  if (!sourceIdPattern.test(sourceId)) {
    throw new Error("Invalid uploaded video identifier.");
  }
}

function getVideoPath(sourceId: string): string {
  return join(uploadDirectory, `${sourceId}.mp4`);
}

function getMetadataPath(sourceId: string): string {
  return join(uploadDirectory, `${sourceId}.json`);
}
