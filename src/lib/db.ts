/**
 * Pomocniki do pracy z Cloudflare D1.
 * Binding "DB" dostępny przez Astro.locals.runtime.env.DB.
 */

export type DB = D1Database;

/** Zwraca instancję D1 z locals. Rzuca gdy binding nie jest dostępny. */
export function getDB(locals: App.Locals): DB {
  const db = locals.runtime?.env?.DB;
  if (!db) throw new Error("Binding D1 'DB' nie jest dostępny. Sprawdź platformProxy w astro.config.mjs i wrangler.toml.");
  return db;
}

/**
 * Wykonuje INSERT/UPDATE/DELETE i zwraca D1Result.
 * Rzuca z komunikatem zawierającym fragment zapytania (bez danych wrażliwych).
 */
export async function dbRun(
  db: DB,
  query: string,
  params: unknown[] = []
): Promise<D1Result> {
  try {
    return await db.prepare(query).bind(...params).run();
  } catch (err) {
    const preview = query.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`D1 run error [${preview}]: ${String(err)}`);
  }
}

/** Wykonuje SELECT i zwraca wszystkie wiersze jako T[]. */
export async function dbAll<T = Record<string, unknown>>(
  db: DB,
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await db.prepare(query).bind(...params).all<T>();
    return result.results;
  } catch (err) {
    const preview = query.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`D1 all error [${preview}]: ${String(err)}`);
  }
}

/** Wykonuje SELECT i zwraca pierwszy wiersz lub null. */
export async function dbFirst<T = Record<string, unknown>>(
  db: DB,
  query: string,
  params: unknown[] = []
): Promise<T | null> {
  try {
    return await db.prepare(query).bind(...params).first<T>() ?? null;
  } catch (err) {
    const preview = query.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`D1 first error [${preview}]: ${String(err)}`);
  }
}

/**
 * Wykonuje wiele prepared statements w jednej transakcji batch().
 * Wydajniejsze niż pętla dbRun przy wgrywaniu wielu wierszy naraz.
 */
export async function dbBatch(
  db: DB,
  statements: D1PreparedStatement[]
): Promise<D1Result[]> {
  try {
    return await db.batch(statements);
  } catch (err) {
    throw new Error(`D1 batch error (${statements.length} stmt): ${String(err)}`);
  }
}
