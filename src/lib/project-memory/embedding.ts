import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";

const EMBEDDING_DIMENSION = 256;
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const execFileAsync = promisify(execFile);

export type EmbeddingProvider = "local" | "openai" | "gemini";

function normalizeVector(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (norm === 0) {
    return values;
  }

  return values.map((value) => value / norm);
}

function hashToken(token: string) {
  return createHash("sha1").update(token).digest().readUInt32BE(0);
}

function buildLocalEmbedding(input: string) {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const tokens = input.toLowerCase().match(/[a-z0-9_\u4e00-\u9fa5./-]+/g) ?? [];

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % EMBEDDING_DIMENSION;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign * Math.min(token.length, 12);
  }

  return normalizeVector(vector);
}

async function buildOpenAiEmbedding(input: string) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const response = await client.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input,
  });

  return response.data[0]?.embedding ?? buildLocalEmbedding(input);
}

async function buildGeminiEmbedding(input: string) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    return buildLocalEmbedding(input);
  }

  const proxyUrl =
    process.env.GEMINI_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    process.env.ALL_PROXY;
  const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const requestBody = JSON.stringify({
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: {
      parts: [{ text: input }],
    },
  });

  if (proxyUrl) {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        "30",
        "--proxy",
        proxyUrl,
        "-H",
        "Content-Type: application/json",
        "-X",
        "POST",
        requestUrl,
        "-d",
        requestBody,
      ],
      {
        maxBuffer: 1024 * 1024 * 2,
      }
    );
    const payload = JSON.parse(stdout) as {
      embedding?: {
        values?: number[];
      };
    };

    return payload.embedding?.values ?? buildLocalEmbedding(input);
  }

  const response = await fetch(
    requestUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    embedding?: {
      values?: number[];
    };
  };

  return payload.embedding?.values ?? buildLocalEmbedding(input);
}

export function resolveEmbeddingProvider(preferred?: string): EmbeddingProvider {
  if (
    preferred === "gemini" &&
    (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  ) {
    return "gemini";
  }

  if (preferred === "openai" && process.env.OPENAI_API_KEY) {
    return "openai";
  }

  if (preferred === "local") {
    return "local";
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return "gemini";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return "local";
}

export async function createEmbedding(input: string, preferred?: string) {
  const provider = resolveEmbeddingProvider(preferred);

  if (provider === "openai") {
    return {
      provider,
      values: normalizeVector(await buildOpenAiEmbedding(input)),
    };
  }

  if (provider === "gemini") {
    return {
      provider,
      values: normalizeVector(await buildGeminiEmbedding(input)),
    };
  }

  return {
    provider,
    values: buildLocalEmbedding(input),
  };
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}
