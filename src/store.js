import { createClient } from "@supabase/supabase-js";
import { emptyDB, validateDB } from "./domain.js";
import { publicConfig } from "./config.js";

const url = import.meta.env.VITE_SUPABASE_URL ?? publicConfig.url;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? publicConfig.publishableKey;
export const configured = !!(
  url?.startsWith("https://") &&
  key &&
  !url.includes("YOUR_PROJECT") &&
  !key.includes("YOUR_KEY")
);
export const client = configured
  ? createClient(url, key, {
      auth: {
        storageKey: "esencia-costes-auth-v2",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
export class ConflictError extends Error {
  constructor() {
    super(
      "Hay cambios guardados desde otro dispositivo. Tu borrador sigue abierto. Descárgalo antes de cargar la versión de la nube.",
    );
    this.name = "ConflictError";
  }
}
export async function readDocument(userId) {
  const { data, error } = await client
    .from("esencia_costes_documents")
    .select("document, revision, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      "ESENCIA_ACCESS: Esta cuenta no tiene un cuaderno habilitado.",
    );
  return {
    db: validateDB(data.document),
    revision: data.revision,
    updatedAt: data.updated_at,
  };
}
export async function writeDocument(db, revision) {
  const valid = validateDB(db);
  const { data, error } = await client.rpc("esencia_costes_save", {
    p_document: valid,
    p_expected_revision: revision,
  });
  if (error) {
    if (error.message?.includes("ESENCIA_CONFLICT")) throw new ConflictError();
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row)
    throw new Error(
      "No se ha recibido confirmación del guardado. Comprueba la conexión.",
    );
  return {
    db: validateDB(row.document),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
