import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/export-mp4": [
      "./bin/yt-dlp-linux",
      "./assets/fonts/NotoEmoji-Regular.ttf",
      "./assets/fonts/NotoSans-Bold.ttf",
      "./assets/fonts/NotoSans-Regular.ttf",
      "./node_modules/ffmpeg-static/ffmpeg",
    ]
  }
};

export default nextConfig;
