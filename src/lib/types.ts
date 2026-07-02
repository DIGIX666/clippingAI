import { z } from "zod";

export type TranscriptSegment = {
  start: number;
  duration: number;
  text: string;
};

export type VideoMetadata = {
  videoId: string;
  title: string;
  durationSeconds?: number;
  author?: string;
};

export const clipSchema = z.object({
  id: z.string(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  hook: z.string().min(1),
  subtitles: z.string().min(1),
  transcriptionContext: z.string().max(500).default(""),
  reason: z.string().min(1),
  score: z.number().min(0).max(100),
  title: z.string().min(1),
  description: z.string().min(1),
  hashtags: z.array(z.string()).max(12)
});

export const analyzeResponseSchema = z.object({
  video: z.object({
    videoId: z.string(),
    title: z.string(),
    author: z.string().optional(),
    durationSeconds: z.number().optional()
  }),
  clips: z.array(clipSchema).min(1).max(12)
});

export type ClipCandidate = z.infer<typeof clipSchema>;
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

export type ApiAnalyzeResponse = AnalyzeResponse & {
  analysisMode?: "transcript" | "youtube-video" | "uploaded-video";
  transcriptPreview?: TranscriptSegment[];
  transcriptSegmentCount?: number;
  warning?: string;
};

export type AnalyzeJobStatus =
  | "queued"
  | "validating_url"
  | "checking_captions"
  | "analyzing_transcript"
  | "analyzing_video"
  | "completed"
  | "failed";

export type AnalyzeJob = {
  id: string;
  url: string;
  status: AnalyzeJobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: ApiAnalyzeResponse;
  error?: string;
};
