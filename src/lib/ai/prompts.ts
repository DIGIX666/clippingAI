import type { VideoMetadata } from "@/lib/types";

export function buildClipAnalysisPrompt(video: VideoMetadata, transcript: string): string {
  return `
You are an expert short-form video editor.

Analyze the transcript of this YouTube video and propose the strongest short clips for TikTok, Instagram Reels, and YouTube Shorts.

Video:
- Title: ${video.title}
- Author: ${video.author ?? "Unknown"}
- Duration seconds: ${video.durationSeconds ?? "Unknown"}

Rules:
- Return only valid JSON.
- Find 5 to 8 clip candidates.
- Each clip must be 30 to 60 seconds long.
- Each clip must make sense standalone.
- Avoid clips that start mid-sentence or need too much missing context.
- Prefer moments with a strong claim, tension, surprise, useful insight, emotion, or practical advice.
- Write hooks in a direct creator style, not clickbait.
- Subtitles should be clean and readable, based on the spoken content.
- Scores must be from 0 to 100.
- Times must be seconds as numbers.

JSON shape:
{
  "clips": [
    {
      "id": "clip-1",
      "startTime": 12,
      "endTime": 58,
      "hook": "A strong opening hook for the clip",
      "subtitles": "Clean subtitle text for the selected clip",
      "reason": "Why this moment is worth clipping",
      "score": 87,
      "title": "Short social title",
      "description": "Short post description",
      "hashtags": ["#example", "#shorts"]
    }
  ]
}

Transcript:
${transcript}
`.trim();
}

export function buildYouTubeVideoAnalysisPrompt(video: VideoMetadata): string {
  return buildVideoAnalysisPrompt(video, "YouTube video");
}

export function buildUploadedVideoAnalysisPrompt(video: VideoMetadata): string {
  return buildVideoAnalysisPrompt(video, "uploaded MP4");
}

function buildVideoAnalysisPrompt(video: VideoMetadata, sourceLabel: string): string {
  return `
You are an expert short-form video editor.

Analyze this ${sourceLabel} directly from its audio and visual content. Propose the strongest short clips for TikTok, Instagram Reels, and YouTube Shorts.

Video:
- Title: ${video.title}
- Author: ${video.author ?? "Unknown"}
- Duration seconds: ${video.durationSeconds ?? "Unknown"}

Rules:
- Return only valid JSON.
- Find 5 to 8 clip candidates.
- Each clip must be 30 to 60 seconds long.
- Each clip must make sense standalone.
- Prefer visually strong moments, energy shifts, performance highlights, crowd reactions, memorable phrases, or clear narrative moments.
- Write hooks in a direct creator style, not clickbait.
- If exact speech or lyrics are not confidently available, do not invent verbatim subtitles. Use concise on-screen caption text that describes the moment instead.
- Scores must be from 0 to 100.
- Times must be seconds as numbers.

JSON shape:
{
  "clips": [
    {
      "id": "clip-1",
      "startTime": 12,
      "endTime": 58,
      "hook": "A strong opening hook for the clip",
      "subtitles": "Clean subtitle or on-screen caption text for the selected clip",
      "reason": "Why this moment is worth clipping",
      "score": 87,
      "title": "Short social title",
      "description": "Short post description",
      "hashtags": ["#example", "#shorts"]
    }
  ]
}
`.trim();
}
