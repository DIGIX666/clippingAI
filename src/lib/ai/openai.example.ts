/*
Reserved OpenAI provider for later.

When you add credits to an OpenAI API key, this file can become a real provider
behind the same `analyzeTranscript` interface used by Gemini.

Example shape:

import OpenAI from "openai";
import { buildClipAnalysisPrompt } from "@/lib/ai/prompts";
import { analyzeResponseSchema } from "@/lib/types";

export async function analyzeWithOpenAI({ video, transcript }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: buildClipAnalysisPrompt(video, transcript),
    text: { format: { type: "json_object" } }
  });

  const parsed = JSON.parse(response.output_text);
  return analyzeResponseSchema.parse({
    video,
    clips: parsed.clips
  });
}
*/
