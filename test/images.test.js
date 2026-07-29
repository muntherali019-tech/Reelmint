import assert from "node:assert";
import { describe, it } from "node:test";
import { imageProvider } from "../server/images.js";

describe("Images Module", () => {
  describe("Provider Detection", () => {
    it("should identify image provider", () => {
      const provider = imageProvider;
      assert.ok(["openai", "custom", "smartslide"].includes(provider), `Provider should be one of: openai, custom, smartslide. Got: ${provider}`);
    });

    it("should default to smartslide when no provider configured", () => {
      // When no IMAGE_PROVIDER or IMAGE_API_URL is set, should default to smartslide
      if (!process.env.IMAGE_PROVIDER && !process.env.IMAGE_API_URL) {
        assert.strictEqual(imageProvider, "smartslide", "Should default to smartslide");
      }
    });
  });
});
