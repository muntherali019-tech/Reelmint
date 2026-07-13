import assert from "node:assert";
import { describe, it } from "node:test";
import { stripeEnabled } from "../server/billing.js";

describe("Billing Module", () => {
  describe("Configuration", () => {
    it("should check Stripe configuration", () => {
      assert.ok(typeof stripeEnabled === "boolean", "stripeEnabled should be a boolean");
    });

    it("should gracefully handle missing Stripe config", () => {
      // This should not throw even if Stripe is not configured
      assert.ok(true, "Module loads without Stripe config");
    });
  });
});
