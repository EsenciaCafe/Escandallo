import "./styles.css";
import {
  ALLERGENS,
  UNITS,
  unitLabel,
  uid,
  today,
  money,
  number,
  percent,
  escapeHTML as esc,
  emptyDB,
  demoDB,
  validateDB,
  calculate,
  ingredientCost,
  references,
} from "./domain.js";
import {
  client,
  configured,
  readDocument,
  writeDocument,
  ConflictError,
} from "./store.js";

const root = document.querySelector("#root"),
  dialog = document.querySelector("#editor");
let db = emptyDB(),
  revision = 0,
  user = null,
  demo = false,
  view = "dashboard",
  search = "",
  filter = "",
  busy = false,
  refreshing = false,
  syncState = "saved",
  updatedAt = null,
  modalDirty = false,
  pageDirty = false,
  candidateDraft = null,
  authGeneration = 0;
const titles = {
  dashboard: "Una cocina con las cuentas claras.",
  ingredients: "Todo empieza en la despensa.",
  recipes: "Tus preparaciones, al detalle.",
  products: "Cada plato tiene sus números.",
  allergens: "La información, sobre la mesa.",
  settings: "Tu cuaderno, a tu manera.",
};
const labels = {
  dashboard: "Resumen",
  ingredients: "Ingredientes",
  recipes: "Subrecetas",
  products: "Productos",
  allergens: "Alérgenos",
  settings: "Ajustes",
};
const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  ingredients: "M5 8h14v13H5z M8 8V4h8v4 M5 13h14",
  recipes: "M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h4",
  products: "M3 15h18 M5 15a7 7 0 0 1 14 0 M12 5v3 M4 19h16",
  allergens: "M12 3l9 4v5c0 5-9 9-9 9s-9-4-9-9V7z M8 12l3 3 5-6",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  close: "M6 6l12 12 M6 18L18 6",
  logout: "M9 3H4v18h5 M9 12h12 M17 8l4 4-4 4",
  check: "M5 12l4 4L19 6",
  refresh: "M20 7a9 9 0 1 0 1 9 M20 3v5h-5",
  print: "M7 8V3h10v5 M7 17H3V9h18v8h-4 M7 14h10v7H7z",
  leaf: "M20 3C8 2 1 10 6 17s16 3 14-14z M6 18L16 8",
};
const icon = (key, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key] || paths.recipes}"/></svg>`;
const button = (label, action, kind = "primary", i = "") =>
  `<button class="btn ${kind}" data-action="${action}">${i ? icon(i) : ""}${label}</button>`;
const tags = (list, kind = "") =>
  list.map((a) => `<span class="tag ${kind}">${esc(a)}</span>`).join("");
const initial = (name) => esc((name || "?").slice(0, 1).toUpperCase());
function toast(message) {
  if (dialog.open) {
    let note = dialog.querySelector(".dialog-toast");
    if (!note) {
      note = document.createElement("p");
      note.className = "dialog-toast notice";
      note.setAttribute("role", "status");
      dialog.querySelector(".dialog-heading").after(note);
    }
    note.textContent = message;
    note.scrollIntoView({ block: "nearest" });
    return;
  }
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 5500);
}
function errorMessage(err) {
  if (err instanceof ConflictError) return err.message;
  if (/Invalid login credentials/i.test(err.message))
    return "El correo o la contraseña no son correctos.";
  if (/fetch|network|timeout/i.test(err.message))
    return "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo. Tus cambios siguen abiertos.";
  if (/ESENCIA_ACCESS/.test(err.message))
    return "Esta cuenta aún no tiene acceso al cuaderno. Pide que se habilite en la base de datos.";
  return err.message || "No se pudo completar la operación.";
}
function stamp() {
  return updatedAt
    ? new Date(updatedAt).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "ahora";
}
function syncLabel() {
  return demo
    ? "Demostración · datos ficticios"
    : !navigator.onLine
      ? "Sin conexión · solo consulta"
      : syncState === "error"
        ? "Sin confirmar · volver a actualizar"
        : busy
          ? "Guardando…"
          : `Sincronizado · ${stamp()}`;
}
function setSync(state) {
  syncState = state;
  const el = document.querySelector("#sync-status");
  if (el) {
    el.textContent = syncLabel();
    el.dataset.state = state;
  }
}
function renderLogin(message = "") {
  root.innerHTML = `<div class="login-layout"><section class="login-story"><a class="wordmark" href="./">esencia<span>CUADERNO DE COCINA</span></a><div class="story-copy"><span class="eyebrow light">HECHO CON CABEZA. SERVIDO CON ALMA.</span><h1>El cuidado está<br>en cada detalle.</h1><p>Tu despensa, tus recetas y los números de tu cocina. Todo en el mismo lugar.</p></div><div class="story-art" aria-hidden="true"><div class="plate"><div class="plate-inner">${icon("leaf", 86)}</div></div><span class="art-caption">BUENOS INGREDIENTES.<br>MEJORES DECISIONES.</span></div><div class="story-footer">ESENCIA <span>Un poco de orden. Mucha tranquilidad.</span></div></section><main class="login-main"><div class="login-card"><span class="eyebrow">BIENVENIDO A TU COCINA</span><h2>Todo en su punto.</h2><p class="muted">Accede a tu cuaderno desde el ordenador, el móvil o la tablet.</p>${message ? `<div class="notice warning" role="alert">${esc(message)}</div>` : ""}${configured ? `<form id="login-form"><label>Correo electrónico<input type="email" name="email" autocomplete="username" placeholder="tu@correo.com" required></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" required placeholder="Tu contraseña"></label><div id="login-error" class="form-error" role="alert"></div><button class="btn primary full" type="submit">Entrar a mi cuaderno ${icon("arrow")}</button></form><p class="small muted">Acceso privado con tu cuenta de Esencia. No se crean cuentas desde esta página.</p>` : `<div class="notice">El cuaderno está preparado. Falta conectar la cuenta de Esencia para guardar tus datos en la nube.</div>`}<div class="demo-divider"><span>¿Quieres echar un vistazo?</span></div>${button("Explorar una demostración", "demo", "secondary full", "arrow")}<p class="small muted center">Solo ejemplos ficticios. Los cambios de la demostración se descartan al salir.</p></div><span class="login-bottom">ESENCIA · ESCANDALLOS & ALÉRGENOS</span></main></div>`;
}
function shell() {
  root.innerHTML = `<div class="workspace"><aside class="sidebar"><a class="wordmark" href="./">esencia<span>CUADERNO DE COCINA</span></a><p class="nav-label">TU COCINA</p><nav aria-label="Navegación principal">${Object.keys(
    labels,
  )
    .map(
      (v) =>
        `<button data-nav="${v}" class="nav-item ${view === v ? "active" : ""}" ${view === v ? 'aria-current="page"' : ""}>${icon(v)}<span>${labels[v]}</span>${v === "ingredients" ? `<small>${db.ingredients.length}</small>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-note">${icon("leaf", 26)}<p>Conocer lo que sirves<br>también es cuidar.</p></div><div class="account"><div class="avatar">${demo ? "D" : initial(user?.email)}</div><div><strong>${demo ? "Modo demostración" : "Mi cuenta"}</strong><small>${demo ? "Sin guardado en la nube" : esc(user?.email)}</small></div><button class="icon-btn" data-action="logout" aria-label="${demo ? "Salir de la demostración" : "Cerrar sesión"}">${icon("logout", 18)}</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Esencia <span>/</span> <strong>${labels[view]}</strong></div><div class="top-actions"><span class="sync-dot ${demo ? "demo-dot" : ""}"></span><span id="sync-status" class="small" role="status">${syncLabel()}</span><button class="icon-btn" data-action="refresh" aria-label="Actualizar datos">${icon("refresh", 17)}</button><button class="icon-btn mobile-exit" data-action="logout" aria-label="Cerrar sesión">${icon("logout", 18)}</button></div></header><div class="page"><div class="page-heading"><div><span class="eyebrow">${view === "dashboard" ? "EL PULSO DE TU COCINA" : labels[view].toUpperCase()}</span><h1>${titles[view]}</h1></div><div class="heading-actions">${["ingredients", "recipes", "products"].includes(view) ? button(view === "ingredients" ? "Nuevo ingrediente" : view === "recipes" ? "Nueva subreceta" : "Nuevo producto", `new-${view}`, "primary", "plus") : view === "dashboard" ? button("Crear producto", "new-products", "primary", "plus") : view === "allergens" ? button("Imprimir matriz", "print-allergens", "secondary", "print") : ""}</div></div><div id="view-content">${viewHTML()}</div><footer class="page-footer"><span>ESENCIA · CUADERNO DE COCINA</span><span>Los pequeños detalles cuentan.</span></footer></div></main><nav class="mobile-nav" aria-label="Navegación móvil">${["dashboard", "ingredients", "recipes", "products", "allergens", "settings"].map((v) => `<button data-nav="${v}" class="${view === v ? "active" : ""}" aria-label="${labels[v]}">${icon(v, 20)}<small>${labels[v]}</small></button>`).join("")}</nav></div>`;
}
function viewHTML() {
  return view === "dashboard"
    ? dashboard()
    : view === "allergens"
      ? allergenView()
      : view === "settings"
        ? settingsView()
        : catalogView();
}
function dashboard() {
  const products = db.products.map((p) => ({ ...p, c: calculate(db, p) })),
    pending = products.filter((p) => p.c.incomplete),
    reviewed = products.filter((p) => p.c.allergensReviewed),
    complete = products.filter((p) => p.c.foodCost != null),
    average = complete.length
      ? complete.reduce((n, p) => n + p.c.foodCost, 0) / complete.length
      : null;
  return `${demo ? '<div class="demo-banner">ESTÁS EN LA DEMOSTRACIÓN <span>Prueba los formularios. Estos precios y recetas son ficticios.</span></div>' : ""}<section class="stats-grid"><div class="stat-card"><span>Ingredientes en despensa ${icon("ingredients")}</span><strong>${db.ingredients.length}<small>ingredientes</small></strong><p>${db.ingredients.filter((i) => ingredientCost(i) == null).length} con precio o formato pendiente</p></div><div class="stat-card"><span>Productos en carta ${icon("products")}</span><strong>${db.products.length}<small>productos</small></strong><p>${db.recipes.length} subrecetas de base</p></div><div class="stat-card"><span>Coste medio sobre venta ${icon("recipes")}</span><strong>${percent(average)}</strong><p>Media simple · objetivo ${percent(db.settings.targetFoodCost)}</p></div><div class="stat-card accent"><span>Alérgenos revisados ${icon("allergens")}</span><strong>${reviewed.length}<small>/ ${db.products.length} productos</small></strong><p>${reviewed.length === db.products.length && db.products.length ? "Todas las fichas revisadas" : "Comprueba las fichas de tus proveedores"}</p></div></section><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">COSTES A SIMPLE VISTA</span><h2>Tu carta, en números</h2></div><button class="text-btn" data-nav="products">Ver productos ${icon("arrow", 16)}</button></div>${
    products.length
      ? `<div class="product-overview">${products
          .slice(0, 6)
          .map(
            (p) =>
              `<button class="overview-row" data-detail="${esc(p.id)}"><div class="dish-icon">${icon("products", 24)}</div><div class="overview-name"><strong>${esc(p.name)}</strong><small>${esc(p.category || "Sin categoría")}</small></div><div class="overview-cost"><strong>${money(p.c.cost)}</strong><small>coste / ración</small></div><div class="overview-pvp"><strong>${money(p.pvp)}</strong><small>PVP</small></div><div>${p.c.incomplete ? '<span class="tag warning">Por completar</span>' : `<span class="tag ${p.c.foodCost > db.settings.targetFoodCost ? "warning" : "green"}">${percent(p.c.foodCost)}</span>`}</div>${icon("arrow", 16)}</button>`,
          )
          .join("")}</div>`
      : emptyState(
          "Tu carta empieza aquí.",
          "Añade ingredientes, prepara una subreceta y crea tu primer producto.",
          "new-ingredients",
          "Añadir ingrediente",
        )
  }</section><aside class="panel attention"><span class="eyebrow">UN POCO DE ATENCIÓN</span><h2>Para dejarlo al día</h2><div class="attention-number">${pending.length.toString().padStart(2, "0")}<span>escandallos<br>por completar</span></div><p class="muted">Un precio o una cantidad pendiente puede cambiar todo el resultado.</p>${pending
    .slice(0, 3)
    .map(
      (p) =>
        `<button class="attention-item" data-detail="${esc(p.id)}"><span>${esc(p.name)}</span>${icon("arrow", 16)}</button>`,
    )
    .join(
      "",
    )}${!pending.length ? '<p class="small">No hay escandallos incompletos.</p>' : ""}<button class="text-btn" data-nav="ingredients">Revisar la despensa ${icon("arrow", 16)}</button></aside></div><section class="bottom-note">${icon("leaf", 32)}<div><h3>Una receta cambia. Todo se actualiza.</h3><p>Al cambiar un ingrediente, sus costes y alérgenos se recalculan en todas las preparaciones que lo utilizan.</p></div></section>`;
}
function emptyState(title, description, action = "", label = "") {
  return `<div class="empty-state">${icon("leaf", 38)}<h3>${title}</h3><p>${description}</p>${action ? button(label, action, "secondary", "plus") : ""}</div>`;
}
function catalogView() {
  const noun =
    view === "ingredients"
      ? "ingrediente, marca o proveedor"
      : view === "recipes"
        ? "subreceta"
        : "producto o categoría";
  return `<div class="catalog-toolbar"><label class="search-box">${icon("search", 19)}<input id="catalog-search" type="search" value="${esc(search)}" placeholder="Buscar ${noun}…" aria-label="Buscar ${noun}"></label><select id="catalog-filter" aria-label="Filtrar listado"><option value="">Todos</option><option value="pending" ${filter === "pending" ? "selected" : ""}>Coste pendiente</option><option value="review" ${filter === "review" ? "selected" : ""}>Alérgenos por revisar</option>${view === "ingredients" ? ALLERGENS.map((a) => `<option value="${esc(a)}" ${filter === a ? "selected" : ""}>${a}</option>`).join("") : ""}</select><span class="small muted" id="result-count"></span></div><div id="catalog-results">${catalogResults()}</div>`;
}
function filtered() {
  const q = search.trim().toLocaleLowerCase("es");
  return db[view]
    .filter((x) => {
      if (
        ![x.name, x.brand, x.supplier, x.category]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(q)
      )
        return false;
      const c =
        view === "ingredients"
          ? {
              incomplete: ingredientCost(x) == null,
              allergensReviewed: x.allergensReviewed,
              contains: x.contains,
              traces: x.traces,
            }
          : calculate(db, x, view === "recipes" ? "recipe" : "product");
      return (
        !filter ||
        (filter === "pending"
          ? c.incomplete
          : filter === "review"
            ? !c.allergensReviewed
            : c.contains.includes(filter) || c.traces.includes(filter))
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
function catalogResults() {
  const items = filtered();
  if (!items.length)
    return emptyState(
      "Todavía no hay nada por aquí.",
      search || filter
        ? "Prueba otra búsqueda o cambia el filtro."
        : "Añade el primer elemento para empezar.",
      !search && !filter ? `new-${view}` : "",
      "Añadir",
    );
  if (view === "ingredients")
    return `<div class="panel table-wrap"><table class="data-table"><thead><tr><th>Ingrediente</th><th>Formato de compra</th><th>Precio</th><th>Coste útil</th><th>Alérgenos</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${items.map((i) => `<tr><td><button class="table-name" data-edit="ingredients" data-id="${esc(i.id)}"><span class="ingredient-avatar">${initial(i.name)}</span><span><strong>${esc(i.name)}</strong><small>${esc([i.brand, i.supplier].filter(Boolean).join(" · ") || "Sin proveedor")}</small></span></button></td><td>${i.packageQty ? `${number(i.packageQty)} ${unitLabel(i.unit)}` : '<span class="tag warning">Pendiente</span>'}</td><td>${money(i.price)}<small>${i.priceDate ? esc(i.priceDate) : "Sin fecha"}</small></td><td>${ingredientCost(i) == null ? "—" : `${number(ingredientCost(i), 4)} €/${unitLabel(i.unit)}`}<small>${i.wastePct ? `${number(i.wastePct)} % de merma` : "Sin merma"}</small></td><td><div class="tags">${!i.allergensReviewed ? '<span class="tag warning">Por revisar</span>' : ""}${tags(i.contains, "allergen")}${i.allergensReviewed && !i.contains.length ? '<span class="tag green">Sin declarados</span>' : ""}</div></td><td><button class="icon-btn" data-edit="ingredients" data-id="${esc(i.id)}" aria-label="Editar ${esc(i.name)}">${icon("arrow", 18)}</button></td></tr>`).join("")}</tbody></table></div><p class="small muted">${items.length} ingredientes · El coste útil incluye la merma. Precios de compra según el criterio indicado en Ajustes.</p>`;
  return `<div class="cards-grid">${items
    .map((x) => {
      const recipe = view === "recipes",
        c = calculate(db, x, recipe ? "recipe" : "product");
      return `<article class="recipe-card"><div class="recipe-card-top"><span class="dish-icon">${icon(recipe ? "recipes" : "products", 27)}</span><span class="tag ${c.incomplete ? "warning" : "green"}">${c.incomplete ? "Coste pendiente" : recipe ? "Preparación base" : `${percent(c.foodCost)} de coste`}</span></div><p class="eyebrow">${recipe ? "SUBRECETA" : esc(x.category || "SIN CATEGORÍA")}</p><h2>${esc(x.name)}</h2><p class="small muted">${recipe ? `Rinde ${number(x.yieldQty)} ${unitLabel(x.yieldUnit)}` : `PVP ${money(x.pvp)} · IGIC ${percent(x.taxRate)}`} · ${x.lines.length} componentes</p><div class="card-price"><strong>${money(c.cost)}</strong><span>/ ${recipe ? unitLabel(x.yieldUnit) : "producto"}</span></div><div class="tags">${tags(c.contains, "allergen")}${!c.allergensReviewed ? '<span class="tag outlined">Alérgenos por revisar</span>' : ""}</div><div class="card-footer">${recipe ? `<button class="text-btn" data-edit="recipes" data-id="${esc(x.id)}">Editar preparación ${icon("arrow", 17)}</button>` : `<button class="text-btn" data-detail="${esc(x.id)}">Ver escandallo ${icon("arrow", 17)}</button>`}</div></article>`;
    })
    .join("")}</div>`;
}
function allergenMatrix(print = false) {
  if (!db.products.length)
    return emptyState(
      "La matriz empieza con tu carta.",
      "Crea productos para ver sus alérgenos.",
    );
  return `<div class="${print ? "" : "panel matrix-scroll"}"><table class="matrix"><thead><tr><th>Producto</th>${ALLERGENS.map((a) => `<th><span>${a}</span></th>`).join("")}<th>Revisión</th></tr></thead><tbody>${db.products
    .map((p) => {
      const c = calculate(db, p);
      return `<tr><th>${esc(p.name)}</th>${ALLERGENS.map((a) => {
        const v = c.contains.includes(a)
          ? "C"
          : c.traces.includes(a)
            ? "T"
            : c.allergensReviewed
              ? "—"
              : "?";
        return `<td class="cell-${v === "C" ? "contains" : v === "T" ? "traces" : v === "?" ? "unknown" : "none"}" aria-label="${esc(p.name)}: ${a}, ${v === "C" ? "contiene" : v === "T" ? "puede contener" : v === "?" ? "pendiente de revisar" : "no declarado"}">${v}</td>`;
      }).join(
        "",
      )}<td><span class="tag ${c.allergensReviewed ? "green" : "warning"}">${c.allergensReviewed ? "Revisado" : "Pendiente"}</span></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function allergenView() {
  return `<div class="allergen-intro"><div><h2>Una carta más transparente.</h2><p class="muted">La matriz reúne las declaraciones de los ingredientes y subrecetas de cada producto.</p></div>${icon("allergens", 45)}</div><div class="matrix-legend"><span><b class="legend contains">C</b> Contiene</span><span><b class="legend traces">T</b> Puede contener / trazas</span><span><b class="legend unknown">?</b> Pendiente de revisar</span><span><b class="legend">—</b> No declarado en fichas revisadas</span></div>${allergenMatrix()}<div class="notice warm">La revisión se marca en cada ingrediente después de comprobar su etiqueta o ficha. La matriz no evalúa la contaminación cruzada durante la preparación.</div>`;
}
function settingsView() {
  return `<div class="settings-grid"><section class="panel padded"><span class="eyebrow">CRITERIOS DE CÁLCULO</span><h2>Los números de tu cocina</h2><form id="settings-form">${field("Nombre del negocio", "businessName", db.settings.businessName, "text", 'required maxlength="200"')}${field("Objetivo de coste sobre venta (%)", "targetFoodCost", db.settings.targetFoodCost, "number", 'min="1" max="100" step="0.1" required')}${field("IGIC por defecto para nuevos productos (%)", "defaultTaxRate", db.settings.defaultTaxRate, "number", 'min="0" max="100" step="0.01" required')}<p class="small muted">El PVP incluye el IGIC que indiques. El margen se calcula sobre la venta sin IGIC. Introduce los precios de compra con un criterio homogéneo, descontando únicamente los impuestos recuperables que te correspondan. El margen mostrado resta ingredientes e indirectos; no representa el beneficio neto del negocio.</p><div class="form-error" role="alert"></div><button class="btn primary">Guardar ajustes</button></form></section><section class="panel padded"><span class="eyebrow">TUS DATOS, A MANO</span><h2>Copias y recuperación</h2><p class="muted">Descarga una copia completa antes de hacer cambios importantes. Puedes recuperar las copias de la versión anterior.</p><div class="stack-actions">${button("Descargar copia JSON", "export", "secondary", "download")}${button("Importar una copia", "import", "secondary", "recipes")}${button("Recuperar datos del antiguo navegador", "legacy", "text", "refresh")}</div><input type="file" id="import-file" accept=".json,application/json" hidden><div class="settings-separator"></div><h3>${demo ? "Estás explorando una demostración" : "Conectado a tu cuenta"}</h3><p class="small muted">${demo ? "Los ejemplos no se guardan en la nube." : `${esc(user?.email)}<br>Los cambios se guardan al pulsar Guardar. Se actualizan al volver a la página y cada 30 segundos mientras no estés editando.`}</p>${button(demo ? "Salir de la demostración" : "Cerrar sesión", "logout", "secondary", "logout")}</section></div>`;
}
function field(label, name, value = "", type = "text", attrs = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value ?? "")}" ${attrs}></label>`;
}
function selectField(label, name, options, value) {
  return `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
function openDialog(title, content, wide = false) {
  modalDirty = false;
  candidateDraft = null;
  dialog.className = wide ? "wide" : "";
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">ESENCIA · CUADERNO DE COCINA</span><h2 id="dialog-title">${esc(title)}</h2></div><button class="icon-btn" data-action="close" aria-label="Cerrar">${icon("close")}</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog(force = false) {
  if (busy) return;
  if (
    !force &&
    modalDirty &&
    !confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?")
  )
    return;
  dialog.close();
  dialog.innerHTML = "";
  modalDirty = false;
  candidateDraft = null;
}
function checks(title, name, selected) {
  return `<fieldset class="allergen-checks"><legend>${title}</legend><div>${ALLERGENS.map((a) => `<label><input type="checkbox" name="${name}" value="${esc(a)}" ${selected.includes(a) ? "checked" : ""}><span>${a}</span></label>`).join("")}</div></fieldset>`;
}
function formActions(existing, kind, id) {
  return `<div class="form-error" role="alert"></div><div class="dialog-actions">${existing ? `<button type="button" class="btn danger" data-delete="${kind}" data-id="${esc(id)}">Eliminar</button>` : ""}<span class="spacer"></span><button type="button" class="btn secondary" data-action="close">Cancelar</button><button class="btn primary" type="submit">Guardar ${icon("check", 17)}</button></div>`;
}
function editIngredient(id) {
  const existing = db.ingredients.find((x) => x.id === id),
    i = existing
      ? structuredClone(existing)
      : {
          id: uid("ing"),
          name: "",
          brand: "",
          supplier: "",
          packageQty: null,
          unit: "g",
          price: null,
          priceDate: today(),
          wastePct: 0,
          contains: [],
          traces: [],
          allergensReviewed: false,
          reviewDate: "",
          allergenSource: "",
          notes: "",
          active: true,
        };
  openDialog(
    existing ? "Editar ingrediente" : "Un nuevo ingrediente",
    `<form id="ingredient-form" data-id="${esc(i.id)}"><div class="form-section-label">EN LA DESPENSA</div>${field("Nombre del ingrediente", "name", i.name, "text", 'required maxlength="200" placeholder="Por ejemplo, harina de trigo"')}<div class="form-grid two">${field("Marca", "brand", i.brand)}${field("Proveedor", "supplier", i.supplier)}</div><div class="form-section-label">FORMATO Y COSTE</div><div class="form-grid three">${field("Cantidad del envase", "packageQty", i.packageQty, "number", 'min="0.000001" step="any" placeholder="Pendiente"')}${selectField(
      "Unidad",
      "unit",
      ["g", "kg", "ml", "l", "ud"].map((u) => [u, unitLabel(u)]),
      i.unit,
    )}${field("Precio de compra (€)", "price", i.price, "number", 'min="0" step="any" placeholder="Pendiente"')}</div><div class="form-grid two">${field("Fecha del precio", "priceDate", i.priceDate, "date")}${field("Merma no aprovechable (%)", "wastePct", i.wastePct, "number", 'min="0" max="99.99" step="0.01" required')}</div><p class="small muted">Puedes dejar precio y formato pendientes. La merma aumenta el coste por unidad aprovechable.</p><div class="form-section-label">LO QUE DICE LA ETIQUETA</div>${checks("Contiene", "contains", i.contains)}${checks("Puede contener / trazas", "traces", i.traces)}<label class="review-check"><input type="checkbox" name="allergensReviewed" ${i.allergensReviewed ? "checked" : ""}><span>He comprobado los alérgenos con la etiqueta o ficha del proveedor.</span></label>${field("Referencia de la ficha o etiqueta", "allergenSource", i.allergenSource, "text", 'maxlength="1000" placeholder="Proveedor, nombre de ficha o enlace"')}${i.reviewDate ? `<p class="small muted">Última revisión: ${esc(i.reviewDate)}</p>` : ""}<label>Notas<textarea name="notes" maxlength="2000" rows="3">${esc(i.notes)}</textarea></label>${formActions(existing, "ingredients", i.id)}</form>`,
  );
}
function lineHTML(line = {}, selfId = "") {
  const source =
    line.sourceType && line.sourceId
      ? `${line.sourceType}|${line.sourceId}`
      : "";
  const options = (type, list) =>
    list
      .map(
        (x) =>
          `<option value="${type}|${esc(x.id)}" ${source === `${type}|${x.id}` ? "selected" : ""}>${esc(x.name)}</option>`,
      )
      .join("");
  return `<div class="composition-line"><label><span class="sr-only">Ingrediente o subreceta</span><select class="line-source" required><option value="">Seleccionar ingrediente o subreceta…</option><optgroup label="Ingredientes">${options("ingredient", db.ingredients)}</optgroup><optgroup label="Subrecetas">${options(
    "recipe",
    db.recipes.filter((r) => r.id !== selfId),
  )}</optgroup></select></label><label><span class="sr-only">Cantidad</span><input class="line-qty" type="number" min="0.000001" step="any" required placeholder="Cantidad" value="${esc(line.qty ?? "")}"></label><label><span class="sr-only">Unidad</span><select class="line-unit">${Object.keys(
    UNITS,
  )
    .map(
      (u) =>
        `<option value="${u}" ${u === (line.unit || "g") ? "selected" : ""}>${unitLabel(u)}</option>`,
    )
    .join(
      "",
    )}</select></label><button type="button" class="icon-btn remove-line" aria-label="Quitar componente">${icon("close", 17)}</button></div>`;
}
function editRecipeOrProduct(kind, id) {
  const existing = db[kind].find((x) => x.id === id),
    recipe = kind === "recipes";
  const x = existing
    ? structuredClone(existing)
    : recipe
      ? {
          id: uid("rec"),
          name: "",
          yieldQty: 1,
          yieldUnit: "racion",
          notes: "",
          lines: [],
        }
      : {
          id: uid("prd"),
          name: "",
          category: "",
          pvp: 0,
          taxRate: db.settings.defaultTaxRate,
          indirectCost: 0,
          notes: "",
          lines: [],
        };
  openDialog(
    existing
      ? `Editar ${recipe ? "subreceta" : "producto"}`
      : recipe
        ? "Una nueva preparación"
        : "Un nuevo producto",
    `<form id="composition-form" data-kind="${kind}" data-id="${esc(x.id)}">${field("Nombre", "name", x.name, "text", 'required maxlength="200"')}${
      recipe
        ? `<div class="form-grid two">${field("Rendimiento del lote", "yieldQty", x.yieldQty, "number", 'min="0.000001" step="any" required')}${selectField(
            "Unidad de rendimiento",
            "yieldUnit",
            Object.keys(UNITS).map((u) => [u, unitLabel(u)]),
            x.yieldUnit,
          )}</div>`
        : `${field("Categoría", "category", x.category, "text", 'maxlength="200" placeholder="Desayunos, tostas, dulces…"')}<div class="form-grid three">${field("PVP con IGIC (€)", "pvp", x.pvp, "number", 'min="0" step="0.01" required')}${field("IGIC (%)", "taxRate", x.taxRate, "number", 'min="0" max="100" step="0.01" required')}${field("Indirectos por producto (€)", "indirectCost", x.indirectCost, "number", 'min="0" step="any" required')}</div><p class="small muted">Indirectos: envase u otros costes que quieras imputar a cada producto.</p>`
    }<div class="composition-heading"><h3>${recipe ? "Composición del lote" : "Composición por producto"}</h3><button type="button" class="btn secondary small-btn" data-action="add-line">${icon("plus", 16)} Añadir componente</button></div><div id="composition-lines">${(x.lines.length ? x.lines : [{}]).map((l) => lineHTML(l, recipe ? x.id : "")).join("")}</div><div id="cost-preview" aria-live="polite"></div><label>Notas de preparación<textarea name="notes" rows="3" maxlength="2000">${esc(x.notes)}</textarea></label>${formActions(existing, kind, x.id)}</form>`,
    true,
  );
  updatePreview();
}
function collectEntity(form) {
  const fd = new FormData(form),
    recipe = form.dataset.kind === "recipes";
  const lines = [...form.querySelectorAll(".composition-line")].map((row) => {
    const [sourceType, sourceId] = row
      .querySelector(".line-source")
      .value.split("|");
    return {
      sourceType,
      sourceId,
      qty: Number(row.querySelector(".line-qty").value),
      unit: row.querySelector(".line-unit").value,
    };
  });
  const base = {
    id: form.dataset.id,
    name: fd.get("name").trim(),
    notes: fd.get("notes").trim(),
    lines,
  };
  return recipe
    ? {
        ...base,
        yieldQty: Number(fd.get("yieldQty")),
        yieldUnit: fd.get("yieldUnit"),
      }
    : {
        ...base,
        category: fd.get("category").trim(),
        pvp: Number(fd.get("pvp")),
        taxRate: Number(fd.get("taxRate")),
        indirectCost: Number(fd.get("indirectCost")),
      };
}
function updatePreview() {
  const form = document.querySelector("#composition-form");
  if (!form) return;
  const entity = collectEntity(form),
    recipe = form.dataset.kind === "recipes",
    c = calculate(db, entity, recipe ? "recipe" : "product");
  document.querySelector("#cost-preview").innerHTML =
    `<div class="preview-metrics"><div><span>${recipe ? "Coste del lote" : "Coste del producto"}</span><strong>${money(recipe ? c.totalCost : c.cost)}</strong></div><div><span>${recipe ? `Por ${unitLabel(entity.yieldUnit)}` : "Venta sin IGIC"}</span><strong>${money(recipe ? c.cost : c.netRevenue)}</strong></div>${!recipe ? `<div><span>Coste / venta</span><strong>${percent(c.foodCost)}</strong></div><div><span>Margen de contribución</span><strong>${money(c.margin)}</strong></div>` : ""}</div>${c.issues.length ? `<p class="small warning-text">${esc(c.issues.join(" "))}</p>` : ""}<div class="tags">${tags(c.contains, "allergen")}${tags(c.traces, "trace")}${!c.allergensReviewed ? '<span class="tag warning">Alérgenos pendientes de revisar</span>' : ""}</div>`;
}
function details(id) {
  const p = db.products.find((x) => x.id === id);
  if (!p) return;
  const c = calculate(db, p);
  openDialog(
    p.name,
    `<div class="detail-subtitle"><span class="tag outlined">${esc(p.category || "Sin categoría")}</span><span class="muted small">Escandallo por producto</span></div><div class="detail-metrics"><div><span>Coste del producto</span><strong>${money(c.cost)}</strong></div><div><span>PVP con IGIC</span><strong>${money(p.pvp)}</strong></div><div><span>Coste / venta neta</span><strong>${percent(c.foodCost)}</strong></div><div><span>Margen de contribución</span><strong>${money(c.margin)}</strong></div></div>${c.issues.length ? `<div class="notice warning"><strong>Este escandallo está incompleto</strong><ul>${c.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}<div class="section-title"><h3>Lo que lleva</h3><span class="small muted">${c.rows.length} componentes</span></div>${costTable(c, p)}<div class="detail-net"><span>Venta sin IGIC (${percent(p.taxRate)}) <b>${money(c.netRevenue)}</b></span><span>PVP orientativo para un coste del ${percent(db.settings.targetFoodCost)} <b>${money(c.suggestedPvp)}</b></span></div><h3>Alérgenos y trazas</h3><p class="small muted">Contiene</p><div class="tags">${tags(c.contains, "allergen") || '<span class="muted small">No hay alérgenos declarados en los datos introducidos.</span>'}</div><p class="small muted">Puede contener</p><div class="tags">${tags(c.traces, "trace") || '<span class="muted small">No hay trazas registradas.</span>'}</div>${!c.allergensReviewed ? `<div class="notice warm"><strong>Información pendiente de revisar</strong><ul>${c.allergenIssues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : '<p class="small green-text">Etiquetas o fichas de todos los ingredientes revisadas. La preparación puede añadir riesgos de contaminación cruzada.</p>'}${p.notes ? `<h3>Notas de preparación</h3><p class="preserve-lines">${esc(p.notes)}</p>` : ""}<div class="dialog-actions"><button class="btn secondary" data-print-product="${esc(id)}">${icon("print", 17)} Imprimir ficha</button><span class="spacer"></span><button class="btn primary" data-edit="products" data-id="${esc(id)}">Editar producto ${icon("arrow", 17)}</button></div>`,
    true,
  );
}
function costTable(c, p) {
  return `<div class="table-wrap"><table class="cost-table"><thead><tr><th>Componente</th><th>Cantidad</th><th>Coste</th></tr></thead><tbody>${c.rows.map((l) => `<tr><td>${esc(l.name)}${l.sourceType === "recipe" ? "<small>Subreceta</small>" : ""}</td><td>${number(l.qty)} ${unitLabel(l.unit)}</td><td>${money(l.cost)}</td></tr>`).join("")}<tr><td>Costes indirectos</td><td>1 producto</td><td>${money(p.indirectCost)}</td></tr></tbody><tfoot><tr><th>Coste total</th><td></td><th>${money(c.cost)}</th></tr></tfoot></table></div>`;
}
function exportJSON(value = db, label = "copia") {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `esencia-${label}-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function commit(next) {
  if (busy) throw new Error("Espera a que termine el guardado anterior.");
  const validated = validateDB(next);
  if (!demo && !navigator.onLine)
    throw new Error(
      "No hay conexión. Mantén el formulario abierto y guarda al recuperar internet.",
    );
  busy = true;
  setSync("saving");
  document
    .querySelectorAll(
      "button[type=submit], .dialog-actions button, #settings-form button",
    )
    .forEach((b) => (b.disabled = true));
  try {
    const generation = authGeneration;
    if (demo) {
      db = validated;
      updatedAt = new Date().toISOString();
    } else {
      const result = await writeDocument(validated, revision);
      if (generation !== authGeneration)
        throw new Error(
          "Tu sesión ha cambiado. Vuelve a entrar para comprobar el guardado.",
        );
      db = result.db;
      revision = result.revision;
      updatedAt = result.updatedAt;
    }
    pageDirty = false;
    setSync("saved");
  } catch (error) {
    setSync("error");
    throw error;
  } finally {
    busy = false;
    document
      .querySelectorAll("button[disabled]")
      .forEach((b) => (b.disabled = false));
    setSync(syncState);
  }
}
async function saveForm(form, next) {
  candidateDraft = next;
  try {
    await commit(next);
    closeDialog(true);
    shell();
    toast(
      demo ? "Cambio aplicado a la demostración." : "Guardado en tu cuaderno.",
    );
  } catch (error) {
    const el = form.querySelector(".form-error");
    el.innerHTML = `${esc(errorMessage(error))}${error instanceof ConflictError ? `<div class="conflict-actions"><button type="button" class="btn secondary" data-action="download-draft">Descargar mi borrador</button><button type="button" class="btn secondary" data-action="load-cloud">Cargar versión de la nube</button></div>` : ""}`;
    el.scrollIntoView({ block: "nearest" });
  }
}
async function removeEntity(kind, id) {
  const entity = db[kind].find((x) => x.id === id);
  if (!entity) return;
  const used =
    kind === "products"
      ? []
      : references(db, kind === "ingredients" ? "ingredient" : "recipe", id);
  if (used.length) {
    toast(
      `Se utiliza en: ${used.map((x) => x.name).join(", ")}. Quita esas referencias antes de eliminar.`,
    );
    return;
  }
  if (!confirm(`¿Eliminar «${entity.name}» de tu cuaderno?`)) return;
  const next = structuredClone(db);
  next[kind] = next[kind].filter((x) => x.id !== id);
  await saveForm(dialog.querySelector("form"), next);
}
function importPreview(raw) {
  const next = validateDB(raw);
  openDialog(
    "Recuperar una copia",
    `<p>Esta copia contiene <b>${next.ingredients.length} ingredientes</b>, <b>${next.recipes.length} subrecetas</b> y <b>${next.products.length} productos</b>.</p><div class="notice warning">La importación sustituirá los datos actuales de tu cuaderno${demo ? " de demostración" : " en todos tus dispositivos"}. Descarga primero una copia si quieres conservarlos.</div>${raw.version === 1 ? '<p class="small muted">Los alérgenos de la versión anterior se conservan y se marcan como pendientes de revisión.</p>' : ""}<form id="import-confirm"><div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="btn secondary" data-action="export">Descargar copia actual</button><span class="spacer"></span><button type="submit" class="btn primary">Sustituir por esta copia</button></div></form>`,
  );
  candidateDraft = next;
}
function printDocument(id) {
  const header = `<header class="print-heading"><span>ESENCIA · CUADERNO DE COCINA</span><p>${esc(db.settings.businessName)} · ${new Date().toLocaleDateString("es-ES")}</p></header>`;
  let content;
  if (id) {
    const p = db.products.find((x) => x.id === id),
      c = calculate(db, p);
    content = `<h1>${esc(p.name)}</h1><p>${esc(p.category)} · PVP ${money(p.pvp)} · IGIC ${percent(p.taxRate)} · Venta neta ${money(c.netRevenue)}</p>${costTable(c, p)}<p>Coste / venta: ${percent(c.foodCost)} · Margen de contribución: ${money(c.margin)}</p>${c.issues.length ? `<p><b>Coste incompleto:</b> ${esc(c.issues.join(" "))}</p>` : ""}<h2>Alérgenos</h2><p><b>Contiene:</b> ${esc(c.contains.join(", ") || "Ninguno registrado")}</p><p><b>Puede contener:</b> ${esc(c.traces.join(", ") || "Ninguno registrado")}</p><p><b>${c.allergensReviewed ? "Fichas de ingredientes revisadas." : "PENDIENTE DE REVISIÓN."}</b> ${esc(c.allergenIssues.join(" "))}</p><p class="preserve-lines">${esc(p.notes)}</p>`;
  } else {
    content = `<h1>Matriz de alérgenos</h1><p>C: contiene · T: puede contener · ?: pendiente de revisar · —: no declarado en fichas revisadas</p>${allergenMatrix(true)}`;
  }
  document.querySelector("#print-area").innerHTML =
    `${header}${content}<p class="print-footnote">Información obtenida de las fichas registradas. No evalúa la contaminación cruzada durante la preparación.</p>`;
  document.body.classList.toggle("print-matrix", !id);
  window.print();
}
async function refresh(force = false) {
  if (demo || !user || busy || refreshing || dialog.open || pageDirty) return;
  refreshing = true;
  const generation = authGeneration,
    startRevision = revision;
  try {
    const result = await readDocument(user.id);
    if (
      generation !== authGeneration ||
      busy ||
      dialog.open ||
      pageDirty ||
      revision !== startRevision
    )
      return;
    if (result.revision !== revision) {
      db = result.db;
      revision = result.revision;
      updatedAt = result.updatedAt;
      shell();
    }
    setSync("saved");
    if (force) toast("Cuaderno actualizado.");
  } catch (error) {
    setSync("error");
    if (force) toast(errorMessage(error));
  } finally {
    refreshing = false;
  }
}
async function sessionChanged(session) {
  if (demo) return;
  const nextUser = session?.user;
  if (nextUser?.id === user?.id && user) return;
  const generation = ++authGeneration;
  user = nextUser || null;
  db = emptyDB();
  revision = 0;
  pageDirty = false;
  if (dialog.open) {
    busy = false;
    closeDialog(true);
  }
  if (!user) {
    renderLogin();
    return;
  }
  root.innerHTML =
    '<div class="loading"><div class="loading-mark">e.</div><p>Abriendo tu cuaderno…</p></div>';
  try {
    const result = await readDocument(user.id);
    if (generation !== authGeneration) return;
    db = result.db;
    revision = result.revision;
    updatedAt = result.updatedAt;
    setSync("saved");
    shell();
  } catch (error) {
    if (generation !== authGeneration) return;
    root.innerHTML = `<div class="loading"><h2>No pudimos abrir tu cuaderno.</h2><p>${esc(errorMessage(error))}</p>${button("Volver a intentar", "retry", "primary")}${button("Cerrar sesión", "logout", "secondary")}</div>`;
  }
}
document.addEventListener("click", async (e) => {
  const target = e.target.closest("button");
  if (!target || busy) return;
  try {
    if (target.dataset.nav) {
      if (pageDirty && !confirm("¿Descartar los ajustes sin guardar?")) return;
      pageDirty = false;
      view = target.dataset.nav;
      search = "";
      filter = "";
      shell();
      window.scrollTo(0, 0);
      return;
    }
    if (target.dataset.edit) {
      if (modalDirty && !confirm("¿Descartar los cambios sin guardar?")) return;
      target.dataset.edit === "ingredients"
        ? editIngredient(target.dataset.id)
        : editRecipeOrProduct(target.dataset.edit, target.dataset.id);
      return;
    }
    if (target.dataset.detail) {
      details(target.dataset.detail);
      return;
    }
    if (target.dataset.delete) {
      await removeEntity(target.dataset.delete, target.dataset.id);
      return;
    }
    if (target.dataset.printProduct) {
      printDocument(target.dataset.printProduct);
      return;
    }
    if (target.classList.contains("remove-line")) {
      target.closest(".composition-line").remove();
      modalDirty = true;
      updatePreview();
      return;
    }
    const action = target.dataset.action;
    if (!action) return;
    if (action.startsWith("new-")) {
      const kind = action.slice(4);
      kind === "ingredients" ? editIngredient() : editRecipeOrProduct(kind);
      return;
    }
    switch (action) {
      case "demo":
        demo = true;
        db = demoDB();
        view = "dashboard";
        search = "";
        filter = "";
        shell();
        break;
      case "logout":
        if (pageDirty && !confirm("¿Salir sin guardar los ajustes?")) return;
        pageDirty = false;
        if (demo) {
          demo = false;
          user = null;
          db = emptyDB();
          view = "dashboard";
          if (client) {
            const { data } = await client.auth.getSession();
            await sessionChanged(data.session);
          } else renderLogin();
        } else {
          const { error } = await client.auth.signOut({ scope: "local" });
          if (error) throw error;
          await sessionChanged(null);
        }
        break;
      case "close":
        closeDialog();
        break;
      case "add-line": {
        const form = document.querySelector("#composition-form");
        document
          .querySelector("#composition-lines")
          .insertAdjacentHTML(
            "beforeend",
            lineHTML(
              {},
              form.dataset.kind === "recipes" ? form.dataset.id : "",
            ),
          );
        modalDirty = true;
        updatePreview();
        break;
      }
      case "refresh":
        await refresh(true);
        break;
      case "retry": {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        user = null;
        await sessionChanged(data.session);
        break;
      }
      case "export":
        exportJSON();
        break;
      case "download-draft":
        if (candidateDraft) exportJSON(candidateDraft, "borrador");
        break;
      case "load-cloud":
        if (
          confirm(
            "¿Cerrar este borrador y cargar los datos de la nube? Descárgalo antes si quieres conservarlo.",
          )
        ) {
          pageDirty = false;
          closeDialog(true);
          await refresh(true);
        }
        break;
      case "import":
        document.querySelector("#import-file").click();
        break;
      case "legacy": {
        const raw = localStorage.getItem("esencia-costes-v1");
        if (!raw)
          throw new Error(
            "No hay datos de la versión anterior en este navegador y dirección. Exporta un JSON desde la aplicación antigua e impórtalo aquí.",
          );
        importPreview(JSON.parse(raw));
        break;
      }
      case "print-allergens":
        printDocument();
        break;
    }
  } catch (error) {
    toast(errorMessage(error));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#settings-form")) pageDirty = true;
  if (e.target.id === "catalog-search") {
    search = e.target.value;
    document.querySelector("#catalog-results").innerHTML = catalogResults();
  }
  if (dialog.contains(e.target)) {
    modalDirty = true;
    if (e.target.closest("#composition-form")) updatePreview();
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.id === "catalog-filter") {
      filter = e.target.value;
      document.querySelector("#catalog-results").innerHTML = catalogResults();
    }
    if (e.target.classList.contains("line-source")) {
      const [type, id] = e.target.value.split("|"),
        source = (type === "ingredient" ? db.ingredients : db.recipes).find(
          (x) => x.id === id,
        );
      if (source)
        e.target
          .closest(".composition-line")
          .querySelector(".line-unit").value =
          type === "ingredient" ? source.unit : source.yieldUnit;
      updatePreview();
    }
    if (e.target.id === "import-file") {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 4_000_000)
        throw new Error("La copia supera el tamaño máximo de 4 MB.");
      importPreview(JSON.parse(await file.text()));
      e.target.value = "";
    }
    if (dialog.contains(e.target)) modalDirty = true;
  } catch (error) {
    toast(errorMessage(error));
    if (e.target.id === "import-file") e.target.value = "";
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  if (busy) return;
  try {
    if (form.id === "login-form") {
      const submit = form.querySelector("button"),
        fd = new FormData(form);
      submit.disabled = true;
      submit.textContent = "Entrando…";
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: fd.get("email").trim(),
          password: fd.get("password"),
        });
        if (error) throw error;
        await sessionChanged(data.session);
      } catch (error) {
        form.querySelector("#login-error").textContent = errorMessage(error);
        submit.disabled = false;
        submit.innerHTML = `Entrar a mi cuaderno ${icon("arrow")}`;
      }
      return;
    }
    if (form.id === "import-confirm") {
      await saveForm(form, candidateDraft);
      return;
    }
    const next = structuredClone(db),
      fd = new FormData(form);
    if (form.id === "settings-form") {
      next.settings = {
        businessName: fd.get("businessName").trim(),
        targetFoodCost: Number(fd.get("targetFoodCost")),
        defaultTaxRate: Number(fd.get("defaultTaxRate")),
      };
      await saveForm(form, next);
      return;
    }
    let kind, entity;
    if (form.id === "ingredient-form") {
      kind = "ingredients";
      const previous = db.ingredients.find((x) => x.id === form.dataset.id),
        checked = fd.has("allergensReviewed");
      entity = {
        id: form.dataset.id,
        name: fd.get("name").trim(),
        brand: fd.get("brand").trim(),
        supplier: fd.get("supplier").trim(),
        packageQty:
          fd.get("packageQty") === "" ? null : Number(fd.get("packageQty")),
        unit: fd.get("unit"),
        price: fd.get("price") === "" ? null : Number(fd.get("price")),
        priceDate: fd.get("priceDate"),
        wastePct: Number(fd.get("wastePct")),
        contains: fd.getAll("contains"),
        traces: fd.getAll("traces"),
        allergensReviewed: checked,
        reviewDate: checked ? today() : "",
        allergenSource: fd.get("allergenSource").trim(),
        notes: fd.get("notes").trim(),
        active: previous?.active ?? true,
      };
    } else if (form.id === "composition-form") {
      kind = form.dataset.kind;
      entity = collectEntity(form);
      if (!entity.lines.length)
        throw new Error("Añade al menos un componente antes de guardar.");
      const c = calculate(
        db,
        entity,
        kind === "recipes" ? "recipe" : "product",
      );
      if (c.issues.some((i) => i.includes("unidades incompatibles")))
        throw new Error("Corrige las unidades incompatibles antes de guardar.");
    } else return;
    const index = next[kind].findIndex((x) => x.id === entity.id);
    if (index < 0) next[kind].push(entity);
    else next[kind][index] = entity;
    await saveForm(form, next);
  } catch (error) {
    const el = form.querySelector(".form-error");
    if (el) el.textContent = errorMessage(error);
    else toast(errorMessage(error));
  }
});
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDialog();
});
window.addEventListener("beforeunload", (e) => {
  if (busy || modalDirty || pageDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("afterprint", () => {
  document.querySelector("#print-area").innerHTML = "";
  document.body.classList.remove("print-matrix");
});
window.addEventListener("online", () => {
  setSync("saved");
  refresh();
});
window.addEventListener("offline", () => setSync("offline"));
window.addEventListener("focus", () => refresh());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden) refresh();
}, 30_000);
async function init() {
  if (!client) {
    renderLogin();
    return;
  }
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      demo = false;
      user = null;
    }
    setTimeout(() => sessionChanged(session), 0);
  });
  const { data, error } = await client.auth.getSession();
  if (error) {
    renderLogin(errorMessage(error));
    return;
  }
  await sessionChanged(data.session);
}
init().catch((error) => renderLogin(errorMessage(error)));
