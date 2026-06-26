import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/export-mp4": [
      "./bin/yt-dlp-linux",
      "./node_modules/ffmpeg-static/ffmpeg",
    ]
  }
};

export default nextConfig;
