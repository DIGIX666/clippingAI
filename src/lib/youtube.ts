import type { TranscriptSegment, VideoMetadata } from "@/lib/types";

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: Array<{ text: string }> };
  kind?: string;
};

type PlayerResponse = {
  videoDetails?: {
    title?: string;
    lengthSeconds?: string;
    author?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
};

type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
};

type Json3Transcript = {
  events?: Json3Event[];
};

export function extractYouTubeVideoId(input: string): string | null {
  const value = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (url.hostname.includes("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) {
        return watchId;
      }

      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }

      const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) {
        return embedMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<{
  metadata: VideoMetadata;
  transcript: TranscriptSegment[];
}> {
  const { metadata, captionTracks } = await fetchYouTubeMetadataAndCaptions(videoId);

  if (captionTracks.length === 0) {
    throw new Error(
      "No public transcript was found for this video. Try another video with captions enabled."
    );
  }

  const transcript = await fetchFirstReadableCaptionTrack(captionTracks);

  if (transcript.length === 0) {
    throw new Error(
      "Caption tracks were found, but none contained readable transcript text. This often happens with music videos, premieres, or videos without real captions."
    );
  }

  return { metadata, transcript };
}

export async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata> {
  const { metadata } = await fetchYouTubeMetadataAndCaptions(videoId);
  return metadata;
}

async function fetchYouTubeMetadataAndCaptions(videoId: string): Promise<{
  metadata: VideoMetadata;
  captionTracks: CaptionTrack[];
}> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(watchUrl, {
    headers: {
      "accept-language": "en-US,en;q=0.9,fr;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    },
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error("YouTube did not return the video page.");
  }

  const html = await response.text();
  const playerResponse = parsePlayerResponse(html);
  const metadata = extractMetadata(videoId, playerResponse);
  const captionTracks =
    playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return { metadata, captionTracks };
}

function parsePlayerResponse(html: string): PlayerResponse {
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);

  if (start === -1) {
    throw new Error("Could not find YouTube player metadata.");
  }

  const jsonStart = start + marker.length;
  const jsonEnd = findJsonObjectEnd(html, jsonStart);
  const rawJson = html.slice(jsonStart, jsonEnd);

  try {
    return JSON.parse(rawJson) as PlayerResponse;
  } catch {
    throw new Error("Could not parse YouTube player metadata.");
  }
}

function findJsonObjectEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  throw new Error("Could not isolate YouTube player metadata.");
}

function extractMetadata(videoId: string, playerResponse: PlayerResponse): VideoMetadata {
  const details = playerResponse.videoDetails;

  return {
    videoId,
    title: details?.title ?? "Untitled YouTube video",
    author: details?.author,
    durationSeconds: details?.lengthSeconds ? Number(details.lengthSeconds) : undefined
  };
}

function orderCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const manualTracks = tracks.filter((track) => track.kind !== "asr");
  const candidates = manualTracks.length > 0 ? manualTracks : tracks;
  const english = candidates.filter((track) => track.languageCode?.startsWith("en"));
  const french = candidates.filter((track) => track.languageCode?.startsWith("fr"));
  const remaining = candidates.filter(
    (track) => !track.languageCode?.startsWith("en") && !track.languageCode?.startsWith("fr")
  );

  return [...english, ...french, ...remaining];
}

async function fetchFirstReadableCaptionTrack(
  tracks: CaptionTrack[]
): Promise<TranscriptSegment[]> {
  const orderedTracks = orderCaptionTracks(tracks);

  for (const track of orderedTracks) {
    try {
      const transcript = await fetchCaptionTrack(track.baseUrl);

      if (transcript.length > 0) {
        return transcript;
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchCaptionTrack(baseUrl: string): Promise<TranscriptSegment[]> {
  const jsonUrl = new URL(baseUrl);
  jsonUrl.searchParams.set("fmt", "json3");
  const jsonBody = await fetchCaptionText(jsonUrl);

  if (jsonBody.trim()) {
    try {
      const payload = JSON.parse(jsonBody) as Json3Transcript;
      const transcript = parseJson3Transcript(payload);

      if (transcript.length > 0) {
        return transcript;
      }
    } catch {
      // Fall through to XML/VTT formats.
    }
  }

  const xmlUrl = new URL(baseUrl);
  xmlUrl.searchParams.delete("fmt");
  const xmlBody = await fetchCaptionText(xmlUrl);
  const xmlTranscript = parseXmlTranscript(xmlBody);

  if (xmlTranscript.length > 0) {
    return xmlTranscript;
  }

  const vttUrl = new URL(baseUrl);
  vttUrl.searchParams.set("fmt", "vtt");
  const vttBody = await fetchCaptionText(vttUrl);
  return parseVttTranscript(vttBody);
}

async function fetchCaptionText(url: URL): Promise<string> {
  const response = await fetch(url.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    },
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error("Could not fetch the YouTube transcript track.");
  }

  return response.text();
}

function parseJson3Transcript(payload: Json3Transcript): TranscriptSegment[] {
  return (payload.events ?? [])
    .map((event) => {
      const text = (event.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      return {
        start: (event.tStartMs ?? 0) / 1000,
        duration: (event.dDurationMs ?? 0) / 1000,
        text
      };
    })
    .filter((segment) => segment.text.length > 0);
}

function parseXmlTranscript(xml: string): TranscriptSegment[] {
  const textMatches = xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g);
  const segments: TranscriptSegment[] = [];

  for (const match of textMatches) {
    const attributes = match[1];
    const rawText = match[2];
    const start = Number(readXmlAttribute(attributes, "start") ?? 0);
    const duration = Number(readXmlAttribute(attributes, "dur") ?? 0);
    const text = decodeHtml(rawText).replace(/\s+/g, " ").trim();

    if (text) {
      segments.push({ start, duration, text });
    }
  }

  return segments;
}

function parseVttTranscript(vtt: string): TranscriptSegment[] {
  const blocks = vtt.split(/\n\n+/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timingLine = lines.find((line) => line.includes("-->"));

    if (!timingLine) {
      continue;
    }

    const [startRaw, endRaw] = timingLine.split("-->").map((value) => value.trim());
    const text = lines
      .slice(lines.indexOf(timingLine) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      const start = parseVttTimestamp(startRaw);
      const end = parseVttTimestamp(endRaw);
      segments.push({ start, duration: Math.max(0, end - start), text });
    }
  }

  return segments;
}

function readXmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function parseVttTimestamp(value: string): number {
  const clean = value.split(" ")[0];
  const parts = clean.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return Number(clean) || 0;
}

export function compactTranscript(transcript: TranscriptSegment[], maxCharacters = 28000): string {
  const lines = transcript.map((segment) => {
    const start = formatTimestamp(segment.start);
    const end = formatTimestamp(segment.start + segment.duration);
    return `[${start} - ${end}] ${segment.text}`;
  });

  const joined = lines.join("\n");

  if (joined.length <= maxCharacters) {
    return joined;
  }

  return `${joined.slice(0, maxCharacters)}\n[Transcript truncated for POC analysis]`;
}

export function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
