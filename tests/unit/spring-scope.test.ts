import { describe, it, expect } from "vitest";
import {
  resolveSpringScope,
  type ScopeRequestContext,
} from "../../src/middlewares/document/spring-scope";

const SPRING = "api::spring.spring";

const adminCtx = (
  roles: { code: string }[],
  id = 7
): ScopeRequestContext => ({
  state: { auth: { strategy: { name: "admin" } }, user: { id, roles } },
});

describe("resolveSpringScope", () => {
  it("scopes a regular admin to their user id", () => {
    const d = resolveSpringScope({
      uid: SPRING,
      action: "findMany",
      ctx: adminCtx([{ code: "editor" }], 42),
    });
    expect(d).toEqual({ apply: true, userId: 42 });
  });

  it("does NOT scope a super admin", () => {
    const d = resolveSpringScope({
      uid: SPRING,
      action: "findMany",
      ctx: adminCtx([{ code: "strapi-super-admin" }]),
    });
    expect(d.apply).toBe(false);
  });

  it("does NOT scope non-spring uids or non-scoped actions", () => {
    expect(
      resolveSpringScope({ uid: "api::report.report", action: "findMany", ctx: adminCtx([{ code: "editor" }]) }).apply
    ).toBe(false);
    expect(
      resolveSpringScope({ uid: SPRING, action: "create", ctx: adminCtx([{ code: "editor" }]) }).apply
    ).toBe(false);
  });

  it("does NOT scope internal calls (no request context)", () => {
    expect(resolveSpringScope({ uid: SPRING, action: "findMany", ctx: null }).apply).toBe(false);
    expect(resolveSpringScope({ uid: SPRING, action: "findMany", ctx: undefined }).apply).toBe(false);
  });

  it("does NOT scope a logged-in users-permissions user (invariant #2)", () => {
    // UP request on a public endpoint: non-admin strategy → must NOT be filtered
    const upCtx: ScopeRequestContext = {
      state: { auth: { strategy: { name: "users-permissions" } }, user: { id: 5, roles: [{ code: "authenticated" }] } },
    };
    expect(resolveSpringScope({ uid: SPRING, action: "findMany", ctx: upCtx }).apply).toBe(false);
  });

  it("does NOT scope when user shape lacks roles[] (extra UP safety)", () => {
    const weird: ScopeRequestContext = {
      state: { auth: { strategy: { name: "admin" } }, user: { id: 9 } as { id: number } },
    };
    expect(resolveSpringScope({ uid: SPRING, action: "update", ctx: weird }).apply).toBe(false);
  });
});
