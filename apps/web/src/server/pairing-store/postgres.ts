import { pairingRecordSchema, type PairingRecord } from "@print-cess/protocol";

import type { PairingStore } from "../contracts";
import { createPostgresExecutor, type PostgresExecutor } from "../session-store/postgres-client";
import {
  guessShape,
  missWindowStart,
  PAIRING_MISS_WINDOW_MS,
  pairingNotFound,
  requireLive,
} from "./transitions";

const TABLE_NAME = "print_cess_pairing_state_v1";
const MISS_TABLE_NAME = "print_cess_pairing_miss_v1";

type PairingRow = { pairing: unknown; expires_at: string | number };

export class RailwayPostgresPairingStore implements PairingStore {
  readonly #executor: PostgresExecutor;
  #schema: Promise<void> | null = null;

  public constructor(executor: PostgresExecutor = createPostgresExecutor()) {
    this.#executor = executor;
  }

  public async claim(
    pairing: Omit<PairingRecord, "code">,
    candidates: readonly string[],
  ): Promise<PairingRecord | null> {
    await this.ensureSchema();
    await this.#executor.query(`DELETE FROM ${TABLE_NAME} WHERE expires_at <= $1`, [
      pairing.createdAt,
    ]);
    for (const code of candidates) {
      const record: PairingRecord = { ...pairing, code };
      const result = await this.#executor.query(
        `
        INSERT INTO ${TABLE_NAME} (code, pairing, expires_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (code) DO UPDATE
          SET pairing = EXCLUDED.pairing,
              expires_at = EXCLUDED.expires_at,
              updated_at = NOW()
          WHERE ${TABLE_NAME}.expires_at <= $4
        `,
        [code, JSON.stringify(record), pairing.expiresAt, pairing.createdAt],
      );
      if (result.rowCount === 1) return record;
    }
    return null;
  }

  public async get(code: string): Promise<PairingRecord | null> {
    await this.ensureSchema();
    const now = Date.now();
    await this.#executor.query(`DELETE FROM ${TABLE_NAME} WHERE code = $1 AND expires_at <= $2`, [
      code,
      now,
    ]);
    const result = await this.#executor.query<PairingRow>(
      `SELECT pairing, expires_at FROM ${TABLE_NAME} WHERE code = $1`,
      [code],
    );
    const row = result.rows[0];
    if (!row) return null;
    return parsePairing(row.pairing);
  }

  public async redeem(
    code: string,
    shape: PairingRecord["shape"],
    now: number,
  ): Promise<PairingRecord> {
    await this.ensureSchema();
    // The transaction commits the miss count or deletion; the error is thrown
    // only after it, so a wrong shape is never rolled back.
    const matched = await this.#executor.transaction(`pairing:${code}`, async (client) => {
      const result = await client.query<PairingRow>(
        `SELECT pairing, expires_at FROM ${TABLE_NAME} WHERE code = $1 FOR UPDATE`,
        [code],
      );
      const row = result.rows[0];
      if (!row) return null;
      const stored = parsePairing(row.pairing);
      const guess = stored.expiresAt <= now ? null : guessShape(stored, shape);
      if (guess?.outcome === "miss" && guess.remaining) {
        await client.query(`UPDATE ${TABLE_NAME} SET pairing = $2::jsonb WHERE code = $1`, [
          code,
          JSON.stringify(guess.remaining),
        ]);
        return null;
      }
      await client.query(`DELETE FROM ${TABLE_NAME} WHERE code = $1`, [code]);
      return guess?.outcome === "match" ? stored : null;
    });
    return requireLive(matched, now);
  }

  public async recordMiss(now: number): Promise<void> {
    await this.ensureSchema();
    await this.#executor.query(
      `
      INSERT INTO ${MISS_TABLE_NAME} (window_start, misses)
      VALUES ($1, 1)
      ON CONFLICT (window_start) DO UPDATE
        SET misses = ${MISS_TABLE_NAME}.misses + 1
      `,
      [missWindowStart(now)],
    );
  }

  public async recentMisses(now: number): Promise<number> {
    await this.ensureSchema();
    const result = await this.#executor.query<{ misses: string | number }>(
      `SELECT misses FROM ${MISS_TABLE_NAME} WHERE window_start = $1`,
      [missWindowStart(now)],
    );
    return Number(result.rows[0]?.misses ?? 0);
  }

  public async remove(code: string): Promise<void> {
    await this.ensureSchema();
    await this.#executor.query(`DELETE FROM ${TABLE_NAME} WHERE code = $1`, [code]);
  }

  public async pruneExpired(now: number): Promise<void> {
    await this.ensureSchema();
    await this.#executor.query(`DELETE FROM ${TABLE_NAME} WHERE expires_at <= $1`, [now]);
    await this.#executor.query(`DELETE FROM ${MISS_TABLE_NAME} WHERE window_start < $1`, [
      missWindowStart(now) - PAIRING_MISS_WINDOW_MS,
    ]);
  }

  private async ensureSchema(): Promise<void> {
    this.#schema ??= (async () => {
      await this.#executor.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          code TEXT PRIMARY KEY,
          pairing JSONB NOT NULL,
          expires_at BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.#executor.query(`
        CREATE TABLE IF NOT EXISTS ${MISS_TABLE_NAME} (
          window_start BIGINT PRIMARY KEY,
          misses INTEGER NOT NULL
        )
      `);
    })().catch((error: unknown) => {
      this.#schema = null;
      throw error;
    });
    return this.#schema;
  }
}

function parsePairing(value: unknown): PairingRecord {
  const decoded = typeof value === "string" ? JSON.parse(value) : value;
  const parsed = pairingRecordSchema.safeParse(decoded);
  if (!parsed.success) throw pairingNotFound();
  return parsed.data;
}
