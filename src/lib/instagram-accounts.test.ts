import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_CONNECTION_CONFLICT_TARGET,
  isConnectionId,
  planInstagramConnectionWrite,
  resolveSelectedConnectionId,
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
});
