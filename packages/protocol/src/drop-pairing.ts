import { z } from "zod";

import { DROP_CODE_PATTERN } from "./drop.js";

/**
 * A short-lived convenience hand-off for people standing together. The sender
 * chooses one of four shapes and the receiver enters four digits plus that
 * shape. This is deliberately simpler than the drop's cryptographic protocol:
 * the service escrows the transfer code for at most three minutes, so this
 * optional path trades server blindness for allowing the sender to leave once
 * the upload is complete. QR and shared-link hand-offs remain end-to-end
 * encrypted and never send the transfer code to the service.
 */
export const DROP_PAIRING_PROTOCOL_VERSION = 1 as const;

export const PAIRING_CODE_LENGTH = 4;
export const PAIRING_CODE_PATTERN = /^[0-9]{4}$/u;
export const PAIRING_CODE_SPACE = 10_000;

export const PAIRING_SHAPES = ["circle", "triangle", "square", "star"] as const;
export type PairingShape = (typeof PAIRING_SHAPES)[number];

/** Three minutes, then the escrow disappears. */
export const PAIRING_TTL_SECONDS = 180;

/**
 * Shape choices a receiver gets for one code. A mis-tap is forgiven once; the
 * second wrong shape deletes the escrow, so guessing a live code still gives a
 * stranger at most half of the shapes.
 */
export const PAIRING_SHAPE_TRIES = 2;

export const pairingRecordSchema = z
  .object({
    protocolVersion: z.literal(DROP_PAIRING_PROTOCOL_VERSION),
    code: z.string().regex(PAIRING_CODE_PATTERN),
    shape: z.enum(PAIRING_SHAPES),
    transferCode: z.string().regex(DROP_CODE_PATTERN),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    /** Wrong shapes so far; absent until the first one. */
    misses: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((pairing) => pairing.expiresAt > pairing.createdAt, {
    message: "Pairing expiry must be later than creation.",
    path: ["expiresAt"],
  });

export type PairingRecord = z.infer<typeof pairingRecordSchema>;

export const createPairingRequestSchema = z
  .object({
    protocolVersion: z.literal(DROP_PAIRING_PROTOCOL_VERSION),
    shape: z.enum(PAIRING_SHAPES),
    transferCode: z.string().regex(DROP_CODE_PATTERN),
  })
  .strict();

export const redeemPairingRequestSchema = z
  .object({
    protocolVersion: z.literal(DROP_PAIRING_PROTOCOL_VERSION),
    shape: z.enum(PAIRING_SHAPES),
  })
  .strict();

export type PairingReceiverView = {
  protocolVersion: typeof DROP_PAIRING_PROTOCOL_VERSION;
  transferCode: string;
  expiresAt: number;
};

export function formatPairingCode(code: string): string {
  return code.padStart(PAIRING_CODE_LENGTH, "0");
}

/** Accepts what a person actually types: spaces and a single leading digit. */
export function normalizePairingCode(input: string): string {
  const digits = input.replace(/[^0-9]/gu, "").slice(0, PAIRING_CODE_LENGTH);
  return digits.length === PAIRING_CODE_LENGTH ? digits : digits.padStart(PAIRING_CODE_LENGTH, "0");
}
