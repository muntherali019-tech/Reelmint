import assert from "node:assert";
import { describe, it } from "node:test";
import { aiEnabled, aiStatus } from "../server/ai.js";

describe("AI Module", () => {
  describe("Status", () => {
    it("should report AI status", () => {
      const status = aiStatus();
      assert.ok(status.hasOwnProperty("enabled"), "Status should have enabled property");
      assert.ok(status.hasOwnProperty("model"), "Status should have model property");
    });

    it("should indicate demo mode when no API key", () => {
      const status = aiStatus();
      if (!aiEnabled) {
        assert.strictEqual(status.model, "demo", "Should be in demo mode when no API key");
      }
    });
  });
});
