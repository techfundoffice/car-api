const test = require("node:test");
const assert = require("node:assert/strict");
const {
  semanticSearchParts,
  buildEmbeddingIndex,
  loadEmbeddingIndex,
  normalize,
  quantize,
  encodeBase64,
  decodeBase64,
} = require("../dist/cjs/ai/index.js");
const { getParts } = require("../dist/cjs/index.js");

/**
 * A deterministic stand-in for a real embedding model: a bag-of-characters
 * hash. It has no semantic meaning, but it is stable and multilingual, which is
 * all these tests need to exercise the indexing and ranking machinery without a
 * network call or an API key.
 */
const DIM = 64;
function fakeEmbed(texts) {
  return Promise.resolve(
    texts.map((text) => {
      const vector = new Array(DIM).fill(0);
      for (const char of text.toLowerCase()) {
        vector[char.codePointAt(0) % DIM] += 1;
      }
      return vector;
    })
  );
}

test("base64 round-trips signed bytes, including negatives", () => {
  const cases = [
    [0],
    [1, -1, 127, -127],
    [-128, 0, 42],
    Array.from({ length: 300 }, (_, i) => ((i * 37) % 255) - 127),
  ];
  for (const values of cases) {
    const decoded = decodeBase64(encodeBase64(Int8Array.from(values)));
    assert.deepEqual(Array.from(decoded), values);
  }
});

test("decodeBase64 rejects invalid input rather than returning garbage", () => {
  assert.throws(() => decodeBase64("!!!!"), /Invalid base64/);
});

test("normalize produces unit vectors and leaves a zero vector alone", () => {
  const unit = normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(...unit) - 1) < 1e-12);
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
});

test("quantization keeps direction within int8 rounding error", () => {
  // Checked at a small width and at a realistic embedding width; both must stay
  // well inside retrieval tolerance, where anything above ~0.99 is immaterial
  // to ranking.
  for (const [dim, floor] of [[32, 0.998], [1024, 0.9995]]) {
    const vector = Array.from({ length: dim }, (_, i) => Math.sin(i));
    const { bytes, scales } = quantize([vector]);
    const restored = Array.from(bytes, (b) => b * scales[0]);

    const expected = normalize(vector);
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += restored[i] * expected[i];
    assert.ok(dot > floor, `cosine at ${dim} dims was only ${dot}`);
  }
});

test("buildEmbeddingIndex rejects misaligned or empty input", () => {
  assert.throws(() => buildEmbeddingIndex(["a", "b"], [[1, 2]], "m"), /aligned/);
  assert.throws(() => buildEmbeddingIndex([], [], "m"), /no vectors/);
  assert.throws(() => quantize([[1, 2], [1, 2, 3]]), /dimension/);
});

test("loadEmbeddingIndex validates shape, version, and byte count", () => {
  const valid = buildEmbeddingIndex(["a", "b"], [[1, 0], [0, 1]], "fake");
  assert.equal(loadEmbeddingIndex(valid).model, "fake");

  assert.throws(() => loadEmbeddingIndex(null), /must be an object/);
  assert.throws(
    () => loadEmbeddingIndex({ ...valid, version: 99 }),
    /Unsupported embedding index version/
  );
  assert.throws(
    () => loadEmbeddingIndex({ ...valid, scales: [1] }),
    /different lengths/
  );
  assert.throws(() => loadEmbeddingIndex({ ...valid, dim: 7 }), /bytes/);
});

test("semantic search ranks the closest part first", async () => {
  const parts = getParts().slice(0, 300);
  const vectors = await fakeEmbed(parts.map((p) => `${p.name}\n${p.slug.replace(/-/g, " ")}`));
  const index = buildEmbeddingIndex(
    parts.map((p) => p.slug),
    vectors,
    "fake-test-model"
  );

  const target = parts[42];
  const results = await semanticSearchParts(`${target.name}\n${target.slug.replace(/-/g, " ")}`, {
    index,
    embed: fakeEmbed,
    limit: 5,
  });

  assert.equal(results.length, 5);
  assert.equal(results[0].part.slug, target.slug);
  assert.ok(results[0].score > 0.99);

  // Scores must come back in descending order — callers rely on results[0]
  // being the best match.
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
});

test("semantic search honours limit and minScore", async () => {
  const parts = getParts().slice(0, 100);
  const vectors = await fakeEmbed(parts.map((p) => p.slug));
  const index = buildEmbeddingIndex(parts.map((p) => p.slug), vectors, "fake");

  const capped = await semanticSearchParts("brake", { index, embed: fakeEmbed, limit: 3 });
  assert.equal(capped.length, 3);

  const filtered = await semanticSearchParts("brake", {
    index,
    embed: fakeEmbed,
    limit: 100,
    minScore: 0.99,
  });
  assert.ok(filtered.length < capped.length + 100);
  assert.ok(filtered.every((r) => r.score >= 0.99));
});

test("a query embedded with the wrong model is refused, not silently ranked", async () => {
  const index = buildEmbeddingIndex(["a"], [[1, 0, 0]], "three-dim-model");
  await assert.rejects(
    () => semanticSearchParts("x", { index, embed: fakeEmbed }),
    /same model as the index/
  );
});

test("results resolve to real parts from the catalogue", async () => {
  const parts = getParts().slice(0, 50);
  const vectors = await fakeEmbed(parts.map((p) => p.slug));
  const index = buildEmbeddingIndex(parts.map((p) => p.slug), vectors, "fake");

  const results = await semanticSearchParts("filter", { index, embed: fakeEmbed, limit: 10 });
  for (const { part } of results) {
    assert.ok(part.slug && part.name, "result is missing part fields");
  }
});
