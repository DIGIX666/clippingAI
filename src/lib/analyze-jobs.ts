import { randomUUID } from "crypto";
import { runAnalyze, toAnalysisError } from "@/lib/analyze";
import type { AnalyzeJob } from "@/lib/types";

const JOB_TTL_SECONDS = 60 * 60;

type RedisRestResponse<T> = {
  result?: T;
  error?: string;
};

declare global {
  var clippingAiAnalyzeJobs: Map<string, AnalyzeJob> | undefined;
}

export async function createAnalyzeJob(url: string): Promise<AnalyzeJob> {
  const now = new Date().toISOString();
  const job: AnalyzeJob = {
    id: randomUUID(),
    url,
    status: "queued",
    progress: 2,
    message: "Analysis job queued.",
    createdAt: now,
    updatedAt: now
  };

  await saveAnalyzeJob(job);
  return job;
}

export async function getAnalyzeJob(jobId: string): Promise<AnalyzeJob | null> {
  const redisJob = await getAnalyzeJobFromRedis(jobId);

  if (redisJob) {
    return redisJob;
  }

  return getMemoryStore().get(jobId) ?? null;
}

export async function runAnalyzeJob(jobId: string): Promise<AnalyzeJob> {
  const job = await getAnalyzeJob(jobId);

  if (!job) {
    throw new Error("Analysis job not found.");
  }

  if (job.status === "completed" || job.status === "failed") {
    return job;
  }

  await updateAnalyzeJob(job.id, {
    status: "validating_url",
    progress: 8,
    message: "Starting async analysis."
  });

  try {
    const result = await runAnalyze(
      job.url,
      async (progress) => {
        await updateAnalyzeJob(job.id, progress);
      },
      { allowVideoFallback: true }
    );

    return await updateAnalyzeJob(job.id, {
      status: "completed",
      progress: 100,
      message: `${result.clips.length} clip candidates are ready for review.`,
      result,
      error: undefined
    });
  } catch (error) {
    return await updateAnalyzeJob(job.id, {
      status: "failed",
      progress: 100,
      message: "Analysis failed.",
      error: toAnalysisError(error)
    });
  }
}

async function updateAnalyzeJob(
  jobId: string,
  patch: Partial<Omit<AnalyzeJob, "id" | "url" | "createdAt">>
): Promise<AnalyzeJob> {
  const existing = await getAnalyzeJob(jobId);

  if (!existing) {
    throw new Error("Analysis job not found.");
  }

  const next: AnalyzeJob = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  await saveAnalyzeJob(next);
  return next;
}

async function saveAnalyzeJob(job: AnalyzeJob): Promise<void> {
  getMemoryStore().set(job.id, job);

  if (!hasRedisConfig()) {
    return;
  }

  await callRedis(["SET", redisKey(job.id), JSON.stringify(job), "EX", JOB_TTL_SECONDS]);
}

async function getAnalyzeJobFromRedis(jobId: string): Promise<AnalyzeJob | null> {
  if (!hasRedisConfig()) {
    return null;
  }

  const response = await callRedis<string | null>(["GET", redisKey(jobId)]);

  if (!response.result) {
    return null;
  }

  try {
    return JSON.parse(response.result) as AnalyzeJob;
  } catch {
    return null;
  }
}

function getMemoryStore(): Map<string, AnalyzeJob> {
  globalThis.clippingAiAnalyzeJobs ??= new Map<string, AnalyzeJob>();
  return globalThis.clippingAiAnalyzeJobs;
}

function hasRedisConfig(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function callRedis<T>(command: unknown[]): Promise<RedisRestResponse<T>> {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL as string, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });

  const payload = (await response.json()) as RedisRestResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "Redis REST request failed.");
  }

  return payload;
}

function redisKey(jobId: string): string {
  return `clippingai:analyze-job:${jobId}`;
}
