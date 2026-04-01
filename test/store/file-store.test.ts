import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../../src/store/file-store.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "file-store-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileStore", () => {
  describe("round-trip persistence", () => {
    it("persists items and loads them in a new instance", async () => {
      const store1 = await FileStore.create({ dir });
      await store1.put(["user", "patterns"], "sleep-time", { content: "goes to bed at 11pm" });
      await store1.put(["user", "patterns"], "wake-time", { content: "wakes at 7am" });

      const store2 = await FileStore.create({ dir });
      const item = await store2.get(["user", "patterns"], "sleep-time");
      expect(item).not.toBeNull();
      expect(item!.value.content).toBe("goes to bed at 11pm");

      const item2 = await store2.get(["user", "patterns"], "wake-time");
      expect(item2).not.toBeNull();
      expect(item2!.value.content).toBe("wakes at 7am");
    });

    it("restores Date fields as Date objects", async () => {
      const store1 = await FileStore.create({ dir });
      await store1.put(["ns"], "key1", { val: 1 });

      const store2 = await FileStore.create({ dir });
      const item = await store2.get(["ns"], "key1");
      expect(item!.createdAt).toBeInstanceOf(Date);
      expect(item!.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("search with namespace prefix", () => {
    it("finds items under exact namespace", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["other"], "item2", { x: 2 });

      const results = await store.search(["user", "patterns"]);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe("item1");
    });

    it("finds items under parent namespace prefix", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["user", "prefs"], "item2", { x: 2 });
      await store.put(["other"], "item3", { x: 3 });

      const results = await store.search(["user"]);
      expect(results).toHaveLength(2);
      const keys = results.map((r: { key: string }) => r.key).sort();
      expect(keys).toEqual(["item1", "item2"]);
    });

    it("does not find items in unrelated namespace", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });

      const results = await store.search(["other"]);
      expect(results).toHaveLength(0);
    });

    it("empty prefix matches all items", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["other"], "item2", { x: 2 });

      const results = await store.search([]);
      expect(results).toHaveLength(2);
    });
  });

  describe("search with value filters", () => {
    it("filters by exact value field match", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["memories"], "m1", { category: "sleep", content: "sleeps well" });
      await store.put(["memories"], "m2", { category: "exercise", content: "runs daily" });
      await store.put(["memories"], "m3", { category: "sleep", content: "takes naps" });

      const results = await store.search(["memories"], { filter: { category: "sleep" } });
      expect(results).toHaveLength(2);
      const contents = results.map((r: { value: Record<string, unknown> }) => r.value.content).sort();
      expect(contents).toEqual(["sleeps well", "takes naps"]);
    });

    it("returns nothing when filter matches no items", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["memories"], "m1", { category: "sleep" });

      const results = await store.search(["memories"], { filter: { category: "food" } });
      expect(results).toHaveLength(0);
    });
  });

  describe("search limit/offset pagination", () => {
    it("limits results", async () => {
      const store = await FileStore.create({ dir });
      for (let i = 0; i < 5; i++) {
        await store.put(["ns"], `item${i}`, { i });
      }

      const results = await store.search(["ns"], { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("applies offset", async () => {
      const store = await FileStore.create({ dir });
      for (let i = 0; i < 5; i++) {
        await store.put(["ns"], `item${i}`, { i });
      }

      const all = await store.search(["ns"], { limit: 5 });
      const paged = await store.search(["ns"], { limit: 5, offset: 2 });
      expect(paged).toHaveLength(3);
      expect(paged[0].key).toBe(all[2].key);
    });

    it("default limit is 10", async () => {
      const store = await FileStore.create({ dir });
      for (let i = 0; i < 15; i++) {
        await store.put(["ns"], `item${i}`, { i });
      }

      const results = await store.search(["ns"]);
      expect(results).toHaveLength(10);
    });
  });

  describe("delete", () => {
    it("deletes an item and verifies it is gone", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["ns"], "key1", { val: "hello" });
      expect(await store.get(["ns"], "key1")).not.toBeNull();

      await store.delete(["ns"], "key1");
      expect(await store.get(["ns"], "key1")).toBeNull();
    });

    it("persists deletion across new store instances", async () => {
      const store1 = await FileStore.create({ dir });
      await store1.put(["ns"], "key1", { val: "hello" });
      await store1.delete(["ns"], "key1");

      const store2 = await FileStore.create({ dir });
      expect(await store2.get(["ns"], "key1")).toBeNull();
    });
  });

  describe("missing file", () => {
    it("starts fresh with no crash when store.json does not exist", async () => {
      const store = await FileStore.create({ dir });
      const results = await store.search([]);
      expect(results).toHaveLength(0);
    });
  });

  describe("corrupt file", () => {
    it("starts fresh with a console.warn when store.json has invalid JSON", async () => {
      const storeFile = join(dir, "store.json");
      await Bun.write(storeFile, "{ this is not valid json [[[");

      const warnSpy = spyOn(console, "warn");
      const store = await FileStore.create({ dir });
      expect(warnSpy).toHaveBeenCalled();

      const results = await store.search([]);
      expect(results).toHaveLength(0);

      warnSpy.mockRestore();
    });
  });

  describe("listNamespaces", () => {
    it("returns unique namespace paths", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["user", "patterns"], "item2", { x: 2 });
      await store.put(["user", "prefs"], "item3", { x: 3 });
      await store.put(["other"], "item4", { x: 4 });

      const namespaces = await store.listNamespaces({});
      expect(namespaces).toHaveLength(3);
      const nsStrings = namespaces.map((ns: string[]) => ns.join(":")).sort();
      expect(nsStrings).toEqual(["other", "user:patterns", "user:prefs"]);
    });

    it("filters by prefix", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["user", "prefs"], "item2", { x: 2 });
      await store.put(["other"], "item3", { x: 3 });

      const namespaces = await store.listNamespaces({ prefix: ["user"] });
      expect(namespaces).toHaveLength(2);
      const nsStrings = namespaces.map((ns: string[]) => ns.join(":")).sort();
      expect(nsStrings).toEqual(["user:patterns", "user:prefs"]);
    });

    it("filters by suffix", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["user", "patterns"], "item1", { x: 1 });
      await store.put(["user", "prefs"], "item2", { x: 2 });
      await store.put(["bot", "patterns"], "item3", { x: 3 });

      const namespaces = await store.listNamespaces({ suffix: ["patterns"] });
      expect(namespaces).toHaveLength(2);
      const nsStrings = namespaces.map((ns: string[]) => ns.join(":")).sort();
      expect(nsStrings).toEqual(["bot:patterns", "user:patterns"]);
    });
  });

  describe("put updates existing item", () => {
    it("updates value and updatedAt but keeps createdAt", async () => {
      const store = await FileStore.create({ dir });
      await store.put(["ns"], "key1", { version: 1 });
      const item1 = await store.get(["ns"], "key1");
      expect(item1!.value.version).toBe(1);
      const originalCreatedAt = item1!.createdAt.getTime();
      const originalUpdatedAt = item1!.updatedAt.getTime();

      // Small delay to ensure updatedAt differs
      await Bun.sleep(10);

      await store.put(["ns"], "key1", { version: 2 });
      const item2 = await store.get(["ns"], "key1");
      expect(item2!.value.version).toBe(2);
      expect(item2!.createdAt.getTime()).toBe(originalCreatedAt);
      expect(item2!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
    });
  });
});
