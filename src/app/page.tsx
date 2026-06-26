"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AnalyzeJob, ApiAnalyzeResponse, ClipCandidate } from "@/lib/types";
import { extractYouTubeVideoId, formatTimestamp } from "@/lib/youtube";

type ProgressState = {
  value: number;
  label: string;
  detail: string;
};

type RenderProgressState = ProgressState & {
  clipId: string;
};

type CreateAnalyzeJobResponse = {
  jobId: string;
  job: AnalyzeJob;
};

type AnalyzeJobResponse = {
  job: AnalyzeJob;
};

const idleProgress: ProgressState = {
  value: 0,
  label: "Ready",
  detail: "Paste a YouTube URL to start analysis."
};

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  const payload = parseJsonPayload(text);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, text, fallbackMessage, response.status));
  }

  if (!payload) {
    throw new Error(`${fallbackMessage} Empty response from server.`);
  }

  return payload as T;
}

async function throwApiError(response: Response, fallbackMessage: string): Promise<never> {
  const text = await response.text();
  const payload = parseJsonPayload(text);
  throw new Error(getApiErrorMessage(payload, text, fallbackMessage, response.status));
}

function parseJsonPayload(text: string): unknown | null {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getApiErrorMessage(
  payload: unknown,
  text: string,
  fallbackMessage: string,
  status: number
): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  const details = summarizeServerText(text);

  if (details) {
    return `${fallbackMessage} Server returned HTTP ${status}: ${details}`;
  }

  return `${fallbackMessage} Server returned HTTP ${status}.`;
}

function summarizeServerText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("<")) {
    return "non-JSON HTML error page.";
  }

  return normalized.slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApiAnalyzeResponse | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [editableClips, setEditableClips] = useState<ClipCandidate[]>([]);
  const [progress, setProgress] = useState<ProgressState>(idleProgress);
  const [renderProgress, setRenderProgress] = useState<RenderProgressState | null>(null);

  const activeClip = editableClips.find((clip) => clip.id === activeClipId) ?? editableClips[0];
  const videoId = result?.video.videoId ?? extractYouTubeVideoId(url);

  const embedUrl = useMemo(() => {
    if (!videoId) {
      return "";
    }

    const start = activeClip ? Math.max(0, Math.floor(activeClip.startTime)) : 0;
    return `https://www.youtube.com/embed/${videoId}?start=${start}&autoplay=0&rel=0`;
  }, [activeClip, videoId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setResult(null);
    setEditableClips([]);
    setActiveClipId(null);
    setProgress({
      value: 2,
      label: "Queueing analysis",
      detail: "Creating an async job for this YouTube URL."
    });

    try {
      const createResponse = await fetch("/api/analyze-jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url })
      });

      const created = await readJsonResponse<CreateAnalyzeJobResponse>(
        createResponse,
        "Could not create analysis job."
      );
      syncProgressFromJob(created.job);

      void fetch(`/api/analyze-jobs/${created.jobId}/run`, {
        method: "POST"
      }).catch(() => {
        // The polling request below will surface the final job state when available.
      });

      const analysis = await pollAnalyzeJob(created.jobId);
      setResult(analysis);
      setEditableClips(analysis.clips);
      setActiveClipId(analysis.clips[0]?.id ?? null);
    } catch (caught) {
      setProgress({
        value: 100,
        label: "Analysis failed",
        detail: "Check the error message and try another URL if needed."
      });
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function pollAnalyzeJob(jobId: string): Promise<ApiAnalyzeResponse> {
    const maxAttempts = 240;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(1500);

      const response = await fetch(`/api/analyze-jobs/${jobId}`, {
        cache: "no-store"
      });
      const payload = await readJsonResponse<AnalyzeJobResponse>(
        response,
        "Could not read analysis job."
      );
      const job = payload.job;
      syncProgressFromJob(job);

      if (job.status === "completed" && job.result) {
        return job.result;
      }

      if (job.status === "failed") {
        throw new Error(job.error ?? "Analysis job failed.");
      }
    }

    throw new Error("Analysis job timed out. Try a shorter video or retry later.");
  }

  function syncProgressFromJob(job: AnalyzeJob) {
    setProgress({
      value: job.progress,
      label: getJobProgressLabel(job),
      detail: job.message
    });
  }

  function getJobProgressLabel(job: AnalyzeJob): string {
    switch (job.status) {
      case "queued":
        return "Analysis queued";
      case "validating_url":
        return "Preparing analysis";
      case "checking_captions":
        return "Looking for captions";
      case "analyzing_transcript":
        return "Analyzing transcript";
      case "analyzing_video":
        return "Analyzing video";
      case "completed":
        return "Analysis complete";
      case "failed":
        return "Analysis failed";
      default:
        return "Analyzing";
    }
  }

  function updateClip(id: string, patch: Partial<ClipCandidate>) {
    setEditableClips((clips) =>
      clips.map((clip) => {
        if (clip.id !== id) {
          return clip;
        }

        return { ...clip, ...patch };
      })
    );
  }

  function exportJson() {
    if (!result) {
      return;
    }

    const payload = {
      video: result.video,
      clips: editableClips
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${result.video.videoId}-clips.json`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  async function downloadMp4(clip: ClipCandidate) {
    if (!result) {
      return;
    }

    setError("");
    setRenderProgress({
      clipId: clip.id,
      value: 10,
      label: "Preparing MP4 export",
      detail: "Starting yt-dlp and FFmpeg for this clip."
    });

    const renderTimers = [
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 28,
          label: "Downloading clip section",
          detail: "Fetching only the selected YouTube section locally with yt-dlp."
        });
      }, 900),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 48,
          label: "Transcribing speech",
          detail: "Whisper is listening to the clip and extracting word-level timestamps."
        });
      }, 4500),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 66,
          label: "Rendering vertical MP4",
          detail:
            "FFmpeg is fitting the clip to 1080x1920 and burning synced word-by-word captions."
        });
      }, 10000),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 84,
          label: "Encoding MP4",
          detail: "Finalizing video and audio for browser download."
        });
      }, 18000)
    ];

    try {
      const response = await fetch("/api/export-mp4", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          youtubeUrl: `https://www.youtube.com/watch?v=${result.video.videoId}`,
          clip
        })
      });

      if (!response.ok) {
        await throwApiError(response, "MP4 export failed.");
      }

      const blob = await response.blob();
      setRenderProgress({
        clipId: clip.id,
        value: 96,
        label: "Preparing download",
        detail: "The MP4 is ready; your browser will save it to its downloads folder."
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${result.video.videoId}-${clip.id}.mp4`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
      setRenderProgress({
        clipId: clip.id,
        value: 100,
        label: "MP4 downloaded",
        detail: "The clip was sent to your browser downloads folder."
      });
    } catch (caught) {
      setRenderProgress({
        clipId: clip.id,
        value: 100,
        label: "MP4 export failed",
        detail: "Check the error message above before retrying."
      });
      setError(caught instanceof Error ? caught.message : "MP4 export failed.");
    } finally {
      renderTimers.forEach(window.clearTimeout);
      window.setTimeout(() => {
        setRenderProgress((current) => (current?.clipId === clip.id ? null : current));
      }, 4500);
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <h1>clippingAI POC</h1>
            <p>Paste a YouTube URL, generate clip candidates, edit hooks and subtitles.</p>
          </div>
          <div className="status-pill">Provider: Gemini</div>
        </header>

        <section className="input-band" aria-label="Analyze a YouTube URL">
          <form className="url-form" onSubmit={handleSubmit}>
            <input
              className="url-input"
              placeholder="https://www.youtube.com/watch?v=..."
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <button className="primary-button" disabled={isLoading} type="submit">
              {isLoading ? "Analyzing..." : "Analyze"}
            </button>
          </form>
          <p className="input-note">
            This POC starts an async analysis job, uses public YouTube captions when available,
            then falls back to Gemini video analysis for videos without captions. MP4 export uses
            Whisper + FFmpeg for spoken captions.
          </p>
          {(isLoading || result || error) && (
            <div className="progress-panel" aria-live="polite">
              <div className="progress-topline">
                <strong>{progress.label}</strong>
                <span>{progress.value}%</span>
              </div>
              <div className="progress-track" aria-label="Analysis progress">
                <div className="progress-fill" style={{ width: `${progress.value}%` }} />
              </div>
              <p>{progress.detail}</p>
            </div>
          )}
          {error ? <div className="error">{error}</div> : null}
        </section>

        <section className="workspace">
          <div className="panel">
            <div className="panel-header">
              <h2>Preview</h2>
              {activeClip ? (
                <span>
                  {formatTimestamp(activeClip.startTime)} - {formatTimestamp(activeClip.endTime)}
                </span>
              ) : (
                <span>No clip selected</span>
              )}
            </div>

            <div className="video-frame">
              {embedUrl ? (
                <iframe
                  key={embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  src={embedUrl}
                  title="YouTube preview"
                />
              ) : (
                <div className="empty-preview">Paste a YouTube URL to preview the video.</div>
              )}
            </div>

            {result ? (
              <>
                <div className="video-meta">
                  <h3>{result.video.title}</h3>
                  <p>
                    {result.video.author ? `${result.video.author} · ` : ""}
                    {result.analysisMode === "youtube-video"
                      ? "Gemini direct video analysis"
                      : `${result.transcriptSegmentCount ?? 0} transcript segments found`}
                  </p>
                  {result.warning ? <p>{result.warning}</p> : null}
                </div>
                {result.analysisMode === "transcript" ? (
                  <div className="transcript-preview">
                    <h3>Transcript sample</h3>
                    <p>
                      {(result.transcriptPreview ?? [])
                        .map((segment) => segment.text)
                        .join(" ")
                        .slice(0, 420)}
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Clip candidates</h2>
              <button
                className="secondary-button"
                disabled={!result || editableClips.length === 0}
                onClick={exportJson}
                type="button"
              >
                Export JSON
              </button>
            </div>

            {editableClips.length > 0 ? (
              <div className="clip-list">
                {editableClips.map((clip) => (
                  <article
                    className={`clip-card ${clip.id === activeClip?.id ? "active" : ""}`}
                    key={clip.id}
                  >
                    <div className="clip-top">
                      <span className="clip-time">
                        {formatTimestamp(clip.startTime)} - {formatTimestamp(clip.endTime)}
                      </span>
                      <span className="clip-score">{clip.score}/100</span>
                    </div>

                    <label>
                      Hook
                      <input
                        value={clip.hook}
                        onChange={(event) => updateClip(clip.id, { hook: event.target.value })}
                      />
                    </label>

                    <label>
                      Subtitles
                      <textarea
                        value={clip.subtitles}
                        onChange={(event) =>
                          updateClip(clip.id, { subtitles: event.target.value })
                        }
                      />
                    </label>

                    <label>
                      Title
                      <input
                        value={clip.title}
                        onChange={(event) => updateClip(clip.id, { title: event.target.value })}
                      />
                    </label>

                    <p>{clip.reason}</p>
                    <p>{clip.hashtags.join(" ")}</p>

                    {renderProgress?.clipId === clip.id ? (
                      <div className="render-progress" aria-live="polite">
                        <div className="progress-topline">
                          <strong>{renderProgress.label}</strong>
                          <span>{renderProgress.value}%</span>
                        </div>
                        <div className="progress-track" aria-label="MP4 export progress">
                          <div
                            className="progress-fill"
                            style={{ width: `${renderProgress.value}%` }}
                          />
                        </div>
                        <p>{renderProgress.detail}</p>
                      </div>
                    ) : null}

                    <div className="clip-actions">
                      <button
                        className="clip-button secondary-button"
                        disabled={renderProgress !== null}
                        onClick={() => downloadMp4(clip)}
                        type="button"
                      >
                        {renderProgress?.clipId === clip.id ? "Rendering..." : "Download MP4"}
                      </button>
                      <button
                        className="clip-button secondary-button"
                        onClick={() => setActiveClipId(clip.id)}
                        type="button"
                      >
                        Preview
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                Run an analysis to get 30-60 second clips with editable hooks, subtitles, titles,
                descriptions, and hashtags.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
