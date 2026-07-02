"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type InputMode = "youtube" | "upload";

type UploadedSource = {
  sourceId: string;
  fileName: string;
  size: number;
};

const idleProgress: ProgressState = {
  value: 0,
  label: "Ready",
  detail: "Add a YouTube URL or an MP4 file to start analysis."
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

function readVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");

    const finish = (duration?: number) => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      resolve(duration);
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      finish(Number.isFinite(video.duration) ? video.duration : undefined);
    };
    video.onerror = () => {
      finish();
    };
    video.src = objectUrl;
  });
}

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>("youtube");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [uploadedSource, setUploadedSource] = useState<UploadedSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApiAnalyzeResponse | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [editableClips, setEditableClips] = useState<ClipCandidate[]>([]);
  const [progress, setProgress] = useState<ProgressState>(idleProgress);
  const [renderProgress, setRenderProgress] = useState<RenderProgressState | null>(null);
  const [captionPreferences, setCaptionPreferences] = useState<Record<string, boolean>>({});
  const localPreviewUrlRef = useRef("");

  const activeClip = editableClips.find((clip) => clip.id === activeClipId) ?? editableClips[0];
  const videoId =
    inputMode === "youtube" ? result?.video.videoId ?? extractYouTubeVideoId(url) : null;

  const embedUrl = useMemo(() => {
    if (!videoId) {
      return "";
    }

    const start = activeClip ? Math.max(0, Math.floor(activeClip.startTime)) : 0;
    return `https://www.youtube.com/embed/${videoId}?start=${start}&autoplay=0&rel=0`;
  }, [activeClip, videoId]);

  const localVideoUrl = useMemo(() => {
    if (!localPreviewUrl) {
      return "";
    }

    const start = activeClip ? Math.max(0, activeClip.startTime) : 0;
    return `${localPreviewUrl}#t=${start}`;
  }, [activeClip, localPreviewUrl]);

  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) {
        URL.revokeObjectURL(localPreviewUrlRef.current);
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setResult(null);
    setEditableClips([]);
    setActiveClipId(null);
    setCaptionPreferences({});

    if (inputMode === "upload") {
      await analyzeUploadedFile();
      return;
    }

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
      applyAnalysis(analysis);
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

  async function analyzeUploadedFile() {
    if (!selectedFile) {
      setIsLoading(false);
      setProgress(idleProgress);
      setError("Select an MP4 file before starting analysis.");
      return;
    }

    setUploadedSource(null);
    setProgress({
      value: 8,
      label: "Uploading MP4",
      detail: "Saving the source video in temporary local storage."
    });

    const progressTimers: number[] = [];

    try {
      const durationSeconds = await readVideoDuration(selectedFile);
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadResponse = await fetch("/api/uploads", {
        method: "POST",
        body: formData
      });
      const uploaded = await readJsonResponse<UploadedSource>(
        uploadResponse,
        "MP4 upload failed."
      );
      setUploadedSource(uploaded);
      setProgress({
        value: 34,
        label: "Processing video",
        detail: "Gemini is preparing the uploaded audio and video for analysis."
      });

      progressTimers.push(
        window.setTimeout(() => {
          setProgress({
            value: 54,
            label: "Analyzing moments",
            detail: "Gemini is identifying strong 30-60 second clip candidates."
          });
        }, 5000),
        window.setTimeout(() => {
          setProgress({
            value: 76,
            label: "Building clip candidates",
            detail: "Generating hooks, subtitles, titles, and social metadata."
          });
        }, 15000)
      );

      const analyzeResponse = await fetch("/api/analyze-upload", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sourceId: uploaded.sourceId,
          durationSeconds
        })
      });
      const analysis = await readJsonResponse<ApiAnalyzeResponse>(
        analyzeResponse,
        "Uploaded MP4 analysis failed."
      );
      applyAnalysis(analysis);
      setProgress({
        value: 100,
        label: "Analysis complete",
        detail: `${analysis.clips.length} clip candidates are ready to edit and export.`
      });
    } catch (caught) {
      setProgress({
        value: 100,
        label: "Analysis failed",
        detail: "Check the error message and retry the MP4 upload."
      });
      setError(caught instanceof Error ? caught.message : "Uploaded MP4 analysis failed.");
    } finally {
      progressTimers.forEach(window.clearTimeout);
      setIsLoading(false);
    }
  }

  function applyAnalysis(analysis: ApiAnalyzeResponse) {
    setResult(analysis);
    setEditableClips(analysis.clips);
    setActiveClipId(analysis.clips[0]?.id ?? null);
    setCaptionPreferences(
      Object.fromEntries(analysis.clips.map((clip) => [clip.id, true]))
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
    }

    const objectUrl = file ? URL.createObjectURL(file) : "";
    localPreviewUrlRef.current = objectUrl;
    setLocalPreviewUrl(objectUrl);
    setSelectedFile(file);
    setUploadedSource(null);
    setResult(null);
    setEditableClips([]);
    setActiveClipId(null);
    setCaptionPreferences({});
    setError("");
    setProgress(idleProgress);
  }

  function changeInputMode(mode: InputMode) {
    setInputMode(mode);
    setResult(null);
    setEditableClips([]);
    setActiveClipId(null);
    setUploadedSource(null);
    setCaptionPreferences({});
    setError("");
    setProgress(idleProgress);
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

    const includeCaptions = captionPreferences[clip.id] ?? true;
    const source =
      result.analysisMode === "uploaded-video" && uploadedSource
        ? {
            type: "upload" as const,
            sourceId: uploadedSource.sourceId
          }
        : {
            type: "youtube" as const,
            url: `https://www.youtube.com/watch?v=${result.video.videoId}`
          };

    setError("");
    setRenderProgress({
      clipId: clip.id,
      value: 10,
      label: "Preparing MP4 export",
      detail:
        source.type === "upload"
          ? "Opening the uploaded MP4 with FFmpeg."
          : "Starting yt-dlp and FFmpeg for this clip."
    });

    const renderTimers = [
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 28,
          label: source.type === "upload" ? "Cutting clip section" : "Downloading clip section",
          detail:
            source.type === "upload"
              ? "Extracting the selected section from the uploaded MP4."
              : "Fetching only the selected YouTube section locally with yt-dlp."
        });
      }, 900),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 48,
          label: includeCaptions ? "Transcribing speech" : "Preparing clean export",
          detail: includeCaptions
            ? "Whisper is listening to the clip and extracting word-level timestamps."
            : "Hook and spoken captions are disabled for this export."
        });
      }, 4500),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 66,
          label: "Rendering vertical MP4",
          detail: includeCaptions
            ? "FFmpeg is fitting the clip to 1080x1920 and burning synced word-by-word captions."
            : "FFmpeg is fitting the clean clip to 1080x1920 without text overlays."
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
          source,
          clip,
          includeCaptions
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
      link.download = `${result.video.videoId}-${clip.id}${
        includeCaptions ? "-captioned" : "-clean"
      }.mp4`;
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
            <p>Add a YouTube URL or MP4, generate clips, then edit and export.</p>
          </div>
          <div className="status-pill">Provider: Gemini</div>
        </header>

        <section className="input-band" aria-label="Add a video source">
          <div className="source-tabs" aria-label="Video source" role="tablist">
            <button
              aria-selected={inputMode === "youtube"}
              className={inputMode === "youtube" ? "active" : ""}
              onClick={() => changeInputMode("youtube")}
              role="tab"
              type="button"
            >
              YouTube URL
            </button>
            <button
              aria-selected={inputMode === "upload"}
              className={inputMode === "upload" ? "active" : ""}
              onClick={() => changeInputMode("upload")}
              role="tab"
              type="button"
            >
              Upload MP4
            </button>
          </div>
          <form className="url-form" onSubmit={handleSubmit}>
            {inputMode === "youtube" ? (
              <input
                className="url-input"
                placeholder="https://www.youtube.com/watch?v=..."
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            ) : (
              <label className="file-input">
                <span>{selectedFile?.name ?? "Choose an MP4 file"}</span>
                <input accept="video/mp4,.mp4" onChange={handleFileChange} type="file" />
              </label>
            )}
            <button
              className="primary-button"
              disabled={isLoading || (inputMode === "upload" && !selectedFile)}
              type="submit"
            >
              {isLoading ? "Analyzing..." : "Analyze"}
            </button>
          </form>
          <p className="input-note">
            {inputMode === "youtube"
              ? "YouTube analysis uses public captions when available, then Gemini video analysis as a fallback."
              : "The MP4 stays in temporary local storage for clipping and is sent to Gemini for video analysis."}{" "}
            Export uses Whisper + FFmpeg when hook and captions are enabled.
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
              {inputMode === "upload" && localVideoUrl ? (
                <video controls key={localVideoUrl} preload="metadata" src={localVideoUrl}>
                  <track kind="captions" />
                </video>
              ) : embedUrl ? (
                <iframe
                  key={embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  src={embedUrl}
                  title="YouTube preview"
                />
              ) : (
                <div className="empty-preview">
                  {inputMode === "upload"
                    ? "Choose an MP4 file to preview it."
                    : "Paste a YouTube URL to preview the video."}
                </div>
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
                      : result.analysisMode === "uploaded-video"
                        ? "Gemini uploaded video analysis"
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
                      <textarea
                        className="hook-input"
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
                      Names & terms
                      <input
                        value={clip.transcriptionContext ?? ""}
                        onChange={(event) =>
                          updateClip(clip.id, { transcriptionContext: event.target.value })
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

                    <label className="caption-toggle">
                      <input
                        checked={captionPreferences[clip.id] ?? true}
                        onChange={(event) =>
                          setCaptionPreferences((preferences) => ({
                            ...preferences,
                            [clip.id]: event.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Include hook & captions</strong>
                        Burn the hook and synced spoken words into this MP4.
                      </span>
                    </label>

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
