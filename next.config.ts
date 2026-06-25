import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/export-mp4": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/yt-dlp-exec/bin/yt-dlp"
    ]
  }
};

export default nextConfig;
