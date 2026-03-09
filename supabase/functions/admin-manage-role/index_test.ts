import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canAssignRole } from "./index.ts";

Deno.test("role escalation prevention: non-admin cannot assign roles", () => {
  const result = canAssignRole(null, "admin");
  assertEquals(result.allowed, false);
  assertEquals(result.status, 403);
});

Deno.test("role escalation prevention: invalid role is blocked", () => {
  const result = canAssignRole("admin", "owner");
  assertEquals(result.allowed, false);
  assertEquals(result.status, 400);
});

Deno.test("admins can assign privileged roles", () => {
  const result = canAssignRole("admin", "support_agent");
  assertEquals(result.allowed, true);
  assertEquals(result.status, 200);
});