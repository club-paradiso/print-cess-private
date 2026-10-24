import type { PairingRecord } from "@print-cess/protocol";
import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { PostgresExecutor, PostgresQueryClient } from "../session-store/postgres-client";
import { RailwayPostgresPairingStore } from "./postgres";

const TRANSFER_CODE = "23456789ABCD";

function draft(now = 1_000): Omit<PairingRecord, "code"> {
  return {
    protocolVersion: 1,
    shape: "star",
    transferCode: TRANSFER_CODE,
    createdAt: now,
    expiresAt: now + 180_000,
  };
}

describe("RailwayPostgresPairingStore", () => {
  it("commits wrong-shape counting and deletion instead of rolling them back", async () => {
    const database = new FakePostgresExecutor();
    const store = new RailwayPostgresPairingStore(database);
    await store.claim(draft(), ["4242"]);

    await expect(store.redeem("4242", "circle", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    await expect(store.redeem("4242", "triangle", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    await expect(store.redeem("4242", "star", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    expect(database.rollbackCount).toBe(0);
  });

  it("forgives one wrong shape", async () => {
    const database = new FakePostgresExecutor();
    const store = new RailwayPostgresPairingStore(database);
    await store.claim(draft(), ["4242"]);

    await expect(store.redeem("4242", "circle", 1_000)).rejects.toThrow();
    await expect(store.redeem("4242", "star", 1_000)).resolves.toMatchObject({
      transferCode: TRANSFER_CODE,
    });
  });

  it("counts wrong guesses per window across every caller", async () => {
    const database = new FakePostgresExecutor();
    const store = new RailwayPostgresPairingStore(database);
    await store.recordMiss(60_000);
    await store.recordMiss(90_000);
    expect(await store.recentMisses(119_999)).toBe(2);
    expect(await store.recentMisses(120_000)).toBe(0);
  });
});

type PairingRow = { pairing: unknown; expires_at: string | number };

class FakePostgresExecutor implements PostgresExecutor {
  private rows = new Map<string, PairingRow>();
  private misses = new Map<number, number>();
  public rollbackCount = 0;

  public async transaction<T>(
    _sessionId: string,
    action: (client: PostgresQueryClient) => Promise<T>,
  ): Promise<T> {
    const before = structuredClone(this.rows);
    try {
      return await action({ query: (text, values) => this.run(text, values) });
    } catch (error) {
      this.rows = before;
      this.rollbackCount += 1;
      throw error;
    }
  }

  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    return this.run<R>(text, values);
  }

  private async run<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS")) return result([]);
    if (normalized.startsWith("DELETE FROM print_cess_pairing_state_v1 WHERE expires_at")) {
      const now = Number(values[0]);
      for (const [code, row] of this.rows) {
        if (Number(row.expires_at) <= now) this.rows.delete(code);
      }
      return result([]);
    }
    if (normalized.startsWith("INSERT INTO print_cess_pairing_state_v1")) {
      const code = String(values[0]);
      const expiresAt = Number(values[2]);
      const existing = this.rows.get(code);
      if (existing && Number(existing.expires_at) > Number(values[3])) return result([]);
      this.rows.set(code, { pairing: JSON.parse(String(values[1])), expires_at: expiresAt });
      return result<R>([], 1);
    }
    if (normalized.startsWith("SELECT pairing, expires_at FROM print_cess_pairing_state_v1")) {
      const row = this.rows.get(String(values[0]));
      return result<R>(row ? [structuredClone(row) as unknown as R] : []);
    }
    if (normalized.startsWith("UPDATE print_cess_pairing_state_v1 SET pairing")) {
      const row = this.rows.get(String(values[0]));
      if (row) row.pairing = JSON.parse(String(values[1]));
      return result<R>([], row ? 1 : 0);
    }
    if (normalized.startsWith("DELETE FROM print_cess_pairing_state_v1 WHERE code")) {
      this.rows.delete(String(values[0]));
      return result([]);
    }
    if (normalized.startsWith("INSERT INTO print_cess_pairing_miss_v1")) {
      const window = Number(values[0]);
      this.misses.set(window, (this.misses.get(window) ?? 0) + 1);
      return result([], 1);
    }
    if (normalized.startsWith("SELECT misses FROM print_cess_pairing_miss_v1")) {
      const count = this.misses.get(Number(values[0]));
      return result<R>(count === undefined ? [] : [{ misses: count } as unknown as R]);
    }
    throw new Error(`Unexpected test query: ${normalized}`);
  }
}

function result<R extends QueryResultRow>(rows: R[], rowCount = rows.length): QueryResult<R> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}
