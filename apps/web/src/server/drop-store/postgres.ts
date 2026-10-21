import { dropRecordSchema, type DropRecord } from "@print-cess/protocol";

import type { DropPartCommit, DropReceiverEvent, DropStore } from "../contracts";
import { ServiceError } from "../errors";
import { createPostgresExecutor, type PostgresExecutor } from "../session-store/postgres-client";
import {
  applyPartCommits,
  applyReceiverEvent,
  assertSealable,
  requireOwner,
  type DropMutation,
} from "./transitions";

const TABLE_NAME = "print_cess_drop_state_v1";

type DropRow = { drop: unknown; retention_expires_at: string | number };

export class RailwayPostgresDropStore implements DropStore {
  readonly #executor: PostgresExecutor;
  #schema: Promise<void> | null = null;

  public constructor(executor: PostgresExecutor = createPostgresExecutor()) {
    this.#executor = executor;
  }

  public async create(drop: DropRecord, retentionMs: number): Promise<void> {
    await this.ensureSchema();
    const result = await this.#executor.query(
      `
      INSERT INTO ${TABLE_NAME} (drop_id, drop, retention_expires_at, expires_at)
      VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT (drop_id) DO NOTHING
      `,
      [drop.dropId, JSON.stringify(drop), drop.expiresAt + retentionMs, drop.expiresAt],
    );
    if (result.rowCount !== 1) {
      throw new ServiceError("conflict", "This transfer code is already in use.", 409);
    }
  }

  public async get(dropId: string): Promise<DropRecord | null> {
    await this.ensureSchema();
    const result = await this.#executor.query<DropRow>(
      `SELECT drop, retention_expires_at FROM ${TABLE_NAME} WHERE drop_id = $1`,
      [dropId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (Number(row.retention_expires_at) <= Date.now()) return null;
    return parseDrop(row.drop);
  }

  public async commitParts(
    dropId: string,
    ownerTokenHash: string,
    parts: readonly DropPartCommit[],
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      return applyPartCommits(drop, parts);
    });
  }

  public async seal(dropId: string, ownerTokenHash: string, now: number): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      assertSealable(drop);
      if (drop.status === "ready") return drop;
      return { ...drop, status: "ready", revision: drop.revision + 1 };
    });
  }

  public async recordReceiverEvent(
    dropId: string,
    event: DropReceiverEvent,
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => applyReceiverEvent(drop, event));
  }

  public async remove(dropId: string): Promise<void> {
    await this.ensureSchema();
    await this.#executor.query(`DELETE FROM ${TABLE_NAME} WHERE drop_id = $1`, [dropId]);
  }

  public async listExpired(now: number, limit: number): Promise<DropRecord[]> {
    await this.ensureSchema();
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.#executor.query<DropRow>(
      `
      SELECT drop, retention_expires_at FROM ${TABLE_NAME}
      WHERE expires_at <= $1
      ORDER BY expires_at, drop_id
      LIMIT $2
      `,
      [now, boundedLimit],
    );
    return result.rows.map((row) => parseDrop(row.drop));
  }

  private async mutate(dropId: string, now: number, mutation: DropMutation): Promise<DropRecord> {
    await this.ensureSchema();
    return this.#executor.transaction(`drop:${dropId}`, async (client) => {
      const result = await client.query<DropRow>(
        `SELECT drop, retention_expires_at FROM ${TABLE_NAME} WHERE drop_id = $1 FOR UPDATE`,
        [dropId],
      );
      const row = result.rows[0];
      if (!row || Number(row.retention_expires_at) <= now) {
        throw new ServiceError("not_found", "This transfer was not found.", 404);
      }
      const current = parseDrop(row.drop);
      if (current.expiresAt <= now) {
        throw new ServiceError("expired", "This transfer has expired.", 410);
      }
      const next = mutation(current);
      if (next === current) return current;
      await client.query(
        `UPDATE ${TABLE_NAME} SET drop = $2::jsonb, updated_at = NOW() WHERE drop_id = $1`,
        [dropId, JSON.stringify(next)],
      );
      return next;
    });
  }

  private async ensureSchema(): Promise<void> {
    this.#schema ??= (async () => {
      await this.#executor.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          drop_id TEXT PRIMARY KEY,
          drop JSONB NOT NULL,
          retention_expires_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.#executor.query(`
        CREATE INDEX IF NOT EXISTS print_cess_drop_expiry_v1
        ON ${TABLE_NAME} (expires_at, drop_id)
      `);
    })().catch((error: unknown) => {
      this.#schema = null;
      throw error;
    });
    return this.#schema;
  }
}

function parseDrop(value: unknown): DropRecord {
  const decoded = typeof value === "string" ? safeJsonParse(value) : value;
  const parsed = dropRecordSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ServiceError("unavailable", "Stored transfer state is unreadable.", 503);
  }
  return parsed.data;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ServiceError("unavailable", "Stored transfer state is unreadable.", 503);
  }
}
