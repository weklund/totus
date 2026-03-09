import { describe, it, expect, beforeAll } from "vitest";

// We import the actual implementation (will be created next)
import {
  LocalEncryptionProvider,
  type EncryptionProvider,
} from "@/lib/encryption";

/**
 * Wire format specification:
 * [1 byte version 0x01]
 * [4 bytes DEK length (big-endian)]
 * [encrypted DEK (N bytes)]
 * [12 bytes nonce]
 * [ciphertext (M bytes)]
 * [16 bytes auth tag]
 */

const WIRE_FORMAT_VERSION = 0x01;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH_FIELD_SIZE = 4;

describe("EncryptionProvider interface", () => {
  let provider: EncryptionProvider;

  beforeAll(() => {
    // 32-byte hex-encoded key (64 hex chars)
    const testKey =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    provider = new LocalEncryptionProvider(testKey);
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("should encrypt and decrypt a simple string", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const userId = "user_test_001";

      const encrypted = await provider.encrypt(plaintext, userId);
      const decrypted = await provider.decrypt(encrypted, userId);

      expect(decrypted).toEqual(plaintext);
    });

    it("should encrypt and decrypt an empty buffer", async () => {
      const plaintext = Buffer.from("");
      const userId = "user_test_001";

      const encrypted = await provider.encrypt(plaintext, userId);
      const decrypted = await provider.decrypt(encrypted, userId);

      expect(decrypted).toEqual(plaintext);
    });

    it("should encrypt and decrypt a large payload", async () => {
      const plaintext = Buffer.from(JSON.stringify({ v: "x".repeat(10000) }));
      const userId = "user_test_001";

      const encrypted = await provider.encrypt(plaintext, userId);
      const decrypted = await provider.decrypt(encrypted, userId);

      expect(decrypted).toEqual(plaintext);
    });

    it("should encrypt and decrypt various JSON health data values", async () => {
      const testValues = [
        '{"v": 85}',
        '{"v": 42.5}',
        '{"v": 7.5, "u": "hr"}',
        '{"v": 0}',
        '{"v": -1.5}',
      ];

      for (const value of testValues) {
        const plaintext = Buffer.from(value);
        const userId = "user_test_001";

        const encrypted = await provider.encrypt(plaintext, userId);
        const decrypted = await provider.decrypt(encrypted, userId);

        expect(decrypted).toEqual(plaintext);
        expect(decrypted.toString()).toBe(value);
      }
    });

    it("should work with different user IDs", async () => {
      const plaintext = Buffer.from('{"v": 85}');

      const encrypted1 = await provider.encrypt(plaintext, "user_001");
      const decrypted1 = await provider.decrypt(encrypted1, "user_001");

      const encrypted2 = await provider.encrypt(plaintext, "user_002");
      const decrypted2 = await provider.decrypt(encrypted2, "user_002");

      expect(decrypted1).toEqual(plaintext);
      expect(decrypted2).toEqual(plaintext);
    });
  });

  describe("wire format structure", () => {
    it("should start with version byte 0x01", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      expect(encrypted[0]).toBe(WIRE_FORMAT_VERSION);
    });

    it("should have correct DEK length field at bytes 1-4", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      // Read DEK length from bytes 1-4 (big-endian uint32)
      const dekLength = encrypted.readUInt32BE(1);

      // DEK length should be reasonable (AES-256-GCM encrypted 32-byte key)
      // Encrypted DEK = nonce(12) + encrypted key(32) + tag(16) = 60 bytes
      expect(dekLength).toBeGreaterThan(0);
      expect(dekLength).toBeLessThan(1000); // Sanity check
    });

    it("should have correct structure: version + dek_len + dek + nonce + ciphertext + tag", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      // Parse the wire format
      let offset = 0;

      // Version byte
      const version = encrypted[offset];
      offset += 1;
      expect(version).toBe(WIRE_FORMAT_VERSION);

      // DEK length (4 bytes, big-endian)
      const dekLength = encrypted.readUInt32BE(offset);
      offset += DEK_LENGTH_FIELD_SIZE;

      // Encrypted DEK
      const encryptedDek = encrypted.subarray(offset, offset + dekLength);
      offset += dekLength;
      expect(encryptedDek.length).toBe(dekLength);

      // Nonce (12 bytes)
      const nonce = encrypted.subarray(offset, offset + NONCE_LENGTH);
      offset += NONCE_LENGTH;
      expect(nonce.length).toBe(NONCE_LENGTH);

      // Remaining = ciphertext + auth tag
      const remaining = encrypted.subarray(offset);
      expect(remaining.length).toBeGreaterThanOrEqual(AUTH_TAG_LENGTH);

      // Auth tag is the last 16 bytes
      const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_LENGTH);
      expect(authTag.length).toBe(AUTH_TAG_LENGTH);

      // Total size should be: 1 + 4 + dekLength + 12 + ciphertextLength + 16
      const ciphertextLength =
        encrypted.length -
        1 -
        DEK_LENGTH_FIELD_SIZE -
        dekLength -
        NONCE_LENGTH -
        AUTH_TAG_LENGTH;
      expect(ciphertextLength).toBeGreaterThanOrEqual(0);
    });

    it("should produce different ciphertexts for same plaintext (random nonce)", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const userId = "user_test";

      const encrypted1 = await provider.encrypt(plaintext, userId);
      const encrypted2 = await provider.encrypt(plaintext, userId);

      // The ciphertexts should be different due to random nonce and random DEK
      expect(encrypted1.equals(encrypted2)).toBe(false);
    });

    it("should produce different nonces for each encryption", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const userId = "user_test";

      const encrypted1 = await provider.encrypt(plaintext, userId);
      const encrypted2 = await provider.encrypt(plaintext, userId);

      // Extract nonces from both
      const dekLen1 = encrypted1.readUInt32BE(1);
      const nonce1 = encrypted1.subarray(
        1 + DEK_LENGTH_FIELD_SIZE + dekLen1,
        1 + DEK_LENGTH_FIELD_SIZE + dekLen1 + NONCE_LENGTH,
      );

      const dekLen2 = encrypted2.readUInt32BE(1);
      const nonce2 = encrypted2.subarray(
        1 + DEK_LENGTH_FIELD_SIZE + dekLen2,
        1 + DEK_LENGTH_FIELD_SIZE + dekLen2 + NONCE_LENGTH,
      );

      expect(nonce1.equals(nonce2)).toBe(false);
    });
  });

  describe("tamper detection", () => {
    it("should throw on tampered ciphertext (auth tag verification fails)", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      // Tamper with the ciphertext (modify a byte in the middle)
      const tampered = Buffer.from(encrypted);
      const midpoint = Math.floor(tampered.length / 2);
      tampered[midpoint] = tampered[midpoint]! ^ 0xff;

      await expect(provider.decrypt(tampered, "user_test")).rejects.toThrow();
    });

    it("should throw on tampered auth tag", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      // Tamper with the last byte (part of auth tag)
      const tampered = Buffer.from(encrypted);
      tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;

      await expect(provider.decrypt(tampered, "user_test")).rejects.toThrow();
    });

    it("should throw on tampered version byte", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      const tampered = Buffer.from(encrypted);
      tampered[0] = 0x02; // Wrong version

      await expect(provider.decrypt(tampered, "user_test")).rejects.toThrow();
    });

    it("should throw on truncated data", async () => {
      const plaintext = Buffer.from('{"v": 85}');
      const encrypted = await provider.encrypt(plaintext, "user_test");

      // Truncate to just the version byte
      const truncated = encrypted.subarray(0, 1);

      await expect(provider.decrypt(truncated, "user_test")).rejects.toThrow();
    });
  });

  describe("error handling", () => {
    it("should throw with invalid encryption key (wrong length)", () => {
      expect(() => new LocalEncryptionProvider("tooshort")).toThrow();
    });

    it("should throw with non-hex encryption key", () => {
      // 64 chars but not valid hex
      const badKey = "g".repeat(64);
      expect(() => new LocalEncryptionProvider(badKey)).toThrow();
    });

    it("should accept a valid 64-char hex key", () => {
      const validKey =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(() => new LocalEncryptionProvider(validKey)).not.toThrow();
    });
  });
});
