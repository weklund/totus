import crypto from "crypto";

/**
 * EncryptionProvider interface for envelope encryption.
 * Implementations must handle key management and data encryption.
 *
 * - Production: AWS KMS-based provider (GenerateDataKey / Decrypt)
 * - Local dev: LocalEncryptionProvider using ENCRYPTION_KEY env var
 */
export interface EncryptionProvider {
  /**
   * Encrypt plaintext data for a specific user.
   * Returns a Buffer in the envelope encryption wire format.
   */
  encrypt(plaintext: Buffer, userId: string): Promise<Buffer>;

  /**
   * Decrypt ciphertext data for a specific user.
   * Expects a Buffer in the envelope encryption wire format.
   */
  decrypt(ciphertext: Buffer, userId: string): Promise<Buffer>;
}

/**
 * Wire format constants.
 *
 * Format:
 *   [1 byte version 0x01]
 *   [4 bytes DEK length (big-endian uint32)]
 *   [N bytes encrypted DEK]
 *   [12 bytes nonce]
 *   [M bytes ciphertext]
 *   [16 bytes auth tag]
 */
const WIRE_FORMAT_VERSION = 0x01;
const VERSION_LENGTH = 1;
const DEK_LENGTH_FIELD_SIZE = 4;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_KEY_LENGTH = 32; // AES-256

/**
 * Local development encryption provider.
 *
 * Simulates KMS envelope encryption using a local master key.
 * The master key is derived from the ENCRYPTION_KEY environment variable.
 *
 * For each encrypt() call:
 * 1. Generate a random 32-byte DEK (Data Encryption Key)
 * 2. Encrypt the DEK using AES-256-GCM with the master key (simulating KMS)
 * 3. Encrypt the plaintext using AES-256-GCM with the DEK
 * 4. Assemble the wire format blob
 *
 * For each decrypt() call:
 * 1. Parse the wire format blob
 * 2. Decrypt the DEK using the master key
 * 3. Decrypt the plaintext using the DEK
 */
export class LocalEncryptionProvider implements EncryptionProvider {
  private readonly masterKey: Buffer;

  /**
   * @param hexKey - 32-byte key as a 64-character hex string
   */
  constructor(hexKey: string) {
    if (hexKey.length !== 64) {
      throw new Error(
        "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
          `Received ${hexKey.length} characters.`,
      );
    }

    if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
      throw new Error(
        "ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F).",
      );
    }

    this.masterKey = Buffer.from(hexKey, "hex");
  }

  async encrypt(plaintext: Buffer, _userId: string): Promise<Buffer> {
    // Step 1: Generate a random DEK
    const dek = crypto.randomBytes(DEK_KEY_LENGTH);

    // Step 2: Encrypt the DEK with the master key (simulating KMS envelope encryption)
    const dekNonce = crypto.randomBytes(NONCE_LENGTH);
    const dekCipher = crypto.createCipheriv(
      "aes-256-gcm",
      this.masterKey,
      dekNonce,
    );
    const dekEncrypted = Buffer.concat([
      dekCipher.update(dek),
      dekCipher.final(),
    ]);
    const dekAuthTag = dekCipher.getAuthTag();

    // Encrypted DEK = nonce(12) + encrypted_key(32) + tag(16) = 60 bytes
    const encryptedDek = Buffer.concat([dekNonce, dekEncrypted, dekAuthTag]);

    // Step 3: Encrypt the plaintext with the DEK
    const dataNonce = crypto.randomBytes(NONCE_LENGTH);
    const dataCipher = crypto.createCipheriv("aes-256-gcm", dek, dataNonce);
    const ciphertext = Buffer.concat([
      dataCipher.update(plaintext),
      dataCipher.final(),
    ]);
    const dataAuthTag = dataCipher.getAuthTag();

    // Step 4: Assemble the wire format
    const dekLengthBuf = Buffer.alloc(DEK_LENGTH_FIELD_SIZE);
    dekLengthBuf.writeUInt32BE(encryptedDek.length, 0);

    return Buffer.concat([
      Buffer.from([WIRE_FORMAT_VERSION]), // 1 byte version
      dekLengthBuf, // 4 bytes DEK length
      encryptedDek, // N bytes encrypted DEK
      dataNonce, // 12 bytes nonce
      ciphertext, // M bytes ciphertext
      dataAuthTag, // 16 bytes auth tag
    ]);
  }

  async decrypt(data: Buffer, _userId: string): Promise<Buffer> {
    // Minimum size: version(1) + dek_len(4) + at least 1 byte dek + nonce(12) + tag(16)
    const minSize =
      VERSION_LENGTH +
      DEK_LENGTH_FIELD_SIZE +
      1 +
      NONCE_LENGTH +
      AUTH_TAG_LENGTH;
    if (data.length < minSize) {
      throw new Error(
        `Encrypted data too short: expected at least ${minSize} bytes, got ${data.length}`,
      );
    }

    let offset = 0;

    // Step 1: Check version byte
    const version = data[offset]!;
    offset += VERSION_LENGTH;
    if (version !== WIRE_FORMAT_VERSION) {
      throw new Error(
        `Unsupported encryption format version: 0x${version.toString(16).padStart(2, "0")}. Expected 0x01.`,
      );
    }

    // Step 2: Read DEK length
    const dekLength = data.readUInt32BE(offset);
    offset += DEK_LENGTH_FIELD_SIZE;

    // Validate that we have enough data
    const expectedMinLength =
      VERSION_LENGTH +
      DEK_LENGTH_FIELD_SIZE +
      dekLength +
      NONCE_LENGTH +
      AUTH_TAG_LENGTH;
    if (data.length < expectedMinLength) {
      throw new Error(
        `Encrypted data truncated: expected at least ${expectedMinLength} bytes, got ${data.length}`,
      );
    }

    // Step 3: Extract and decrypt the DEK
    const encryptedDek = data.subarray(offset, offset + dekLength);
    offset += dekLength;

    const dek = this.decryptDek(encryptedDek);

    // Step 4: Extract nonce, ciphertext, and auth tag
    const dataNonce = data.subarray(offset, offset + NONCE_LENGTH);
    offset += NONCE_LENGTH;

    const ciphertextAndTag = data.subarray(offset);
    const ciphertext = ciphertextAndTag.subarray(
      0,
      ciphertextAndTag.length - AUTH_TAG_LENGTH,
    );
    const authTag = ciphertextAndTag.subarray(
      ciphertextAndTag.length - AUTH_TAG_LENGTH,
    );

    // Step 5: Decrypt the plaintext
    const decipher = crypto.createDecipheriv("aes-256-gcm", dek, dataNonce);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Decrypt the DEK using the master key.
   * The encrypted DEK format: [12 bytes nonce][32 bytes encrypted key][16 bytes auth tag]
   */
  private decryptDek(encryptedDek: Buffer): Buffer {
    const dekNonce = encryptedDek.subarray(0, NONCE_LENGTH);
    const dekCiphertext = encryptedDek.subarray(
      NONCE_LENGTH,
      encryptedDek.length - AUTH_TAG_LENGTH,
    );
    const dekAuthTag = encryptedDek.subarray(
      encryptedDek.length - AUTH_TAG_LENGTH,
    );

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.masterKey,
      dekNonce,
    );
    decipher.setAuthTag(dekAuthTag);

    return Buffer.concat([decipher.update(dekCiphertext), decipher.final()]);
  }
}

/**
 * Create an EncryptionProvider from the ENCRYPTION_KEY environment variable.
 * Throws if the environment variable is not set.
 */
export function createEncryptionProvider(): EncryptionProvider {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. " +
        "Set it in .env.local for local development (64-char hex string).",
    );
  }
  return new LocalEncryptionProvider(key);
}
