import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPrivilegedRole } from "./index.ts";

Deno.test("admin RBAC: privileged roles are accepted", () => {
  assertEquals(isPrivilegedRole("admin"), true);
  assertEquals(isPrivilegedRole("moderator"), true);
  assertEquals(isPrivilegedRole("support_agent"), true);
});

Deno.test("admin RBAC: non-privileged roles are rejected", () => {
  assertEquals(isPrivilegedRole("user"), false);
  assertEquals(isPrivilegedRole(null), false);
});