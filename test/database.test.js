const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../dist/cjs/index.js");

// The README makes specific coverage claims. These lock them in so a data
// regression fails the build instead of quietly shipping.
test("meets the coverage claimed in the README", () => {
  const brands = db.getBrands();
  assert.ok(brands.length >= 100, `expected 100+ brands, got ${brands.length}`);

  let models = 0;
  let generations = 0;
  for (const brand of db.brands) {
    models += brand.models.length;
    for (const model of brand.models) generations += model.generations.length;
  }
  assert.ok(models >= 2000, `expected 2000+ models, got ${models}`);
  assert.ok(generations > 0);
  assert.ok(
    db.getParts().length >= 1200,
    `expected 1200+ parts, got ${db.getParts().length}`
  );
});

test("exports every function the README documents", () => {
  for (const name of [
    "getBrands",
    "getModelsByBrand",
    "getGenerations",
    "getGenerationByYear",
    "getBrand",
    "searchModels",
    "getParts",
    "getPartBySlug",
    "searchParts",
    "getPartSlugs",
  ]) {
    assert.equal(typeof db[name], "function", `${name} is not exported`);
  }
});

test("getModelsByBrand is case-insensitive and returns [] for unknown brands", () => {
  const canonical = db.getModelsByBrand("Audi");
  assert.ok(canonical.length > 0);
  assert.deepEqual(db.getModelsByBrand("audi"), canonical);
  assert.deepEqual(db.getModelsByBrand("AUDI"), canonical);
  assert.deepEqual(db.getModelsByBrand("Nonexistent Motors"), []);
});

test("getGenerationByYear picks the generation covering the year", () => {
  const gen = db.getGenerationByYear("Audi", "A4", 2010);
  assert.ok(gen, "expected a generation for a 2010 Audi A4");
  assert.ok(gen.yearFrom <= 2010);
  assert.ok(gen.yearTo === null || gen.yearTo >= 2010);
  assert.equal(db.getGenerationByYear("Audi", "A4", 1800), null);
});

test("getGenerationByYear treats a null yearTo as still in production", () => {
  const ongoing = [];
  for (const brand of db.brands) {
    for (const model of brand.models) {
      if (model.generations.some((g) => g.yearTo === null)) {
        ongoing.push({ brand: brand.brand, model: model.name });
      }
    }
  }
  assert.ok(ongoing.length > 0, "expected some in-production generations");

  const { brand, model } = ongoing[0];
  const nextYear = new Date().getFullYear() + 1;
  assert.ok(db.getGenerationByYear(brand, model, nextYear));
});

test("searchParts matches English slugs and Russian names", () => {
  const bySlug = db.searchParts("brake");
  assert.ok(bySlug.length > 0, "expected English slug matches for 'brake'");
  assert.ok(bySlug.every((p) => p.slug.includes("brake") || p.name.toLowerCase().includes("brake")));

  const byName = db.searchParts("тормоз");
  assert.ok(byName.length > 0, "expected Russian name matches for 'тормоз'");

  assert.deepEqual(db.searchParts("zzzz-no-such-part"), []);
});

test("getPartBySlug round-trips every slug the catalogue reports", () => {
  const slugs = db.getPartSlugs();
  assert.equal(slugs.length, db.getParts().length);
  for (const slug of slugs.slice(0, 200)) {
    assert.equal(db.getPartBySlug(slug)?.slug, slug);
  }
  assert.equal(db.getPartBySlug("definitely-not-a-slug"), null);
});

test("brand names are unique and every model has a non-empty name", () => {
  const names = db.brands.map((b) => b.brand);
  assert.equal(new Set(names).size, names.length, "duplicate brand names");

  for (const brand of db.brands) {
    assert.ok(brand.brand.trim().length > 0);
    assert.ok(brand.models.length > 0, `${brand.brand} has no models`);
    for (const model of brand.models) {
      assert.ok(model.name.trim().length > 0, `${brand.brand} has an unnamed model`);
    }
  }
});

test("every generation has a sane, ordered year range", () => {
  const currentYear = new Date().getFullYear();
  for (const brand of db.brands) {
    for (const model of brand.models) {
      for (const gen of model.generations) {
        const where = `${brand.brand} ${model.name} ${gen.name}`;
        assert.ok(Number.isInteger(gen.yearFrom), `${where}: yearFrom not an integer`);
        assert.ok(gen.yearFrom >= 1850, `${where}: yearFrom ${gen.yearFrom} too early`);
        assert.ok(
          gen.yearFrom <= currentYear + 3,
          `${where}: yearFrom ${gen.yearFrom} too far in the future`
        );
        if (gen.yearTo !== null) {
          assert.ok(
            gen.yearTo >= gen.yearFrom,
            `${where}: yearTo ${gen.yearTo} precedes yearFrom ${gen.yearFrom}`
          );
        }
      }
    }
  }
});

test("part slugs are well-formed and names are non-empty", () => {
  for (const part of db.getParts()) {
    assert.match(part.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${part.slug}`);
    assert.ok(part.name.trim().length > 0, `part ${part.slug} has an empty name`);
  }
});

// A duplicate slug makes every part after the first unreachable through
// getPartBySlug, so uniqueness is a correctness property, not just tidiness.
test("part slugs are unique and every part is reachable by slug", () => {
  const slugs = db.getParts().map((p) => p.slug);
  const duplicates = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
  assert.deepEqual(duplicates, [], `duplicate part slugs: ${duplicates.join(", ")}`);

  for (const part of db.getParts()) {
    assert.equal(db.getPartBySlug(part.slug)?.name, part.name);
  }
});
