import { createWriteStream } from "fs";
import { chmod, mkdir, stat, unlink } from "fs/promises";
import https from "https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(rootDir, "bin", "yt-dlp-linux");
const downloadUrl =
  process.env.YT_DLP_DOWNLOAD_URL ??
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

if (process.env.SKIP_YT_DLP_DOWNLOAD === "1") {
  console.log("[install-yt-dlp] skipped because SKIP_YT_DLP_DOWNLOAD=1");
  process.exit(0);
}

try {
  const existing = await stat(outputPath);

  if (existing.size > 1024 * 1024) {
    await chmod(outputPath, 0o755);
    console.log(`[install-yt-dlp] using existing ${outputPath}`);
    process.exit(0);
  }
} catch {
  // Download below when the binary does not exist yet.
}

await mkdir(dirname(outputPath), { recursive: true });
await downloadFile(downloadUrl, outputPath);
await chmod(outputPath, 0o755);
console.log(`[install-yt-dlp] downloaded ${outputPath}`);

function downloadFile(url, destination, redirects = 0) {
  if (redirects > 5) {
    throw new Error("Too many redirects while downloading yt-dlp.");
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const location = response.headers.location;

      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        location
      ) {
        response.resume();
        downloadFile(new URL(location, url).toString(), destination, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download yt-dlp: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination, { mode: 0o755 });
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", async (error) => {
        await unlink(destination).catch(() => undefined);
        reject(error);
      });
    });

    request.on("error", reject);
  });
}
