/**
 * Semantic (embedding) search over the parts catalogue.
 *
 * Why this exists: part `name` values are Russian while `slug` values are
 * English, so the built-in `searchParts()` substring match only finds a part
 * when the user happens to use the same language and wording as the data.
 * Embedding search matches meaning instead, across both languages.
 *
 * The index is built ahead of time (`npm run build:embeddings`) and shipped as
 * JSON, so runtime search needs no network and no API key — only the one-off
 * build step and an ad-hoc query embedding do.
 */

import type { Part } from "../data/parts";
import { getPartBySlug } from "../index";

/**
 * Turns text into vectors. Any embedding backend can satisfy this — the two
 * providers below are conveniences, not requirements.
 */
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

/** A prebuilt, quantized embedding index over the parts catalogue. */
export type EmbeddingIndex = {
  /** Format version, so a stale index can be detected rather than misread. */
  version: 1;
  /** Identifier of the model that produced the vectors. */
  model: string;
  /** Vector dimensionality. */
  dim: number;
  /** Part slugs, positionally aligned with the vectors. */
  slugs: string[];
  /**
   * Unit-normalized vectors quantized to int8 and base64-encoded, laid out
   * row-major as `slugs.length * dim` bytes.
   */
  vectors: string;
  /** Per-vector dequantization scale, positionally aligned with `slugs`. */
  scales: number[];
};

export type SemanticSearchOptions = {
  /** Prebuilt index — load it from `auto-parts-db/embeddings.json` or your own build. */
  index: EmbeddingIndex;
  /** Embeds the query. Must be the same model the index was built with. */
  embed: EmbeddingProvider;
  /** Maximum results (default 10). */
  limit?: number;
  /** Drop results scoring below this cosine similarity (default 0, i.e. keep all). */
  minScore?: number;
};

export type SemanticSearchResult = {
  part: Part;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
};

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64-encode bytes without depending on Buffer or atob. */
export function encodeBase64(bytes: Int8Array | Uint8Array): string {
  const u8 =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer.slice(0));
  let out = "";
  for (let i = 0; i < u8.length; i += 3) {
    const b0 = u8[i];
    const b1 = i + 1 < u8.length ? u8[i + 1] : 0;
    const b2 = i + 2 < u8.length ? u8[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < u8.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < u8.length ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

/** Decode base64 produced by {@link encodeBase64} back into signed bytes. */
export function decodeBase64(input: string): Int8Array {
  const clean = input.replace(/=+$/, "");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = B64_ALPHABET.indexOf(clean[i]);
    if (value < 0) throw new Error(`Invalid base64 character at index ${i}`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return new Int8Array(out.buffer, 0, outIndex);
}

/** Scale a vector to unit length. A zero vector is returned unchanged. */
export function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector.slice();
  return vector.map((v) => v / magnitude);
}

/**
 * Quantize unit-normalized vectors to int8, returning the packed bytes and the
 * per-vector scale needed to reconstruct them. Cuts index size ~4x versus
 * float32 while keeping cosine ranking effectively unchanged.
 */
export function quantize(vectors: number[][]): {
  bytes: Int8Array;
  scales: number[];
} {
  const dim = vectors.length > 0 ? vectors[0].length : 0;
  const bytes = new Int8Array(vectors.length * dim);
  const scales: number[] = [];
  vectors.forEach((vector, row) => {
    if (vector.length !== dim) {
      throw new Error(
        `Vector ${row} has dimension ${vector.length}, expected ${dim}`
      );
    }
    const unit = normalize(vector);
    let maxAbs = 0;
    for (const v of unit) maxAbs = Math.max(maxAbs, Math.abs(v));
    const scale = maxAbs === 0 ? 1 : maxAbs / 127;
    scales.push(scale);
    for (let col = 0; col < dim; col++) {
      const q = Math.round(unit[col] / scale);
      bytes[row * dim + col] = Math.max(-127, Math.min(127, q));
    }
  });
  return { bytes, scales };
}

/** Assemble a shippable index from raw vectors. Used by the build script. */
export function buildEmbeddingIndex(
  slugs: string[],
  vectors: number[][],
  model: string
): EmbeddingIndex {
  if (slugs.length !== vectors.length) {
    throw new Error(
      `Got ${slugs.length} slugs but ${vectors.length} vectors — they must be aligned`
    );
  }
  if (vectors.length === 0) throw new Error("Cannot build an index with no vectors");
  const dim = vectors[0].length;
  const { bytes, scales } = quantize(vectors);
  return {
    version: 1,
    model,
    dim,
    slugs,
    vectors: encodeBase64(bytes),
    scales,
  };
}

/**
 * Validate a parsed JSON object as an index. Throws with a specific reason
 * rather than failing later with a confusing scoring error.
 */
export function loadEmbeddingIndex(raw: unknown): EmbeddingIndex {
  const index = raw as EmbeddingIndex;
  if (!index || typeof index !== "object") {
    throw new Error("Embedding index must be an object");
  }
  if (index.version !== 1) {
    throw new Error(
      `Unsupported embedding index version ${index.version}; expected 1. Rebuild with 'npm run build:embeddings'.`
    );
  }
  if (!Array.isArray(index.slugs) || !Array.isArray(index.scales)) {
    throw new Error("Embedding index is missing 'slugs' or 'scales'");
  }
  if (index.slugs.length !== index.scales.length) {
    throw new Error("Embedding index 'slugs' and 'scales' have different lengths");
  }
  if (typeof index.vectors !== "string" || typeof index.dim !== "number") {
    throw new Error("Embedding index is missing 'vectors' or 'dim'");
  }
  const expected = index.slugs.length * index.dim;
  const actual = decodeBase64(index.vectors).length;
  if (actual !== expected) {
    throw new Error(
      `Embedding index holds ${actual} bytes but ${expected} were expected (${index.slugs.length} vectors x ${index.dim} dims)`
    );
  }
  return index;
}

/**
 * Rank parts by semantic similarity to `query`.
 *
 * The query is embedded with the caller-supplied provider, which must be the
 * same model that built the index — mixing models produces scores that look
 * plausible and rank badly.
 */
export async function semanticSearchParts(
  query: string,
  options: SemanticSearchOptions
): Promise<SemanticSearchResult[]> {
  const { index, embed, limit = 10, minScore = 0 } = options;
  const [rawQueryVector] = await embed([query]);
  if (!rawQueryVector) throw new Error("Embedding provider returned no vector");
  if (rawQueryVector.length !== index.dim) {
    throw new Error(
      `Query vector has ${rawQueryVector.length} dimensions but the index has ${index.dim}. The query must use the same model as the index ('${index.model}').`
    );
  }

  const queryVector = normalize(rawQueryVector);
  const bytes = decodeBase64(index.vectors);
  const scored: SemanticSearchResult[] = [];

  for (let row = 0; row < index.slugs.length; row++) {
    const offset = row * index.dim;
    const scale = index.scales[row];
    let dot = 0;
    for (let col = 0; col < index.dim; col++) {
      dot += bytes[offset + col] * scale * queryVector[col];
    }
    if (dot < minScore) continue;
    const part = getPartBySlug(index.slugs[row]);
    if (part) scored.push({ part, score: dot });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Embedding provider backed by Voyage AI — Anthropic's recommended embedding
 * partner. Anthropic's own API does not serve embeddings, so semantic search
 * uses a dedicated embedding model here and Claude for reasoning elsewhere.
 *
 * `voyage-3` is multilingual, which is what makes the Russian names and English
 * slugs searchable through one index.
 */
export function voyageEmbeddings(config: {
  apiKey: string;
  model?: string;
  /** "document" when indexing, "query" when searching. Voyage ranks better when told. */
  inputType?: "document" | "query";
  baseUrl?: string;
}): EmbeddingProvider {
  const {
    apiKey,
    model = "voyage-3",
    inputType,
    baseUrl = "https://api.voyageai.com/v1/embeddings",
  } = config;

  return async (texts: string[]) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        ...(inputType ? { input_type: inputType } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Voyage embeddings request failed: ${response.status} ${await response.text()}`
      );
    }
    const body = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    // Voyage returns results with explicit indices; sort so the caller can rely
    // on positional alignment with the input.
    return body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  };
}

/**
 * Embedding provider for any OpenAI-compatible `/v1/embeddings` endpoint —
 * covers self-hosted servers (Ollama, LM Studio, text-embeddings-inference) so
 * the index can be built with no third-party service at all.
 */
export function openAICompatibleEmbeddings(config: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): EmbeddingProvider {
  const { baseUrl, model, apiKey } = config;
  return async (texts: string[]) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!response.ok) {
      throw new Error(
        `Embeddings request failed: ${response.status} ${await response.text()}`
      );
    }
    const body = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    return body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  };
}
