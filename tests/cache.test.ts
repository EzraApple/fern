import { describe, it, expect, beforeEach, vi } from "vitest";
import { cacheGet, cacheSet, cacheDelete, cleanupExpiredEntries } from "@/services/cache.js";

describe("Cache Service", () => {
  beforeEach(async () => {
    // Clear any existing entries by deleting known keys
    await cacheDelete("test-key");
    await cacheDelete("key1");
    await cacheDelete("key2");
    await cacheDelete("expired-key");
    await cacheDelete("not-expired-key");
  });

  describe("cacheSet and cacheGet", () => {
    it("should store and retrieve a string value", async () => {
      await cacheSet("test-key", "test-value");
      const result = await cacheGet<string>("test-key");
      expect(result).toBe("test-value");
    });

    it("should store and retrieve an object value", async () => {
      const testObj = { name: "test", count: 42, nested: { value: true } };
      await cacheSet("test-key", testObj);
      const result = await cacheGet<typeof testObj>("test-key");
      expect(result).toEqual(testObj);
    });

    it("should store and retrieve an array value", async () => {
      const testArr = [1, 2, 3, "four", { five: 5 }];
      await cacheSet("test-key", testArr);
      const result = await cacheGet<typeof testArr>("test-key");
      expect(result).toEqual(testArr);
    });

    it("should return null for non-existent key", async () => {
      const result = await cacheGet("non-existent-key");
      expect(result).toBeNull();
    });

    it("should overwrite existing value with same key", async () => {
      await cacheSet("test-key", "first-value");
      await cacheSet("test-key", "second-value");
      const result = await cacheGet<string>("test-key");
      expect(result).toBe("second-value");
    });
  });

  describe("cacheDelete", () => {
    it("should delete an existing key", async () => {
      await cacheSet("test-key", "test-value");
      await cacheDelete("test-key");
      const result = await cacheGet("test-key");
      expect(result).toBeNull();
    });

    it("should handle deleting non-existent key gracefully", async () => {
      await expect(cacheDelete("non-existent-key")).resolves.not.toThrow();
    });
  });

  describe("TTL expiration", () => {
    it("should return null for expired entries", async () => {
      vi.useFakeTimers();

      await cacheSet("test-key", "test-value", 1); // 1 second TTL

      // Value should exist initially
      let result = await cacheGet<string>("test-key");
      expect(result).toBe("test-value");

      // Advance time past expiration
      vi.advanceTimersByTime(2000); // 2 seconds

      // Value should be expired now
      result = await cacheGet<string>("test-key");
      expect(result).toBeNull();

      vi.useRealTimers();
    });

    it("should respect custom TTL", async () => {
      vi.useFakeTimers();

      await cacheSet("test-key", "test-value", 10); // 10 second TTL

      // Advance 5 seconds - should still exist
      vi.advanceTimersByTime(5000);
      let result = await cacheGet<string>("test-key");
      expect(result).toBe("test-value");

      // Advance 6 more seconds (11 total) - should be expired
      vi.advanceTimersByTime(6000);
      result = await cacheGet<string>("test-key");
      expect(result).toBeNull();

      vi.useRealTimers();
    });

    it("should use default TTL of 3600 seconds", async () => {
      vi.useFakeTimers();

      await cacheSet("test-key", "test-value"); // Default TTL

      // Advance 30 minutes - should still exist
      vi.advanceTimersByTime(30 * 60 * 1000);
      let result = await cacheGet<string>("test-key");
      expect(result).toBe("test-value");

      // Advance 31 more minutes (61 total) - should be expired
      vi.advanceTimersByTime(31 * 60 * 1000);
      result = await cacheGet<string>("test-key");
      expect(result).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("cleanupExpiredEntries", () => {
    it("should remove expired entries", async () => {
      vi.useFakeTimers();

      await cacheSet("expired-key", "expired-value", 1);
      await cacheSet("not-expired-key", "valid-value", 100);

      // Advance time to expire first key
      vi.advanceTimersByTime(2000);

      // Run cleanup
      cleanupExpiredEntries();

      // Expired key should be gone
      const expired = await cacheGet("expired-key");
      expect(expired).toBeNull();

      // Valid key should still exist
      const valid = await cacheGet<string>("not-expired-key");
      expect(valid).toBe("valid-value");

      vi.useRealTimers();
    });

    it("should handle empty cache gracefully", () => {
      expect(() => cleanupExpiredEntries()).not.toThrow();
    });
  });

  describe("concurrent operations", () => {
    it("should handle multiple simultaneous sets", async () => {
      const promises = [
        cacheSet("key1", "value1"),
        cacheSet("key2", "value2"),
      ];

      await Promise.all(promises);

      const result1 = await cacheGet<string>("key1");
      const result2 = await cacheGet<string>("key2");

      expect(result1).toBe("value1");
      expect(result2).toBe("value2");
    });
  });
});
