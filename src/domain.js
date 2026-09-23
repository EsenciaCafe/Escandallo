export const ALLERGENS = [
  "Gluten",
  "Crustáceos",
  "Huevo",
  "Pescado",
  "Cacahuete",
  "Soja",
  "Leche",
  "Frutos de cáscara",
  "Apio",
  "Mostaza",
  "Sésamo",
  "Sulfitos",
  "Altramuz",
  "Moluscos",
];
export const UNITS = {
  g: ["masa", 1],
  kg: ["masa", 1000],
  ml: ["volumen", 1],
  l: ["volumen", 1000],
  ud: ["unidad", 1],
  racion: ["ración", 1],
};
export const unitLabel = (u) => (u === "racion" ? "ración" : u);
export const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
export const today = () => new Date().toLocaleDateString("en-CA");
export const emptyDB = () => ({
  version: 2,
  settings: { businessName: "Esencia", targetFoodCost: 30, defaultTaxRate: 0 },
  ingredients: [],
  recipes: [],
  products: [],
});
export const money = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
      }).format(n)
    : "—";
export const number = (n, digits = 2) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(
        n,
      )
    : "—";
export const percent = (n) => (Number.isFinite(n) ? `${number(n, 1)} %` : "—");
export const escapeHTML = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const nonneg = (n) => finite(n) && n >= 0;
const positive = (n) => finite(n) && n > 0;
export function convert(qty, from, to) {
  if (
    !finite(qty) ||
    !UNITS[from] ||
    !UNITS[to] ||
    UNITS[from][0] !== UNITS[to][0]
  )
    return null;
  return (qty * UNITS[from][1]) / UNITS[to][1];
}
export function ingredientCost(i) {
  if (!i || !positive(i.packageQty) || !nonneg(i.price) || !UNITS[i.unit])
    return null;
  const waste = i.wastePct ?? 0;
  if (!nonneg(waste) || waste >= 100) return null;
  return i.price / i.packageQty / (1 - waste / 100);
}
export function calculate(db, entity, type = "product", stack = []) {
  const contains = new Set(),
    traces = new Set(),
    issues = [],
    allergenIssues = [],
    rows = [];
  if (!entity || stack.includes(entity.id))
    return {
      cost: null,
      totalCost: null,
      incomplete: true,
      contains: [],
      traces: [],
      issues: ["Referencia ausente o subreceta circular."],
      allergenIssues: ["Composición sin verificar."],
      allergensReviewed: false,
      rows: [],
    };
  let total = type === "product" ? (entity.indirectCost ?? 0) : 0;
  if (!nonneg(total)) {
    issues.push("El coste indirecto no es válido.");
    total = 0;
  }
  if (!entity.lines?.length) {
    issues.push("Falta la composición.");
    allergenIssues.push("Falta la composición.");
  }
  for (const line of entity.lines || []) {
    const ingredient = line.sourceType === "ingredient";
    const source = (ingredient ? db.ingredients : db.recipes).find(
      (x) => x.id === line.sourceId,
    );
    let cost = null;
    if (!source) {
      const reason = line.sourceId
        ? "Hay una referencia que ya no existe."
        : "Selecciona un componente para completar la línea.";
      issues.push(reason);
      allergenIssues.push(reason);
    } else {
      const result = ingredient
        ? {
            cost: ingredientCost(source),
            contains: source.contains || [],
            traces: source.traces || [],
            issues: [],
            allergenIssues: source.allergensReviewed
              ? []
              : [`${source.name}: revisar ficha de alérgenos.`],
          }
        : calculate(db, source, "recipe", [...stack, entity.id]);
      result.contains.forEach((a) => contains.add(a));
      result.traces.forEach((a) => traces.add(a));
      allergenIssues.push(...result.allergenIssues);
      const qty = convert(
        line.qty,
        line.unit,
        ingredient ? source.unit : source.yieldUnit,
      );
      if (!positive(line.qty))
        issues.push(`${source.name}: cantidad mayor que cero requerida.`);
      else if (qty == null)
        issues.push(`${source.name}: unidades incompatibles (${line.unit}).`);
      else if (result.cost == null)
        issues.push(
          `${source.name}: ${result.issues?.join(" ") || "falta precio o formato."}`,
        );
      else {
        cost = qty * result.cost;
        total += cost;
      }
    }
    rows.push({
      ...line,
      name: source?.name || "Referencia no disponible",
      cost,
    });
  }
  if (type === "recipe" && !positive(entity.yieldQty))
    issues.push("El rendimiento debe ser mayor que cero.");
  if (
    type === "product" &&
    (!nonneg(entity.pvp) ||
      !nonneg(entity.taxRate ?? 0) ||
      (entity.taxRate ?? 0) > 100)
  )
    issues.push("PVP o IGIC no válido.");
  contains.forEach((a) => traces.delete(a));
  const totalCost = issues.length ? null : total;
  const cost =
    totalCost == null
      ? null
      : type === "recipe"
        ? totalCost / entity.yieldQty
        : totalCost;
  const netRevenue =
    type === "product" && nonneg(entity.pvp)
      ? entity.pvp / (1 + (entity.taxRate ?? 0) / 100)
      : null;
  const margin = cost != null && netRevenue != null ? netRevenue - cost : null;
  const foodCost =
    cost != null && netRevenue > 0 ? (cost / netRevenue) * 100 : null;
  const marginPct =
    margin != null && netRevenue > 0 ? (margin / netRevenue) * 100 : null;
  const target = db.settings?.targetFoodCost || 30;
  const suggestedPvp =
    cost == null
      ? null
      : (cost / (target / 100)) * (1 + (entity.taxRate ?? 0) / 100);
  return {
    cost,
    totalCost,
    netRevenue,
    margin,
    marginPct,
    foodCost,
    suggestedPvp,
    incomplete: !!issues.length,
    issues: [...new Set(issues)],
    allergenIssues: [...new Set(allergenIssues)],
    allergensReviewed: !allergenIssues.length,
    contains: ALLERGENS.filter((a) => contains.has(a)),
    traces: ALLERGENS.filter((a) => traces.has(a)),
    rows,
  };
}
export function references(db, type, id) {
  return [...db.recipes, ...db.products].filter((x) =>
    (x.lines || []).some((l) => l.sourceType === type && l.sourceId === id),
  );
}
function fail(message) {
  throw new Error(message);
}
function text(value, label, max = 2000) {
  if (typeof value !== "string" || value.length > max)
    fail(`${label}: texto no válido.`);
  return value;
}
function numeric(value, label, { nullable = false, min = 0, max = 1e9 } = {}) {
  if (nullable && value === null) return null;
  if (!finite(value) || value < min || value > max)
    fail(`${label}: número no válido.`);
  return value;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    fail("Identificador no válido.");
  return value;
}
function date(value) {
  if (value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Fecha no válida.");
  return value;
}
function name(value) {
  text(value, "Nombre", 200);
  if (!value.trim()) fail("El nombre es obligatorio.");
  return value.trim();
}
function allergens(values) {
  if (!Array.isArray(values) || values.some((a) => !ALLERGENS.includes(a)))
    fail("Lista de alérgenos no válida.");
  return [...new Set(values)];
}
function bool(value, label) {
  if (typeof value !== "boolean") fail(`${label}: valor no válido.`);
  return value;
}
export function validateDB(raw) {
  if (!raw || ![1, 2].includes(raw.version))
    fail("Versión de copia no compatible. Usa una copia de Esencia (v1 o v2).");
  for (const key of ["ingredients", "recipes", "products"])
    if (!Array.isArray(raw[key]) || raw[key].length > 10000)
      fail(`Colección ${key} no válida.`);
  const old = raw.version === 1;
  const db = emptyDB();
  if (raw.settings)
    db.settings = {
      businessName: name(raw.settings.businessName ?? "Esencia"),
      targetFoodCost: numeric(raw.settings.targetFoodCost ?? 30, "Objetivo", {
        min: 1,
        max: 100,
      }),
      defaultTaxRate: numeric(raw.settings.defaultTaxRate ?? 0, "IGIC", {
        max: 100,
      }),
    };
  db.ingredients = raw.ingredients.map((i) => {
    if (!i || !["g", "kg", "ml", "l", "ud"].includes(i.unit))
      fail("Unidad de ingrediente no válida.");
    const contains = allergens(i.contains),
      traces = allergens(i.traces);
    return {
      id: id(i.id),
      name: name(i.name),
      brand: text(i.brand ?? "", "Marca", 200),
      supplier: text(i.supplier ?? "", "Proveedor", 200),
      packageQty: numeric(i.packageQty, "Formato", {
        nullable: true,
        min: 0.000001,
      }),
      unit: i.unit,
      price: numeric(i.price, "Precio", { nullable: true }),
      priceDate: date(i.priceDate ?? ""),
      wastePct: numeric(i.wastePct ?? 0, "Merma", { max: 99.99 }),
      contains,
      traces: traces.filter((a) => !contains.includes(a)),
      allergensReviewed: old
        ? false
        : bool(i.allergensReviewed ?? false, "Revisión"),
      reviewDate: date(i.reviewDate ?? ""),
      allergenSource: text(i.allergenSource ?? "", "Fuente", 1000),
      notes: text(i.notes ?? "", "Notas"),
      active: bool(i.active ?? true, "Activo"),
    };
  });
  const lines = (value) => {
    if (!Array.isArray(value) || value.length > 500)
      fail("Composición no válida.");
    return value.map((l) => {
      if (
        !l ||
        !["ingredient", "recipe"].includes(l.sourceType) ||
        !UNITS[l.unit]
      )
        fail("Línea de composición no válida.");
      return {
        sourceType: l.sourceType,
        sourceId: id(l.sourceId),
        qty: numeric(l.qty, "Cantidad", { min: 0.000001 }),
        unit: l.unit,
      };
    });
  };
  db.recipes = raw.recipes.map((r) => {
    if (!r || !UNITS[r.yieldUnit]) fail("Unidad de rendimiento no válida.");
    return {
      id: id(r.id),
      name: name(r.name),
      yieldQty: numeric(r.yieldQty, "Rendimiento", { min: 0.000001 }),
      yieldUnit: r.yieldUnit,
      notes: text(r.notes ?? "", "Notas"),
      lines: lines(r.lines),
    };
  });
  db.products = raw.products.map((p) => ({
    id: id(p.id),
    name: name(p.name),
    category: text(p.category ?? "", "Categoría", 200),
    pvp: numeric(p.pvp, "PVP"),
    taxRate: numeric(p.taxRate ?? 0, "IGIC", { max: 100 }),
    indirectCost: numeric(p.indirectCost ?? 0, "Indirectos"),
    notes: text(p.notes ?? "", "Notas"),
    lines: lines(p.lines),
  }));
  const all = [...db.ingredients, ...db.recipes, ...db.products];
  if (new Set(all.map((x) => x.id)).size !== all.length)
    fail("La copia contiene identificadores duplicados.");
  for (const entity of [...db.recipes, ...db.products])
    for (const line of entity.lines) {
      if (
        !(line.sourceType === "ingredient" ? db.ingredients : db.recipes).some(
          (x) => x.id === line.sourceId,
        )
      )
        fail(`${entity.name}: referencia ausente en la copia.`);
    }
  function visit(r, stack = []) {
    if (stack.includes(r.id)) fail("Las subrecetas forman un ciclo.");
    for (const l of r.lines)
      if (l.sourceType === "recipe")
        visit(
          db.recipes.find((x) => x.id === l.sourceId),
          [...stack, r.id],
        );
  }
  db.recipes.forEach((r) => visit(r));
  return db;
}
export function demoDB() {
  const db = emptyDB();
  const make = (key, label, qty, unit, price, contains) => ({
    id: key,
    name: label,
    brand: "Ejemplo",
    supplier: "Proveedor de muestra",
    packageQty: qty,
    unit,
    price,
    priceDate: today(),
    wastePct: 0,
    contains,
    traces: [],
    allergensReviewed: false,
    reviewDate: "",
    allergenSource: "",
    notes: "Dato ficticio para probar la aplicación.",
    active: true,
  });
  db.ingredients = [
    make("demo_flour", "Harina de trigo", 1, "kg", 1.2, ["Gluten"]),
    make("demo_milk", "Leche entera", 1, "l", 1.1, ["Leche"]),
    make("demo_egg", "Huevos", 12, "ud", 3.6, ["Huevo"]),
    make("demo_honey", "Miel", 500, "g", 4.5, []),
    make("demo_fruit", "Fruta de temporada", 1, "kg", null, []),
  ];
  db.recipes = [
    {
      id: "demo_batter",
      name: "Masa de tortitas",
      yieldQty: 10,
      yieldUnit: "racion",
      notes: "Receta ficticia. Sustituir por la formulación real.",
      lines: [
        {
          sourceType: "ingredient",
          sourceId: "demo_flour",
          qty: 400,
          unit: "g",
        },
        {
          sourceType: "ingredient",
          sourceId: "demo_milk",
          qty: 600,
          unit: "ml",
        },
        { sourceType: "ingredient", sourceId: "demo_egg", qty: 3, unit: "ud" },
      ],
    },
  ];
  db.products = [
    {
      id: "demo_pancakes",
      name: "Tortitas con miel",
      category: "Dulces",
      pvp: 5.5,
      taxRate: 0,
      indirectCost: 0.12,
      notes: "Ejemplo para explorar el escandallo.",
      lines: [
        {
          sourceType: "recipe",
          sourceId: "demo_batter",
          qty: 1,
          unit: "racion",
        },
        {
          sourceType: "ingredient",
          sourceId: "demo_honey",
          qty: 25,
          unit: "g",
        },
      ],
    },
    {
      id: "demo_bowl",
      name: "Bowl de fruta",
      category: "Desayunos",
      pvp: 4.5,
      taxRate: 0,
      indirectCost: 0,
      notes: "",
      lines: [
        {
          sourceType: "ingredient",
          sourceId: "demo_fruit",
          qty: 200,
          unit: "g",
        },
      ],
    },
  ];
  return db;
}
