import { spawn } from "child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

type RenderClipInput = {
  youtubeUrl: string;
  startTime: number;
  endTime: number;
  hook: string;
  subtitles: string;
};

type WhisperWord = {
  start: number;
  end: number;
  segmentIndex: number;
  word: string;
};

type WhisperJson = {
  segments?: Array<{
    start?: number;
    end?: number;
    words?: Array<{
      start?: number;
      end?: number;
      word?: string;
    }>;
  }>;
};

export async function renderClipToMp4(input: RenderClipInput): Promise<Buffer> {
  const duration = Math.max(1, Math.min(120, input.endTime - input.startTime));
  const tempDir = await mkdtemp(join(tmpdir(), "clippingai-"));
  const assPath = join(tempDir, "captions.ass");
  const audioPath = join(tempDir, "audio.wav");
  const sourcePath = join(tempDir, "source.mp4");
  const outputPath = join(tempDir, "clip.mp4");

  try {
    await downloadSourceVideo(input.youtubeUrl, sourcePath, input.startTime, input.endTime);
    await extractAudioForTranscription(sourcePath, audioPath);
    const timedWords = await transcribeWords(audioPath, tempDir);
    await writeFile(
      assPath,
      createAssCaptions(input.hook, input.subtitles, duration, timedWords),
      "utf8"
    );

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-t",
      String(duration),
      "-filter_complex",
      createVerticalBlurFilter(assPath),
      "-map",
      "[outv]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function createVerticalBlurFilter(assPath: string): string {
  return [
    "[0:v]split=2[bgsrc][fgsrc]",
    "[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2,eq=brightness=-0.08:saturation=0.85[bg]",
    "[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease[fg]",
    "[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles=" + escapeFilterPath(assPath) + "[outv]"
  ].join(";");
}

async function extractAudioForTranscription(sourcePath: string, audioPath: string): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-y",
    audioPath
  ]);
}

async function transcribeWords(audioPath: string, outputDir: string): Promise<WhisperWord[]> {
  try {
    await runProcess("whisper", [
      audioPath,
      "--model",
      process.env.WHISPER_MODEL ?? "base",
      "--task",
      "transcribe",
      "--word_timestamps",
      "True",
      "--output_format",
      "json",
      "--output_dir",
      outputDir,
      "--verbose",
      "False"
    ]);

    const transcriptPath = join(outputDir, "audio.json");
    const payload = JSON.parse(await readFile(transcriptPath, "utf8")) as WhisperJson;

    return (payload.segments ?? [])
      .flatMap((segment, segmentIndex) =>
        (segment.words ?? []).map((word) => ({ ...word, segmentIndex }))
      )
      .map((word) => ({
        start: Number(word.start ?? 0),
        end: Number(word.end ?? word.start ?? 0),
        segmentIndex: word.segmentIndex,
        word: String(word.word ?? "").trim()
      }))
      .filter((word) => word.word.length > 0 && word.end >= word.start)
      .slice(0, 220);
  } catch (error) {
    console.warn(
      "[mp4] Whisper transcription failed, falling back to estimated subtitles:",
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

async function downloadSourceVideo(
  youtubeUrl: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  const ytDlpPath = await resolveYtDlpPath();

  try {
    await runProcess(ytDlpPath, [
      "--no-playlist",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--format",
      "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "--download-sections",
      `*${Math.max(0, startTime)}-${Math.max(startTime + 1, endTime)}`,
      "--force-keyframes-at-cuts",
      "--output",
      outputPath,
      youtubeUrl
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Sign in to confirm") || message.includes("not a bot")) {
      throw new Error(
        "YouTube blocked the local video download for this URL. Try another video, or later we need to add authenticated cookies / user-owned uploads for reliable MP4 rendering."
      );
    }

    throw error;
  }
}

async function resolveYtDlpPath(): Promise<string> {
  const localPath = join(process.cwd(), ".venv", "bin", "yt-dlp");

  try {
    await access(localPath);
    return localPath;
  } catch {
    return "yt-dlp";
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return runProcess("ffmpeg", args);
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errors: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      errors.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(Buffer.concat(errors).toString("utf8") || `${command} exited with ${code}`));
    });
  });
}

function createAssCaptions(
  hook: string,
  subtitles: string,
  duration: number,
  timedWords: WhisperWord[]
): string {
  const end = formatAssTime(duration);
  const safeHook = escapeAssText(hook).slice(0, 220);
  const captionEvents =
    timedWords.length > 0
      ? createTimedWordCaptionEvents(timedWords, duration)
      : createEstimatedWordCaptionEvents(subtitles, duration);

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,4,2,8,70,70,120,1
Style: Caption,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H7A000000,1,0,0,0,100,100,0,0,1,6,3,2,96,96,230,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Hook,,0,0,0,,${safeHook}
${captionEvents}
`;
}

function createTimedWordCaptionEvents(words: WhisperWord[], duration: number): string {
  return groupTimedWords(words)
    .flatMap((group) =>
      group.map((word, index) => {
        const start = Math.min(duration, Math.max(0, word.start));
        const nextStart = group[index + 1]?.start;
      const end = Math.min(
        duration,
        Math.max(word.end, typeof nextStart === "number" ? nextStart : word.end + 0.35)
      );
      const safeEnd = Math.max(start + 0.12, end - 0.03);
      const text = buildCaptionWindow(
        group.map((item) => escapeAssText(item.word)),
        index
      );
      return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(safeEnd)},Caption,,0,0,0,,${text}`;
      })
    )
    .join("\n");
}

function groupTimedWords(words: WhisperWord[]): WhisperWord[][] {
  const groups: WhisperWord[][] = [];
  let current: WhisperWord[] = [];

  for (const word of words) {
    const previous = current[current.length - 1];

    if (previous && shouldStartNewCaptionGroup(previous, word, current)) {
      groups.push(current);
      current = [];
    }

    current.push(word);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function shouldStartNewCaptionGroup(
  previous: WhisperWord,
  next: WhisperWord,
  currentGroup: WhisperWord[]
): boolean {
  const pauseSeconds = next.start - previous.end;
  const groupDuration = previous.end - currentGroup[0].start;
  const endsSentence = /[.!?…]$/.test(previous.word.trim());

  return (
    next.segmentIndex !== previous.segmentIndex ||
    pauseSeconds > 0.55 ||
    endsSentence ||
    currentGroup.length >= 4 ||
    groupDuration > 1.8
  );
}

function createEstimatedWordCaptionEvents(subtitles: string, duration: number): string {
  const words = escapeAssText(subtitles)
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 160);

  if (words.length === 0) {
    return "";
  }

  const wordDuration = Math.max(0.22, duration / words.length);

  return words
    .map((_, index) => {
      const start = Math.min(duration, index * wordDuration);
      const end = Math.min(duration, Math.max(start + 0.2, (index + 1) * wordDuration));
      const safeEnd = Math.max(start + 0.12, end - 0.03);
      const text = buildCaptionWindow(words, index);
      return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(safeEnd)},Caption,,0,0,0,,${text}`;
    })
    .join("\n");
}

function buildCaptionWindow(words: string[], activeIndex: number): string {
  const maxVisibleWords = 4;
  const windowStart = Math.max(0, activeIndex - maxVisibleWords + 1);
  const visibleWords = words.slice(windowStart, activeIndex + 1).map((word, index, visible) => {
    if (index === visible.length - 1) {
      return highlightActiveWord(word);
    }

    return word;
  });

  return `{\\an2\\q2}${visibleWords.join(" ")}`;
}

function highlightActiveWord(word: string): string {
  return `{\\c&H0048E8FF&\\3c&H00000000&\\bord7\\shad2\\fscx112\\fscy112}${word}{\\rCaption}`;
}

function formatAssTime(seconds: number): string {
  const centiseconds = Math.floor(seconds * 100);
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
