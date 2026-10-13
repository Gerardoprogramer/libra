import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";
import * as progress from "./reading-progress";
import type { CloudReadingProgress, SaveCloudReadingProgressInput } from "./reading-progress-cloud";

function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  compileFunction(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ["require", "exports"],
  )((name: string) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports as T;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const chapter = (number: number, bookSlug = "dracula", editionId = "edition-en") => ({
  bookSlug,
  editionId,
  chapterId: `chapter-${number}`,
  chapterSlug: `chapter-${number}`,
  chapterTitle: `Chapter ${number}`,
  chapterNumber: number,
  chapterIndex: number - 1,
  totalChapters: 10,
  contentLanguage: "en",
});
const user = (userId: string): progress.ReadingProgressScope => ({ type: "user", userId });
const guest: progress.ReadingProgressScope = { type: "guest" };
function setup() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      localStorage: {
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  });
  const reads: ReturnType<typeof deferred<CloudReadingProgress | null>>[] = [];
  const writes: {
    input: SaveCloudReadingProgressInput;
    userId: string;
    completion: ReturnType<typeof deferred<boolean>>;
  }[] = [];
  const cloud = {
    getCloudReadingProgress() {
      const result = deferred<CloudReadingProgress | null>();
      reads.push(result);
      return result.promise;
    },
    saveCloudReadingProgress(input: SaveCloudReadingProgressInput, userId: string) {
      const completion = deferred<boolean>();
      writes.push({ input, userId, completion });
      return completion.promise;
    },
  };
  const sync = loadModule<typeof import("./reading-progress-sync")>("./reading-progress-sync.ts", {
    "./reading-progress": progress,
    "./reading-progress-cloud": cloud,
  });
  const session = loadModule<typeof import("./reading-progress-session")>("./reading-progress-session.ts", {
    "./reading-progress": progress,
    "./reading-progress-cloud": cloud,
    "./reading-progress-sync": sync,
  });
  return { ...session, sync, values, reads, writes };
}
function cloudPosition(number: number): CloudReadingProgress {
  return {
    id: "progress",
    user_id: "A",
    edition_id: "edition-en",
    chapter_id: `chapter-${number}`,
    paragraph_index: 10,
    percentage: 40,
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

test("Next and Previous keep the requested chapter even when cloud still points elsewhere", async () => {
  for (const [target, saved] of [
    [2, 1],
    [1, 2],
  ]) {
    const h = setup();
    const restored: (progress.ReadingProgress | null)[] = [];
    const reader = h.createReadingSession(user("A"), chapter(target), (value) => restored.push(value), assert.fail);
    const started = reader.start();
    h.reads[0].resolve(cloudPosition(saved));
    await started;
    reader.dispose();
    assert.ok(restored.every((value) => value === null || value.chapterId === `chapter-${target}`));
    assert.equal(h.writes.at(-1)?.input.chapterId, `chapter-${target}`);
  }
});

test("late reads after explicit interaction or unmount cannot restore or write stale progress", async () => {
  for (const action of ["interact", "dispose"] as const) {
    const h = setup();
    const restored: (progress.ReadingProgress | null)[] = [];
    const reader = h.createReadingSession(user("A"), chapter(1), (value) => restored.push(value), assert.fail);
    const started = reader.start();
    reader[action]();
    h.reads[0].resolve(cloudPosition(1));
    await started;
    reader.dispose();
    assert.deepEqual(restored, [null]);
    assert.equal(h.writes.length, 0);
  }
});

test("guest navigation uses only guest storage and never reads or writes cloud", async () => {
  const h = setup();
  for (const number of [1, 2]) {
    const reader = h.createReadingSession(guest, chapter(number), () => {}, assert.fail);
    await reader.start();
    reader.record(20, 3);
    reader.dispose();
  }
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(
    progress.parseReadingProgress(progress.readScopedReadingProgress("dracula", guest, "edition-en"))?.chapterId,
    "chapter-2",
  );
});

test("a cloud read cannot overwrite a newer position saved by another reader or tab", async () => {
  const h = setup();
  const restored: (progress.ReadingProgress | null)[] = [];
  const reader = h.createReadingSession(user("A"), chapter(1), (value) => restored.push(value), assert.fail);
  const started = reader.start();
  progress.saveScopedReadingProgress(
    { ...chapter(2), percentage: 60, updatedAt: "2026-02-01T00:00:00.000Z" },
    user("A"),
  );
  h.reads[0].resolve(cloudPosition(1));
  await started;
  reader.dispose();
  assert.deepEqual(restored, [null]);
  assert.equal(
    progress.parseReadingProgress(progress.readScopedReadingProgress("dracula", user("A"), "edition-en"))?.chapterId,
    "chapter-2",
  );
});

test("A Dracula40 and B Frankenstein20 stay isolated from guests, each other, legacy and other editions", () => {
  const h = setup();
  const a = { ...chapter(1), percentage: 40, updatedAt: new Date().toISOString() };
  const b = { ...chapter(1, "frankenstein", "frankenstein-en"), percentage: 20, updatedAt: a.updatedAt };
  progress.saveReadingProgress(a);
  h.sync.replayPendingReadingProgress(user("B"));
  assert.equal(h.writes.length, 0);
  progress.saveScopedReadingProgress(a, user("A"));
  progress.saveScopedReadingProgress(b, user("B"));
  assert.deepEqual(progress.readAllScopedReadingProgress(guest), []);
  assert.equal(progress.readAllScopedReadingProgress(user("A"))?.length, 1);
  assert.equal(progress.readAllScopedReadingProgress(user("B"))?.length, 1);
  assert.equal(progress.readScopedReadingProgress("dracula", user("B"), "edition-en"), "");
  assert.equal(progress.readScopedReadingProgress("frankenstein", user("A"), "frankenstein-en"), "");
  assert.equal(progress.readScopedReadingProgress("dracula", user("A"), "edition-es"), "");
  progress.saveScopedReadingProgress({ ...a, editionId: "edition-es" }, user("A"));
  assert.equal(progress.readAllScopedReadingProgress(user("A"))?.length, 2);
});

test("unmount flushes the latest scroll; old acknowledgements cannot replace a newer chapter or change owner", async () => {
  const h = setup();
  const first = h.createReadingSession(user("A"), chapter(1), () => {}, assert.fail);
  first.record(40, 4);
  first.dispose();
  const next = h.createReadingSession(user("A"), chapter(2), () => {}, assert.fail);
  next.record(20, 2);
  next.dispose();
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes.every((write) => write.userId === "A"));
  h.writes[0].completion.resolve(true);
  await Promise.resolve();
  const cached = progress.parseReadingProgress(progress.readScopedReadingProgress("dracula", user("A"), "edition-en"));
  assert.equal(cached?.chapterId, "chapter-2");
  assert.equal(cached?.pendingSync, true);
  h.writes[1].completion.resolve(true);
  await Promise.resolve();
  assert.equal(
    progress.parseReadingProgress(progress.readScopedReadingProgress("dracula", user("A"), "edition-en"))?.pendingSync,
    false,
  );
});

test("only explicitly pending scoped writes replay to their original owner", () => {
  const h = setup();
  const value = {
    ...chapter(1),
    percentage: 40,
    paragraphIndex: 3,
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  };
  // The previous scoped, book-only key must not become an outbox even if polluted.
  h.values.set(progress.getScopedReadingProgressKey("dracula", user("B")), JSON.stringify(value));
  h.sync.replayPendingReadingProgress(user("B"));
  assert.equal(h.writes.length, 0);
  progress.saveScopedReadingProgress(value, user("A"));
  h.sync.replayPendingReadingProgress(user("B"));
  assert.equal(h.writes.length, 0);
  h.sync.replayPendingReadingProgress(user("A"));
  assert.equal(h.writes[0].userId, "A");
});
