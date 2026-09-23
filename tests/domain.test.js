import test from "node:test";
import assert from "node:assert/strict";
import {
  demoDB,
  emptyDB,
  validateDB,
  calculate,
  ingredientCost,
  convert,
  references,
  escapeHTML,
} from "../src/domain.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("converts compatible units without guessing mass/volume densities", () => {
  assert.equal(convert(1, "kg", "g"), 1000);
  assert.equal(convert(250, "ml", "l"), 0.25);
  assert.equal(convert(1, "g", "ml"), null);
  assert.equal(convert(1, "ud", "racion"), null);
});
test("ingredient costs account for waste, zero-priced items and missing values", () => {
  const db = demoDB(),
    i = db.ingredients[0];
  near(
    ingredientCost({
      ...i,
      price: 10,
      packageQty: 1000,
      unit: "g",
      wastePct: 20,
    }),
    0.0125,
  );
  assert.equal(ingredientCost({ ...i, price: 0 }), 0);
  assert.equal(ingredientCost({ ...i, price: null }), null);
  assert.equal(ingredientCost({ ...i, wastePct: 100 }), null);
  assert.equal(ingredientCost({ ...i, packageQty: 0 }), null);
});
test("calculates recipe yields and product cost from independent expected arithmetic", () => {
  const db = demoDB(),
    c = calculate(db, db.products[0]);
  near(
    c.cost,
    (0.4 * 1.2 + 0.6 * 1.1 + 3 * (3.6 / 12)) / 10 + 25 * (4.5 / 500) + 0.12,
  );
  assert.equal(c.incomplete, false);
  assert.deepEqual(c.contains, ["Gluten", "Huevo", "Leche"]);
});
test("IGIC is removed from revenue before calculating contribution and food cost", () => {
  const db = demoDB(),
    p = { ...db.products[0], pvp: 10.7, taxRate: 7 },
    c = calculate(db, p);
  near(c.netRevenue, 10);
  near(c.margin, 10 - c.cost);
  near(c.foodCost, (c.cost / 10) * 100);
  near(c.suggestedPvp, (c.cost / 0.3) * 1.07);
});
test("empty products, missing prices, zero yields and invalid quantities are incomplete", () => {
  const db = demoDB();
  assert.equal(calculate(db, { ...db.products[0], lines: [] }).cost, null);
  assert.equal(calculate(db, db.products[1]).cost, null);
  assert.equal(
    calculate(db, { ...db.recipes[0], yieldQty: 0 }, "recipe").incomplete,
    true,
  );
  const p = structuredClone(db.products[0]);
  p.lines[0].qty = 0;
  assert.equal(calculate(db, p).incomplete, true);
  p.lines[0].qty = 1;
  p.lines[0].unit = "kg";
  assert.equal(calculate(db, p).incomplete, true);
});
test("allergen completeness is separate from cost completeness", () => {
  const db = demoDB();
  assert.equal(calculate(db, db.products[0]).allergensReviewed, false);
  db.ingredients.forEach((i) => (i.allergensReviewed = true));
  const result = calculate(db, db.products[1]);
  assert.equal(result.incomplete, true);
  assert.equal(result.allergensReviewed, true);
});
test("nested recipes inherit allergens; contains takes precedence over traces", () => {
  const db = demoDB();
  db.ingredients[3].traces = ["Leche", "Soja"];
  const c = calculate(db, db.products[0]);
  assert.deepEqual(c.traces, ["Soja"]);
  db.recipes.push({
    id: "nested",
    name: "Anidada",
    yieldQty: 2,
    yieldUnit: "ud",
    notes: "",
    lines: [
      {
        sourceType: "recipe",
        sourceId: db.recipes[0].id,
        qty: 2,
        unit: "racion",
      },
    ],
  });
  near(
    calculate(db, db.recipes[1], "recipe").cost,
    calculate(db, db.recipes[0], "recipe").cost,
  );
  assert.ok(calculate(db, db.recipes[1], "recipe").contains.includes("Huevo"));
});
test("validates copies and upgrades v1 without certifying unreviewed allergens", () => {
  const raw = demoDB();
  raw.version = 1;
  raw.ingredients[0].allergensReviewed = true;
  const out = validateDB(raw);
  assert.equal(out.version, 2);
  assert.equal(out.ingredients[0].allergensReviewed, false);
  assert.equal(raw.version, 1);
  assert.deepEqual(validateDB(emptyDB()), emptyDB());
});
test("rejects malformed imports, unknown versions, duplicate IDs and dangling references", () => {
  assert.throws(() => validateDB({ version: 3 }));
  assert.throws(() =>
    validateDB({ version: 2, ingredients: {}, recipes: [], products: [] }),
  );
  const db = demoDB();
  db.ingredients[0].id = db.ingredients[1].id;
  assert.throws(() => validateDB(db), /duplicados/);
  const bad = demoDB();
  bad.products[0].lines[0].sourceId = "missing";
  assert.throws(() => validateDB(bad), /referencia ausente/);
  bad.products[0].lines = [];
  bad.ingredients[0].price = "10";
  assert.throws(() => validateDB(bad), /número/);
});
test("rejects cycles rather than recursing forever", () => {
  const db = demoDB();
  db.recipes[0].lines.push({
    sourceType: "recipe",
    sourceId: db.recipes[0].id,
    qty: 1,
    unit: "racion",
  });
  assert.throws(() => validateDB(db), /ciclo/);
  assert.equal(calculate(db, db.products[0]).incomplete, true);
});
test("detects every reference before deletion, including nested subrecipes", () => {
  const db = demoDB();
  assert.equal(references(db, "ingredient", "demo_flour")[0].id, "demo_batter");
  assert.equal(references(db, "recipe", "demo_batter")[0].id, "demo_pancakes");
});
test("escapes imported display text and rejects dangerous IDs", () => {
  assert.equal(
    escapeHTML('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
  const db = demoDB();
  db.ingredients[0].id = 'x" onclick="bad';
  assert.throws(() => validateDB(db), /Identificador/);
});
