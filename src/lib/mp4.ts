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

export async function renderClipToMp4(input: RenderClipInput): Promise<Buffer> {
  const duration = Math.max(1, Math.min(120, input.endTime - input.startTime));
  const tempDir = await mkdtemp(join(tmpdir(), "clippingai-"));
  const assPath = join(tempDir, "captions.ass");
  const sourcePath = join(tempDir, "source.mp4");
  const outputPath = join(tempDir, "clip.mp4");

  try {
    await downloadSourceVideo(input.youtubeUrl, sourcePath, input.startTime, input.endTime);
    await writeFile(assPath, createAssCaptions(input.hook, input.subtitles, duration), "utf8");

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-t",
      String(duration),
      "-vf",
      `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,subtitles=${escapeFilterPath(assPath)}`,
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

async function downloadSourceVideo(
  youtubeUrl: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  const ytDlpPath = await resolveYtDlpPath();

  await runProcess(ytDlpPath, [
    "--no-playlist",
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

function createAssCaptions(hook: string, subtitles: string, duration: number): string {
  const end = formatAssTime(duration);
  const safeHook = escapeAssText(hook).slice(0, 220);
  const safeSubtitles = wrapText(escapeAssText(subtitles), 56).slice(0, 900);

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,4,2,8,70,70,120,1
Style: Caption,Arial,58,&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,4,2,2,70,70,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Hook,,0,0,0,,${safeHook}
Dialogue: 0,0:00:00.00,${end},Caption,,0,0,0,,${safeSubtitles}
`;
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

function wrapText(value: string, lineLength: number): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (`${current} ${word}`.trim().length > lineLength) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 5).join("\\N");
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
