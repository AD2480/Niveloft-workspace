import { SCHEMA_VERSION, type MockDb } from './schema';
import { createSeedDb } from './seed';

export const MOCK_DB_STORAGE_KEY = 'projectflow.mockdb.v1';
const STORAGE_KEY = MOCK_DB_STORAGE_KEY;

let cache: MockDb | null = null;
let loading: Promise<MockDb> | null = null;
/**
 * Every save writes a new revision next to the data. The test API stands in for one server shared
 * by every tab, so a tab whose copy is older than the stored revision (another tab saved since)
 * reads the data again before answering.
 */
const REVISION_KEY = 'projectflow.mockdb.rev';
let cacheRevision: string | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Load the test API's database from localStorage, seeding sample data on first use. */
export async function getDb(): Promise<MockDb> {
  const s = storage();
  if (cache && s && !loading && s.getItem(REVISION_KEY) !== cacheRevision) cache = null; // another tab saved since
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      cacheRevision = storage()?.getItem(REVISION_KEY) ?? null;
      const raw = storage()?.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MockDb;
          if (parsed.schemaVersion === SCHEMA_VERSION) {
            cache = parsed;
            return parsed;
          }
        } catch {
          /* corrupted — reseed below */
        }
      }
      cache = await createSeedDb();
      saveDb();
      return cache;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

export function saveDb(): void {
  if (!cache) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded (usually large attachments). Drop stored file contents and retry once.
    for (const a of cache.attachments) a.dataUrl = null;
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      return; /* keep working in memory */
    }
  }
  try {
    cacheRevision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    s.setItem(REVISION_KEY, cacheRevision);
  } catch {
    /* the data was saved; other tabs re-read it on their storage event */
  }
}

/** Replace all data with a fresh copy of the sample seed. */
export async function resetDb(): Promise<void> {
  cache = await createSeedDb();
  saveDb();
}

/** For tests: use an explicit in-memory database. */
export function setDbForTesting(db: MockDb | null): void {
  cache = db;
}

/** Another tab changed the stored data: drop the in-memory copy so the next request re-reads it. */
export function forgetCachedDb(): void {
  cache = null;
}
