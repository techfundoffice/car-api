#!/usr/bin/env node
/**
 * Build the semantic-search index over the parts catalogue.
 *
 * Run after `npm run build`:
 *
 *   VOYAGE_API_KEY=... npm run build:embeddings
 *
 * Or against any OpenAI-compatible embeddings endpoint (Ollama, LM Studio,
 * text-embeddings-inference) with no third-party service involved:
 *
 *   EMBEDDINGS_URL=http://localhost:11434/v1/embeddings \
 *   EMBEDDINGS_MODEL=nomic-embed-text \
 *   npm run build:embeddings
 *
 * Writes embeddings.json — around 1.5 MB of int8 vectors for 1530 parts at
 * 1024 dimensions, versus ~6 MB unquantized.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let db;
let ai;
try {
  db = require(resolve(root, "dist/cjs/index.js"));
  ai = require(resolve(root, "dist/cjs/ai/semantic.js"));
} catch {
  console.error("Build the package first: npm run build");
  process.exit(1);
}

const BATCH_SIZE = 96;
const OUTPUT = resolve(root, "embeddings.json");

/**
 * Text handed to the embedding model for each part.
 *
 * Both the Russian display name and the de-slugged English words go in, so one
 * multilingual index answers queries in either language.
 */
function embeddingText(part) {
  const english = part.slug.replace(/-/g, " ");
  return `${part.name}\n${english}`;
}

function resolveProvider() {
  if (process.env.EMBEDDINGS_URL) {
    const model = process.env.EMBEDDINGS_MODEL;
    if (!model) {
      console.error("EMBEDDINGS_URL is set but EMBEDDINGS_MODEL is not.");
      process.exit(1);
    }
    return {
      model,
      embed: ai.openAICompatibleEmbeddings({
        baseUrl: process.env.EMBEDDINGS_URL,
        model,
        apiKey: process.env.EMBEDDINGS_API_KEY,
      }),
    };
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error(
      "Set VOYAGE_API_KEY (https://voyageai.com), or EMBEDDINGS_URL + EMBEDDINGS_MODEL\n" +
        "to build the index against a self-hosted embeddings endpoint."
    );
    process.exit(1);
  }
  const model = process.env.VOYAGE_MODEL || "voyage-3";
  return {
    model,
    embed: ai.voyageEmbeddings({ apiKey, model, inputType: "document" }),
  };
}

const { model, embed } = resolveProvider();
const parts = db.getParts();
console.error(`Embedding ${parts.length} parts with ${model}...`);

const slugs = [];
const vectors = [];

for (let i = 0; i < parts.length; i += BATCH_SIZE) {
  const batch = parts.slice(i, i + BATCH_SIZE);
  const embedded = await embed(batch.map(embeddingText));
  if (embedded.length !== batch.length) {
    console.error(
      `Provider returned ${embedded.length} vectors for ${batch.length} inputs — aborting rather than writing a misaligned index.`
    );
    process.exit(1);
  }
  batch.forEach((part, offset) => {
    slugs.push(part.slug);
    vectors.push(embedded[offset]);
  });
  console.error(`  ${Math.min(i + BATCH_SIZE, parts.length)}/${parts.length}`);
}

const index = ai.buildEmbeddingIndex(slugs, vectors, model);
writeFileSync(OUTPUT, JSON.stringify(index));

const sizeMb = (JSON.stringify(index).length / 1024 / 1024).toFixed(2);
console.error(`Wrote ${OUTPUT} — ${slugs.length} vectors, ${index.dim} dims, ${sizeMb} MB`);
