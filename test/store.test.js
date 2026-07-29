import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { backend } from "../server/store.js";

describe("Store Module", () => {
  describe("Backend Detection", () => {
    it("should identify storage backend", () => {
      assert.ok(["postgres", "file"].includes(backend), `Backend should be postgres or file. Got: ${backend}`);
    });

    it("should use file backend when no DATABASE_URL", () => {
      if (!process.env.DATABASE_URL) {
        assert.strictEqual(backend, "file", "Should use file backend when DATABASE_URL not set");
      }
    });

    it("should use postgres backend when DATABASE_URL set", () => {
      if (process.env.DATABASE_URL) {
        assert.strictEqual(backend, "postgres", "Should use postgres backend when DATABASE_URL is set");
      }
    });
  });
});
