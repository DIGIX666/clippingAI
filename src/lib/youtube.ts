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

  if (captionTracks.length === 0) {
    throw new Error(
      "No public transcript was found for this video. Try another video with captions enabled."
    );
  }

  const track = chooseCaptionTrack(captionTracks);
  const transcript = await fetchCaptionTrack(track.baseUrl);

  if (transcript.length === 0) {
    throw new Error("The transcript track was found, but no readable text was returned.");
  }

  return { metadata, transcript };
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

function chooseCaptionTrack(tracks: CaptionTrack[]): CaptionTrack {
  const manualTracks = tracks.filter((track) => track.kind !== "asr");
  const candidates = manualTracks.length > 0 ? manualTracks : tracks;
  const preferred =
    candidates.find((track) => track.languageCode?.startsWith("en")) ??
    candidates.find((track) => track.languageCode?.startsWith("fr")) ??
    candidates[0];

  return preferred;
}

async function fetchCaptionTrack(baseUrl: string): Promise<TranscriptSegment[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");

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

  const payload = (await response.json()) as Json3Transcript;

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
