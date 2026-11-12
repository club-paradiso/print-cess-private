import { DIGEST_PATTERN, SESSION_ID_PATTERN } from "./canonical.js";
import { SYSTEM_MAX_PAGE_LIMIT } from "./print-quota.js";

export const MAX_PLAINTEXT_BYTES = 10 * 1024 * 1024;
/**
 * A single PDF cannot exceed what the kiosk can render at all, so this tracks
 * the technical ceiling rather than standing as a limit of its own. The number
 * a visitor actually meets is `PUBLIC_FREE_PAGE_LIMIT`, which lives in
 * `print-quota.ts` and is deliberately not this constant.
 */
export const MAX_PDF_PAGES = SYSTEM_MAX_PAGE_LIMIT;
/** Any print batch can hold up to thirty supported files, including mixed kinds. */
export const MAX_PRINT_BUNDLE_FILES = 30;
export const MAX_PRINT_BUNDLE_BYTES = 32 * 1024 * 1024;
export const ENVELOPE_FIXED_HEADER_BYTES = 26;
export const P256_PUBLIC_KEY_BYTES = 65;
export const HKDF_SALT_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const ENVELOPE_HEADER_BYTES =
  ENVELOPE_FIXED_HEADER_BYTES + P256_PUBLIC_KEY_BYTES + HKDF_SALT_BYTES + AES_GCM_IV_BYTES;
export const ENVELOPE_OVERHEAD_BYTES = ENVELOPE_HEADER_BYTES + AES_GCM_TAG_BYTES;
// A normal document still tops out at 10 MiB. Only the authenticated bundle
// container may use the larger payload budget, so adding batch printing does
// not quietly make single-document validation more permissive.
export const MAX_ENVELOPE_BYTES = MAX_PRINT_BUNDLE_BYTES + ENVELOPE_OVERHEAD_BYTES;
export const HKDF_INFO = "print-cess-by-paradiso:file:v1";

const MAGIC = new Uint8Array([0x50, 0x43, 0x45, 0x4e, 0x56, 0x30, 0x31, 0x00]);
const AAD_DOMAIN = new TextEncoder().encode("print-cess-by-paradiso:aad:v1");

export const FILE_KIND_CODES = {
  pdf: 1,
  jpeg: 2,
  png: 3,
  hwpx: 4,
  hwp: 5,
  bundle: 6,
} as const;

export type FileKind = keyof typeof FILE_KIND_CODES;
export type PrintableFileKind = Exclude<FileKind, "bundle">;

export type EnvelopeMetadata = {
  protocolVersion: 1;
  fileKind: FileKind;
  plaintextLength: number;
  ephemeralPublicKey: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
};

export type ParsedEnvelope = EnvelopeMetadata & {
  header: Uint8Array;
  ciphertextAndTag: Uint8Array;
};

export type AadContext = {
  protocolVersion: 1;
  sessionId: string;
  kioskPublicKeyFingerprint: string;
};

export function encodeEnvelopeHeader(metadata: EnvelopeMetadata): Uint8Array {
  validateMetadata(metadata);
  const ciphertextLength = metadata.plaintextLength + AES_GCM_TAG_BYTES;
  const headerLength = ENVELOPE_HEADER_BYTES;
  const header = new Uint8Array(headerLength);
  header.set(MAGIC, 0);
  const view = new DataView(header.buffer);
  view.setUint8(8, metadata.protocolVersion);
  view.setUint8(9, FILE_KIND_CODES[metadata.fileKind]);
  view.setUint16(10, 0, false);
  view.setUint16(12, P256_PUBLIC_KEY_BYTES, false);
  view.setUint8(14, HKDF_SALT_BYTES);
  view.setUint8(15, AES_GCM_IV_BYTES);
  view.setUint8(16, AES_GCM_TAG_BYTES);
  view.setUint8(17, 0);
  view.setUint32(18, metadata.plaintextLength, false);
  view.setUint32(22, ciphertextLength, false);
  let offset = ENVELOPE_FIXED_HEADER_BYTES;
  header.set(metadata.ephemeralPublicKey, offset);
  offset += P256_PUBLIC_KEY_BYTES;
  header.set(metadata.salt, offset);
  offset += HKDF_SALT_BYTES;
  header.set(metadata.iv, offset);
  return header;
}

export function assembleEnvelope(header: Uint8Array, ciphertextAndTag: Uint8Array): Uint8Array {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const expectedCiphertextLength = view.getUint32(22, false);
  if (ciphertextAndTag.byteLength !== expectedCiphertextLength) {
    throw new EnvelopeError("Ciphertext length does not match the authenticated header");
  }
  const envelope = new Uint8Array(header.byteLength + ciphertextAndTag.byteLength);
  envelope.set(header, 0);
  envelope.set(ciphertextAndTag, header.byteLength);
  return envelope;
}

export function parseEnvelope(envelope: Uint8Array): ParsedEnvelope {
  if (envelope.byteLength > MAX_ENVELOPE_BYTES) {
    throw new EnvelopeError("Envelope exceeds the maximum permitted size");
  }
  if (envelope.byteLength < ENVELOPE_FIXED_HEADER_BYTES) {
    throw new EnvelopeError("Envelope is truncated");
  }
  if (!bytesEqual(envelope.subarray(0, MAGIC.length), MAGIC)) {
    throw new EnvelopeError("Envelope magic is invalid");
  }
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const protocolVersion = view.getUint8(8);
  const kindCode = view.getUint8(9);
  const flags = view.getUint16(10, false);
  const publicKeyLength = view.getUint16(12, false);
  const saltLength = view.getUint8(14);
  const ivLength = view.getUint8(15);
  const tagLength = view.getUint8(16);
  const reserved = view.getUint8(17);
  const plaintextLength = view.getUint32(18, false);
  const ciphertextLength = view.getUint32(22, false);

  if (protocolVersion !== 1) throw new EnvelopeError("Unsupported protocol version");
  if (flags !== 0 || reserved !== 0) throw new EnvelopeError("Unsupported envelope flags");
  if (publicKeyLength !== P256_PUBLIC_KEY_BYTES) throw new EnvelopeError("Invalid public key size");
  if (saltLength !== HKDF_SALT_BYTES) throw new EnvelopeError("Invalid HKDF salt size");
  if (ivLength !== AES_GCM_IV_BYTES) throw new EnvelopeError("Invalid AES-GCM IV size");
  if (tagLength !== AES_GCM_TAG_BYTES) throw new EnvelopeError("Invalid AES-GCM tag size");

  const fileKind = fileKindFromCode(kindCode);
  if (plaintextLength < 1) throw new EnvelopeError("Plaintext must not be empty");
  if (plaintextLength > maximumPlaintextBytes(fileKind))
    throw new EnvelopeError("Plaintext is too large");
  if (ciphertextLength !== plaintextLength + AES_GCM_TAG_BYTES) {
    throw new EnvelopeError("Invalid ciphertext size");
  }

  const headerLength = ENVELOPE_FIXED_HEADER_BYTES + publicKeyLength + saltLength + ivLength;
  if (envelope.byteLength !== headerLength + ciphertextLength) {
    throw new EnvelopeError("Envelope length does not match the header");
  }

  let offset = ENVELOPE_FIXED_HEADER_BYTES;
  const ephemeralPublicKey = envelope.slice(offset, offset + publicKeyLength);
  if (ephemeralPublicKey[0] !== 0x04) {
    throw new EnvelopeError("P-256 public key must be uncompressed SEC1 format");
  }
  offset += publicKeyLength;
  const salt = envelope.slice(offset, offset + saltLength);
  offset += saltLength;
  const iv = envelope.slice(offset, offset + ivLength);
  return {
    protocolVersion: 1,
    fileKind,
    plaintextLength,
    ephemeralPublicKey,
    salt,
    iv,
    header: envelope.slice(0, headerLength),
    ciphertextAndTag: envelope.slice(headerLength),
  };
}

export function buildAad(context: AadContext, envelopeHeader: Uint8Array): Uint8Array {
  if (context.protocolVersion !== 1) throw new EnvelopeError("Unsupported AAD protocol version");
  if (!SESSION_ID_PATTERN.test(context.sessionId)) {
    throw new EnvelopeError("Session ID must be canonical 16-byte base64url");
  }
  if (!DIGEST_PATTERN.test(context.kioskPublicKeyFingerprint)) {
    throw new EnvelopeError("Fingerprint must be canonical SHA-256 base64url");
  }
  const sessionId = new TextEncoder().encode(context.sessionId);
  const fingerprint = new TextEncoder().encode(context.kioskPublicKeyFingerprint);
  const output = new Uint8Array(
    AAD_DOMAIN.byteLength +
      1 +
      1 +
      sessionId.byteLength +
      1 +
      fingerprint.byteLength +
      envelopeHeader.byteLength,
  );
  let offset = 0;
  output.set(AAD_DOMAIN, offset);
  offset += AAD_DOMAIN.byteLength;
  output[offset++] = context.protocolVersion;
  output[offset++] = sessionId.byteLength;
  output.set(sessionId, offset);
  offset += sessionId.byteLength;
  output[offset++] = fingerprint.byteLength;
  output.set(fingerprint, offset);
  offset += fingerprint.byteLength;
  output.set(envelopeHeader, offset);
  return output;
}

function validateMetadata(metadata: EnvelopeMetadata): void {
  if (metadata.protocolVersion !== 1) throw new EnvelopeError("Unsupported protocol version");
  if (!Number.isInteger(metadata.plaintextLength) || metadata.plaintextLength < 1) {
    throw new EnvelopeError("Invalid plaintext length");
  }
  if (metadata.plaintextLength > maximumPlaintextBytes(metadata.fileKind))
    throw new EnvelopeError("Plaintext is too large");
  if (metadata.ephemeralPublicKey.byteLength !== P256_PUBLIC_KEY_BYTES) {
    throw new EnvelopeError("Invalid public key size");
  }
  if (metadata.ephemeralPublicKey[0] !== 0x04) {
    throw new EnvelopeError("P-256 public key must be uncompressed SEC1 format");
  }
  if (metadata.salt.byteLength !== HKDF_SALT_BYTES) throw new EnvelopeError("Invalid salt size");
  if (metadata.iv.byteLength !== AES_GCM_IV_BYTES) throw new EnvelopeError("Invalid IV size");
}

export function fileKindFromCode(code: number): FileKind {
  for (const [kind, value] of Object.entries(FILE_KIND_CODES)) {
    if (value === code) return kind as FileKind;
  }
  throw new EnvelopeError("Unsupported file kind");
}

function maximumPlaintextBytes(kind: FileKind): number {
  return kind === "bundle" ? MAX_PRINT_BUNDLE_BYTES : MAX_PLAINTEXT_BYTES;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export class EnvelopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}
