"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AnalyzeResponse, ClipCandidate, TranscriptSegment } from "@/lib/types";
import { extractYouTubeVideoId, formatTimestamp } from "@/lib/youtube";

type ApiAnalyzeResponse = AnalyzeResponse & {
  analysisMode?: "transcript" | "youtube-video";
  transcriptPreview?: TranscriptSegment[];
  transcriptSegmentCount?: number;
  warning?: string;
};

type ProgressState = {
  value: number;
  label: string;
  detail: string;
};

type RenderProgressState = ProgressState & {
  clipId: string;
};

const idleProgress: ProgressState = {
  value: 0,
  label: "Ready",
  detail: "Paste a YouTube URL to start analysis."
};

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
      value: 8,
      label: "Preparing analysis",
      detail: "Validating the YouTube URL and loading video metadata."
    });

    const progressTimers = [
      window.setTimeout(() => {
        setProgress({
          value: 24,
          label: "Looking for captions",
          detail: "Trying public YouTube captions first because transcript analysis is faster."
        });
      }, 900),
      window.setTimeout(() => {
        setProgress({
          value: 42,
          label: "Preparing Gemini input",
          detail:
            "If captions are missing or empty, the app falls back to Gemini direct video analysis."
        });
      }, 2600),
      window.setTimeout(() => {
        setProgress({
          value: 68,
          label: "Analyzing with Gemini",
          detail: "Finding 30-60 second moments, hooks, subtitles, scores, and post metadata."
        });
      }, 5200),
      window.setTimeout(() => {
        setProgress({
          value: 84,
          label: "Building clip candidates",
          detail: "Structuring the results for review and editing."
        });
      }, 12000)
    ];

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url })
      });

      const payload = (await response.json()) as ApiAnalyzeResponse | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Analysis failed.");
      }

      const analysis = payload as ApiAnalyzeResponse;
      setProgress({
        value: 100,
        label: "Analysis complete",
        detail: `${analysis.clips.length} clip candidates are ready for review.`
      });
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
      progressTimers.forEach(window.clearTimeout);
      setIsLoading(false);
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
          value: 54,
          label: "Rendering vertical MP4",
          detail: "FFmpeg is cutting the clip, fitting it to 1080x1920, and adding text overlays."
        });
      }, 4500),
      window.setTimeout(() => {
        setRenderProgress({
          clipId: clip.id,
          value: 78,
          label: "Encoding MP4",
          detail: "Finalizing video and audio for browser download."
        });
      }, 12000)
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
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "MP4 export failed.");
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
            This POC uses public YouTube captions when available, then falls back to Gemini video
            analysis. MP4 export is local-only and uses FFmpeg.
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
