# Product Review

## The Idea

The original idea:

- users paste YouTube URLs,
- an AI analyzes the video,
- the AI creates many 30-60 second clips,
- each clip gets a hook and subtitles,
- users can edit the result,
- later, clips can be uploaded directly to TikTok and Instagram.

This is a valid product direction, but it is already a competitive category. The product needs sharper differentiation before heavy engineering investment.

## What Already Exists

### OpusClip

OpusClip is already positioned as an AI video clipping and editing tool. Its site describes automatic selection of highlights, short-form restructuring, dynamic captions, AI relayout, transitions, and call-to-action generation. It also says captions are automatically added and editable.

Reference: https://www.opus.pro/

### quso.ai / vidyo.ai

vidyo.ai has become part of quso.ai. quso.ai positions itself as an all-in-one social media AI suite with AI clipping, captions, an editor, brand kit, scheduling, analytics, and social media management.

Reference: https://quso.ai/

### Implication

A generic "AI turns long videos into shorts" product is not enough. The market already has credible tools with polished feature sets.

## Better Positioning Options

### Option 1: Creator-Controlled Clipping

Positioning:

> AI clipping for creators who want editorial control, not random auto-generated shorts.

Differentiators:

- explain why each clip was selected,
- show transcript context before and after each clip,
- let creators accept/reject and teach the system,
- preserve tone and message accuracy,
- support a strong manual edit pass.

Best users:

- podcasters,
- YouTubers,
- educators,
- founders,
- consultants,
- coaches.

### Option 2: Agency Review Workflow

Positioning:

> A reviewable AI clipping workflow for agencies managing client content.

Differentiators:

- approval states,
- comments,
- client review links,
- brand presets,
- batch exports,
- audit trail,
- reusable client style rules.

Best users:

- content agencies,
- social media managers,
- video editors,
- freelancers.

### Option 3: Strategy-Aware Clip Scoring

Positioning:

> AI clips ranked against your content strategy, not generic virality.

Differentiators:

- user defines target audience,
- user defines content pillars,
- AI scores clips by audience, clarity, novelty, emotional tension, and CTA fit,
- analytics later improve recommendations.

Best users:

- serious creators,
- B2B founders,
- newsletter/podcast operators,
- education businesses.

## Recommended Direction

Start with Option 1 and design the architecture so Option 2 can be added later.

Reason:

- it is simpler than a full agency platform,
- it directly addresses a weakness of fully automated clip generators,
- it makes the editor central instead of secondary,
- it creates a path to learning from user feedback.

## Critical Risks

### 1. YouTube Ingestion Risk

Pasting a YouTube URL is a great user experience, but downloading or processing third-party YouTube videos can create terms-of-service and copyright issues. The safer path is to support file uploads and user-owned YouTube videos early.

Product decision:

- ask users to confirm they own or have rights to the video,
- prioritize uploaded files,
- later add YouTube account connection for user-owned channel videos.

### 2. Commodity AI Clipping

Many tools already detect highlights and add subtitles.

Product decision:

- do not sell only "AI clips videos",
- sell better decisions, faster review, and stronger creator control.

### 3. Rendering Cost

Video rendering is compute-heavy. Long videos, multiple variants, and retries can get expensive.

Product decision:

- generate clip plans before rendering,
- render only approved clips in MVP,
- add usage limits,
- store render settings to avoid duplicate work.

### 4. Social Publishing Complexity

TikTok and Instagram direct publishing are not just "upload video with an API". They require OAuth, app review, platform-specific constraints, token handling, and failure states.

Product decision:

- make manual download excellent first,
- add publishing only after clips reliably export,
- keep publishing as a separate service.

### 5. Quality Evaluation

An AI can generate many clips, but users care about whether the clips are actually worth posting.

Product decision:

- show a clear score with explanation,
- include transcript context,
- let users reject with reasons,
- use rejection data to improve future suggestions.

## MVP User Flow

1. User creates a project.
2. User pastes a YouTube URL or uploads a video.
3. System extracts metadata and transcript.
4. AI proposes 5-15 candidate clips.
5. User reviews candidates with score, reason, transcript context, hook, and subtitles.
6. User edits trim, hook, captions, and format.
7. User renders selected clips.
8. User downloads MP4 files.

## AI Clip Scoring Criteria

Each clip should be scored across:

- hook strength,
- standalone clarity,
- emotional intensity,
- novelty,
- visual continuity,
- speech clarity,
- context dependence,
- platform fit,
- CTA potential.

Avoid selecting clips that require too much missing context, start mid-sentence, contain unresolved references, or rely on visuals that will not work after vertical cropping.

## Suggested First Version Features

Must have:

- URL/file input,
- transcript timeline,
- AI clip candidates,
- editable hook,
- editable subtitles,
- render selected clips,
- download clips.

Should have:

- clip scoring explanation,
- rejected/approved state,
- caption style presets,
- 9:16 safe zone preview,
- export queue.

Not yet:

- direct publishing,
- team workspaces,
- deep analytics,
- automatic multi-platform scheduling,
- AI avatar or dubbing.

## Monetization Later

Possible pricing model:

- free tier with limited monthly processing minutes,
- paid creator tier based on video minutes,
- pro tier with brand presets and higher render volume,
- agency tier with client workspaces and review links.

Avoid pricing by number of generated ideas only. Rendering minutes, storage, transcription, and AI calls are the real cost drivers.

## Product Name

`clippingAI` is understandable but generic. Better future naming options could be:

- ClipPilot
- CutSignal
- Recastly
- ShortForge
- HookCut
- ClipSignal

For now, keep `clippingAI` because the repository already exists and the name is clear for early development.

## Research Notes

- TikTok Content Posting API supports direct posting, but requires a registered app, Content Posting API product, approved scope, target user authorization, and audit for unrestricted public behavior: https://developers.tiktok.com/doc/content-posting-api-get-started/
- OpusClip already markets automatic highlight selection, dynamic captions, AI relayout, transitions, and editable captions: https://www.opus.pro/
- quso.ai already combines clipping, captions, editing, brand kit, scheduling, analytics, and social management: https://quso.ai/
- Meta/Instagram publishing should be validated against current Instagram Platform docs before implementation: https://developers.facebook.com/docs/instagram-platform/
