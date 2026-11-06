import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_CONNECTION_CONFLICT_TARGET,
  instagramOauthErrorQuery,
  isConnectionId,
  planInstagramConnectionWrite,
  resolveSelectedConnectionId,
  upsertOwnedInstagramConnection,
  type InstagramConnectionWritePayload,
  type InstagramConnectionWriteStore,
} from "@/lib/instagram-accounts";

const hernando = { id: "10000000-0000-4000-8000-000000000001", status: "connected" };
const chloe = { id: "10000000-0000-4000-8000-000000000002", status: "connected" };
const expired = { id: "10000000-0000-4000-8000-000000000003", status: "expired" };

describe("multi-conta Instagram", () => {
  it("reconecta pela identidade do Instagram, nunca pelo owner", () => {
    expect(INSTAGRAM_CONNECTION_CONFLICT_TARGET).toBe("instagram_user_id");
  });

  it("atualiza a mesma conta e recusa identidade de outro owner", () => {
    expect(planInstagramConnectionWrite("owner-1", null)).toEqual({ action: "insert" });
    expect(planInstagramConnectionWrite("owner-1", { id: "conn-1", ownerId: "owner-1" })).toEqual({
      action: "update",
      id: "conn-1",
    });
    expect(planInstagramConnectionWrite("owner-1", { id: "conn-2", ownerId: "owner-2" })).toEqual({
      action: "reject",
      reason: "owned_by_other",
    });
  });

  it("prioriza a conta pedida, depois cookie, preferência e a conexão viva mais antiga", () => {
    expect(resolveSelectedConnectionId([], {})).toBeNull();
    expect(resolveSelectedConnectionId([hernando, chloe], { requestedId: chloe.id })).toBe(chloe.id);
    expect(resolveSelectedConnectionId([hernando, chloe], { cookieId: chloe.id })).toBe(chloe.id);
    expect(resolveSelectedConnectionId([hernando, chloe], { preferredId: chloe.id })).toBe(chloe.id);
    expect(resolveSelectedConnectionId([expired, hernando], {})).toBe(hernando.id);
    expect(resolveSelectedConnectionId([hernando, chloe], { requestedId: "missing", cookieId: chloe.id })).toBe(chloe.id);
  });

  it("não troca a conta original quando o pedido é inválido", () => {
    expect(isConnectionId("not-a-uuid")).toBe(false);
    expect(isConnectionId(hernando.id)).toBe(true);
    expect(resolveSelectedConnectionId([hernando, chloe], { requestedId: "x", cookieId: "y", preferredId: "z" })).toBe(hernando.id);
  });

  it("grava a segunda conta sem tocar na primeira e só recusa identidade de outro owner", async () => {
    const hernandoRow = {
      id: "conn-hernando",
      ownerId: "owner-1",
      instagramUserId: "26373041522379014",
      username: "hernando.ia",
    };
    const { rows, store } = memoryStore([hernandoRow]);
    const snapshot = structuredClone(hernandoRow);

    const inserted = await upsertOwnedInstagramConnection(store, "owner-1", connectionPayload({
      instagramUserId: "chloe-ig-id",
      username: "chloe.xai",
    }));
    expect(inserted).toEqual({ ok: true, action: "insert", id: "conn-2" });
    expect(rows[0]).toEqual(snapshot);
    expect(rows[1]).toMatchObject({
      ownerId: "owner-1",
      instagramUserId: "chloe-ig-id",
      username: "chloe.xai",
    });

    const reconnected = await upsertOwnedInstagramConnection(store, "owner-1", connectionPayload({
      instagramUserId: "chloe-ig-id",
      username: "chloe.xai",
    }));
    expect(reconnected).toEqual({ ok: true, action: "update", id: "conn-2" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(snapshot);

    const conflict = await upsertOwnedInstagramConnection(
      memoryStore([{ ...hernandoRow, ownerId: "owner-2" }]).store,
      "owner-1",
      connectionPayload({ instagramUserId: hernandoRow.instagramUserId, username: hernandoRow.username }),
    );
    expect(conflict).toEqual({ ok: false, reason: "owned_by_other" });
  });

  it("só usa a mensagem de substituição no conflito de owner", () => {
    expect(instagramOauthErrorQuery("owned_by_other")).toBe("oauth_conflict");
    expect(instagramOauthErrorQuery("save_failed")).toBe("oauth");
    expect(instagramOauthErrorQuery("meta")).toBe("oauth");
  });
});

function connectionPayload(overrides: Partial<InstagramConnectionWritePayload> = {}): InstagramConnectionWritePayload {
  return {
    ownerId: "owner-1",
    instagramUserId: "chloe-ig-id",
    username: "chloe.xai",
    tokenCiphertext: "ciphertext",
    tokenIv: "iv",
    tokenTag: "tag",
    tokenExpiresAt: null,
    apiVersion: "v25.0",
    ...overrides,
  };
}

function memoryStore(initial: Array<{ id: string; ownerId: string; instagramUserId: string; username: string }>) {
  const rows = initial.map((row) => ({ ...row }));
  const store: InstagramConnectionWriteStore = {
    async findByInstagramUserId(instagramUserId) {
      return rows.find((row) => row.instagramUserId === instagramUserId) ?? null;
    },
    async insert(payload) {
      const created = {
        id: `conn-${rows.length + 1}`,
        ownerId: payload.ownerId,
        instagramUserId: payload.instagramUserId,
        username: payload.username,
      };
      rows.push(created);
      return { id: created.id };
    },
    async updateById(id, ownerId, payload) {
      const row = rows.find(
        (item) => item.id === id && item.ownerId === ownerId && item.instagramUserId === payload.instagramUserId,
      );
      if (!row) return null;
      row.username = payload.username;
      return { id: row.id };
    },
  };
  return { rows, store };
}
