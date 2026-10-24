import { describe, expect, it } from "vitest";

import {
  PAIRING_CODE_SPACE,
  PAIRING_SHAPES,
  PAIRING_TTL_SECONDS,
  createPairingRequestSchema,
  normalizePairingCode,
  pairingRecordSchema,
  redeemPairingRequestSchema,
} from "../src/drop-pairing.js";

const TRANSFER_CODE = "23456789ABCD";

describe("nearby drop pairing", () => {
  it("defines 40,000 human choices with a three-minute lifetime", () => {
    expect(PAIRING_CODE_SPACE * PAIRING_SHAPES.length).toBe(40_000);
    expect(PAIRING_TTL_SECONDS).toBe(180);
  });

  it("accepts a sender-selected shape and complete transfer code", () => {
    expect(
      createPairingRequestSchema.safeParse({
        protocolVersion: 1,
        shape: "star",
        transferCode: TRANSFER_CODE,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown shape and malformed transfer code", () => {
    expect(
      createPairingRequestSchema.safeParse({
        protocolVersion: 1,
        shape: "diamond",
        transferCode: TRANSFER_CODE,
      }).success,
    ).toBe(false);
    expect(
      createPairingRequestSchema.safeParse({
        protocolVersion: 1,
        shape: "star",
        transferCode: "TOO-SHORT",
      }).success,
    ).toBe(false);
  });

  it("lets redemption submit only a shape, never a replacement transfer code", () => {
    expect(
      redeemPairingRequestSchema.safeParse({ protocolVersion: 1, shape: "circle" }).success,
    ).toBe(true);
    expect(
      redeemPairingRequestSchema.safeParse({
        protocolVersion: 1,
        shape: "circle",
        transferCode: TRANSFER_CODE,
      }).success,
    ).toBe(false);
  });

  it("requires a live, strict pairing record", () => {
    const record = {
      protocolVersion: 1,
      code: "0712",
      shape: "square",
      transferCode: TRANSFER_CODE,
      createdAt: 1_000,
      expiresAt: 181_000,
    } as const;
    expect(pairingRecordSchema.safeParse(record).success).toBe(true);
    expect(pairingRecordSchema.safeParse({ ...record, expiresAt: 1_000 }).success).toBe(false);
    expect(pairingRecordSchema.safeParse({ ...record, senderPublicKey: "secret" }).success).toBe(
      false,
    );
  });

  it("normalizes spoken digits without accepting more than four", () => {
    expect(normalizePairingCode("712")).toBe("0712");
    expect(normalizePairingCode(" 4-2 1 9 ")).toBe("4219");
    expect(normalizePairingCode("123456")).toBe("1234");
  });
});
