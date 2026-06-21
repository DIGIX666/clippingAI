# clippingAI

clippingAI is an AI-assisted platform for turning long YouTube videos into short, editable, captioned clips for TikTok, Instagram Reels, YouTube Shorts, and other short-form channels.

The first version focuses on one clear workflow:

1. Paste a YouTube URL.
2. Analyze the video transcript and structure.
3. Detect high-potential 30-60 second segments.
4. Generate hooks, captions, titles, descriptions, and subtitles.
5. Let the user review and edit each clip.
6. Export production-ready videos.

Direct publishing to TikTok and Instagram is intentionally planned as a later phase because it requires platform OAuth, API review, account permissions, and publishing constraints.

## Product Thesis

Most AI clipping tools optimize for speed: upload a long video and receive many generated shorts. clippingAI should optimize for creator control and repeatable quality.

The opportunity is not just "generate clips with AI". Existing tools already do that. The stronger angle is:

- make clip selection explainable,
- make edits fast after AI generation,
- preserve the creator's tone and brand style,
- score clips against a repeatable content strategy,
- learn from previous accepted/rejected clips,
- provide a clear approval workflow before export or publishing.

## MVP Scope

### Included

- YouTube URL input.
- Video metadata extraction.
- Transcript extraction or transcription.
- AI segment detection.
- Clip candidates between 30 and 60 seconds.
- Hook generation for each clip.
- Subtitle generation and styling.
- Basic timeline editor for trimming, captions, and hook text.
- Export to MP4 vertical format.
- Project history and clip status tracking.

### Excluded From MVP

- Direct TikTok publishing.
- Direct Instagram publishing.
- Team collaboration.
- Payments and usage billing.
- Advanced brand kits.
- Multi-language dubbing.
- Fully automated posting.

These should come after the core pipeline reliably creates good clips.

## Suggested Stack

The architecture is designed so the AI, rendering, and publishing systems can evolve independently.

- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Backend API: FastAPI or NestJS.
- Database: PostgreSQL.
- Job queue: Redis + BullMQ, Celery, or Temporal.
- Object storage: S3-compatible storage.
- Video processing: FFmpeg.
- Transcription: Whisper API, local Whisper, or another speech-to-text provider.
- AI reasoning: OpenAI API by default, with an abstraction layer for alternative providers.
- Authentication: Clerk, Auth.js, or Supabase Auth.
- Payments later: Stripe.

## Core Pipeline

```mermaid
flowchart LR
    A[YouTube URL] --> B[Ingestion]
    B --> C[Metadata + Transcript]
    C --> D[AI Segment Analysis]
    D --> E[Clip Candidate Generation]
    E --> F[Subtitle + Hook Generation]
    F --> G[User Review Editor]
    G --> H[Render Queue]
    H --> I[MP4 Export]
    I --> J[Manual Download]
    I -. later .-> K[TikTok / Instagram Publishing]
```

## Repository Structure

```text
clippingAI/
  README.md
  docs/
    ARCHITECTURE.md
    PRODUCT_REVIEW.md
```

## Local POC

The repository now includes a minimal Vercel-ready Next.js POC.

### What Works

- Paste a YouTube URL.
- Fetch public YouTube captions when available.
- Send the transcript to Gemini.
- Generate 5-8 candidate clips.
- Edit hooks, subtitles, and titles in the browser.
- Preview the selected timestamp in an embedded YouTube player.
- Download a local MP4 export for each clip.
- Export the clip plan as JSON.

### What Does Not Work Yet

- MP4 export is local POC only.
- MP4 export requires `ffmpeg` and `yt-dlp`.
- It does not save projects in a database.
- It does not publish to TikTok or Instagram.

### Setup

```bash
npm install
cp .env.example .env.local
python3 -m venv .venv
.venv/bin/pip install yt-dlp
```

Add a Gemini API key:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
```

Run locally:

```bash
npm run dev
```

MP4 export uses the local `.venv/bin/yt-dlp` binary when present and `ffmpeg`
from your system path. This is not production-ready for Vercel serverless; a
real deployment should move rendering to a worker service.

The generated MP4 is not saved in the repository or a database. The API returns
the file directly to the browser, so it is saved wherever the browser normally
puts downloads, usually the user's `Downloads` folder.

Open:

```text
http://localhost:3000
```

### AI Provider Notes

Gemini is the active provider for the POC because it has a usable free tier for tests. An OpenAI provider stub is kept in `src/lib/ai/openai.example.ts` for later, when OpenAI API credits are available.

Application code should stay behind the `analyzeTranscript` provider interface so Gemini, OpenAI, Groq, or OpenRouter can be swapped without rewriting the product flow.

## Important Platform Constraints

YouTube ingestion must be handled carefully. The safest product path is to require the user to own the content, have permission to process it, or upload the source file directly. YouTube URL support should be treated as a convenience layer, not the only ingestion path.

TikTok direct publishing is possible through TikTok's Content Posting API, but it requires a registered app, approved scopes such as `video.publish`, creator authorization, and app audit before public posting behavior is fully available.

Instagram publishing should be treated similarly: direct Reels publishing requires Meta platform integration, OAuth, eligible account types, and Graph API constraints.

## Competitive Positioning

Existing products such as OpusClip and quso.ai already provide AI clipping, subtitles, resizing, and social media workflows. clippingAI should not compete by copying the same broad suite immediately.

Better initial positioning:

- for creators who want high editorial control,
- for agencies that need reviewable outputs,
- for educators, podcasters, and founders who care about message accuracy,
- for users who want transparent AI reasoning behind each suggested clip.

## Development Phases

### Phase 1: Foundation

- Build project model, YouTube URL intake, transcript pipeline, AI clip planning, and exportable clip specs.

### Phase 2: Rendering

- Add FFmpeg rendering, subtitle burn-in, vertical layout, safe zones, and downloadable MP4 files.

### Phase 3: Editor

- Add a browser editor for trimming, captions, hook text, title suggestions, and clip approval.

### Phase 4: Learning Loop

- Track accepted/rejected clips and use that feedback to improve future recommendations.

### Phase 5: Publishing

- Add TikTok and Instagram OAuth, API approval flows, scheduled publishing, and post status tracking.

## Research Sources

- TikTok Content Posting API: https://developers.tiktok.com/doc/content-posting-api-get-started/
- OpusClip: https://www.opus.pro/
- quso.ai / vidyo.ai: https://quso.ai/
- Instagram Platform docs: https://developers.facebook.com/docs/instagram-platform/
