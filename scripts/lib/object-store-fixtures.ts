import type { ObjectStore } from "./object-store";

// The object store double for tests, kept out of object-store.ts so no production module carries it. It stores in
// memory, can fail any operation, lose or damage an upload, and records every call. Never connected to anything.

interface MemoryObject {
  data: Buffer;
  contentType: string;
  cacheControl: string;
}

/**
 * An object store in memory, for tests: it can fail any operation, lose or damage an upload, and record every call.
 * Never connected to anything.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly description = "in-memory store (tests)";
  readonly objects = new Map<string, MemoryObject>();
  readonly calls: string[] = [];
  /** Faults, by operation: the keys (or "*") whose next calls throw, or uploads to lose or damage. */
  readonly fail = { head: new Set<string>(), get: new Set<string>(), put: new Set<string>() };
  readonly lose = new Set<string>();
  readonly damage = new Set<string>();

  private failing(operation: keyof MemoryObjectStore["fail"], key: string) {
    this.calls.push(`${operation} ${key}`);
    if (this.fail[operation].has(key) || this.fail[operation].has("*")) {
      throw new Error(`simulated ${operation} failure for ${key}`);
    }
  }

  async head(key: string) {
    this.failing("head", key);
    const object = this.objects.get(key);
    return object ? { size: object.data.length, contentType: object.contentType } : null;
  }

  async get(key: string) {
    this.failing("get", key);
    return this.objects.get(key)?.data ?? null;
  }

  async put(key: string, data: Buffer, { contentType, cacheControl }: { contentType: string; cacheControl: string }) {
    this.failing("put", key);
    if (this.lose.has(key)) return;
    const stored = Buffer.from(data);
    if (this.damage.has(key)) stored[stored.length - 1] ^= 0xff;
    this.objects.set(key, { data: stored, contentType, cacheControl });
  }
}
