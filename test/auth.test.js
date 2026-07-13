import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { makeToken, verifyToken, hashPassword, verifyPassword } from "../server/auth.js";

describe("Auth Module", () => {
  describe("Token Management", () => {
    it("should create and verify valid tokens", () => {
      const userId = "test-user-123";
      const token = makeToken(userId);
      const verified = verifyToken(token);
      assert.strictEqual(verified, userId, "Token should verify to original userId");
    });

    it("should reject invalid token format", () => {
      const result = verifyToken("invalid.token");
      assert.strictEqual(result, null, "Invalid token should return null");
    });

    it("should reject malformed tokens", () => {
      const result = verifyToken("not-a-token");
      assert.strictEqual(result, null, "Malformed token should return null");
    });
  });

  describe("Password Hashing", () => {
    it("should hash passwords", () => {
      const password = "test-password-123";
      const hashed = hashPassword(password);
      assert.ok(hashed.includes(":"), "Hashed password should contain salt:hash format");
      assert.notStrictEqual(hashed, password, "Hashed password should not equal original");
    });

    it("should verify correct passwords", () => {
      const password = "secure-pass-456";
      const hashed = hashPassword(password);
      const verified = verifyPassword(password, hashed);
      assert.strictEqual(verified, true, "Correct password should verify");
    });

    it("should reject incorrect passwords", () => {
      const password = "secure-pass-456";
      const hashed = hashPassword(password);
      const verified = verifyPassword("wrong-password", hashed);
      assert.strictEqual(verified, false, "Incorrect password should not verify");
    });
  });
});
