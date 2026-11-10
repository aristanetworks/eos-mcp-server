import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { buildValidateInventoryResult } from "../src/commands/validateInventory.js";
import { resolveEapiConnection } from "../src/connection/resolveConnection.js";
import { validateStartupConnections } from "../src/connection/validateStartupConnections.js";
import { loadInventoryModel, validateInventory } from "../src/inventory/loadInventory.js";
import type { InventorySchemaKind } from "../src/inventory/types.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

interface InventoryVarSets {
  global?: Record<string, unknown>;
  parent?: Record<string, unknown>;
  child?: Record<string, unknown>;
  host?: Record<string, unknown>;
}

// The same four hosts exercise global, parent-group, child-group and host vars
// through the real parser for each supported inventory format.
async function writeUserInventory(schema: InventorySchemaKind, vars: InventoryVarSets = {}): Promise<string> {
  const globalVars = { ansible_network_os: "eos", ...vars.global };
  const hosts = { global1: {}, parent1: {}, child1: {}, host1: vars.host ?? {} };
  const document = schema === "canonical-ansible-yaml"
    ? { all: {
      vars: globalVars,
      hosts: { global1: hosts.global1 },
      children: { fabric: {
        vars: vars.parent ?? {},
        hosts: { parent1: hosts.parent1 },
        children: { leafs: {
          vars: vars.child ?? {},
          hosts: { child1: hosts.child1, host1: hosts.host1 }
        } }
      } }
    } }
    : {
      vars: globalVars,
      hosts,
      groups: {
        fabric: { vars: vars.parent ?? {}, hosts: ["parent1"], children: ["leafs"] },
        leafs: { vars: vars.child ?? {}, hosts: ["child1", "host1"] }
      }
    };
  return writeTempInventory([stringify(document)]);
}

const passwordDefaults = { mcpPasswordEnv: "EOS_MCP_TEST_USER_PASSWORD" };

beforeEach(() => vi.stubEnv("EOS_MCP_TEST_USER_PASSWORD", "test-password"));
afterEach(() => vi.unstubAllEnvs());

describe("mcp_user in canonical Ansible inventory", () => {
  const schema = "canonical-ansible-yaml";

  it("inherits global, parent-group and child-group users with a host override", async () => {
    const model = await loadInventoryModel(await writeUserInventory(schema, {
      global: { ansible_user: "admin", mcp_user: "mcp-global" },
      parent: { mcp_user: "mcp-fabric" },
      child: { mcp_user: "mcp-leafs" },
      host: { ansible_user: "host-admin", mcp_user: "mcp-host" }
    }));
    const config = buildConfig({ defaultConnection: { ansibleUser: "server-default", ...passwordDefaults } });
    const expectedUsers = { global1: "mcp-global", parent1: "mcp-fabric", child1: "mcp-leafs", host1: "mcp-host" };

    for (const host of model.hosts) {
      expect(host.effectiveVars.ansible_user).toBe(host.inventoryHostname === "host1" ? "host-admin" : "admin");
      expect(resolveEapiConnection(config, host)).toMatchObject({
        username: expectedUsers[host.inventoryHostname as keyof typeof expectedUsers],
        password: "test-password",
        validateCerts: true
      });
    }
  });

  it.each<{ name: string; vars: InventoryVarSets; username: string }>([
    { name: "inherited mcp_user over host ansible_user", vars: {
      global: { mcp_user: "eos-mcp", ansible_user: "admin" }, host: { ansible_user: "host-admin" }
    }, username: "eos-mcp" },
    { name: "mcp_user without ansible_user", vars: { host: { mcp_user: "eos-mcp" } }, username: "eos-mcp" },
    { name: "inherited ansible_user when mcp_user is absent", vars: {
      parent: { ansible_user: "admin" }
    }, username: "admin" },
    { name: "host ansible_user over inherited ansible_user", vars: {
      global: { ansible_user: "admin" }, host: { ansible_user: "operator" }
    }, username: "operator" },
    { name: "server default when both inventory users are absent", vars: {}, username: "server-default" }
  ])("resolves $name", async ({ vars, username }) => {
    const model = await loadInventoryModel(await writeUserInventory(schema, vars));
    const host = model.hostMap.get("host1");
    expect(host).toBeDefined();
    if (!host) return;

    const connection = resolveEapiConnection(
      buildConfig({ defaultConnection: { ansibleUser: "server-default", ...passwordDefaults } }), host
    );
    expect(connection.username).toBe(username);
  });

  describe.each(["global", "parent", "host"] as const)("invalid %s mcp_user", (scope) => {
    it.each(["", null, 0, false, [], {}])("rejects %j even with valid fallback and host users", async (value) => {
      const inventoryPath = await writeUserInventory(schema, {
        global: { ansible_user: "admin" },
        host: { mcp_user: "valid-host-user" },
        [scope]: { ...(scope === "global" ? { ansible_user: "admin" } : {}), mcp_user: value }
      });
      const result = await validateInventory(inventoryPath);
      const errorPath = scope === "global" ? "vars.mcp_user"
        : scope === "parent" ? "groups.fabric.vars.mcp_user" : "hosts.host1.mcp_user";

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        code: "inventory_var_type_invalid", path: errorPath
      }));
      await expect(loadInventoryModel(inventoryPath)).rejects.toMatchObject({ code: "inventory_validation_failed" });
    });
  });

  it("rejects conflicting mcp_user values inherited from groups at the same depth", async () => {
    const document = { all: { children: {
      left: { vars: { mcp_user: "left-user" }, hosts: { leaf1: {} } },
      right: { vars: { mcp_user: "right-user" }, hosts: { leaf1: {} } }
    } } };
    const result = await validateInventory(await writeTempInventory([stringify(document)]));

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "inventory_same_level_conflict", message: expect.stringContaining("mcp_user")
    }));
  });

  it("passes startup and effective CLI validation with only an MCP username", async () => {
    const inventoryPath = await writeUserInventory(schema, { global: { mcp_user: "eos-mcp" } });
    const model = await loadInventoryModel(inventoryPath);
    const config = buildConfig({ inventoryPath, defaultConnection: passwordDefaults });

    expect(() => validateStartupConnections(config, model)).not.toThrow();
    expect(await buildValidateInventoryResult(config, { inventoryOnly: false })).toMatchObject({ ok: true, errors: [] });
  });

  it("still rejects startup when no username resolves", async () => {
    const inventoryPath = await writeUserInventory(schema);
    const config = buildConfig({ inventoryPath, defaultConnection: passwordDefaults });
    const model = await loadInventoryModel(inventoryPath);

    expect(() => validateStartupConnections(config, model)).toThrow(/username/);
    const result = await buildValidateInventoryResult(config, { inventoryOnly: false });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "connection_username_missing" }));
  });

  it.each([true, false])("rejects invalid mcp_user in CLI validation (inventoryOnly=%s)", async (inventoryOnly) => {
    const inventoryPath = await writeUserInventory(schema, { global: { mcp_user: "", ansible_user: "admin" } });
    const result = await buildValidateInventoryResult(
      buildConfig({ inventoryPath, defaultConnection: { ansibleUser: "server-default", ...passwordDefaults } }),
      { inventoryOnly }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "inventory_var_type_invalid", path: "vars.mcp_user" }));
  });

  it("still requires exactly one password source with mcp_user", async () => {
    const inventoryPath = await writeUserInventory(schema, { global: { mcp_user: "eos-mcp" } });
    const missing = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: false });
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContainEqual(expect.objectContaining({ code: "connection_password_source_missing" }));

    const conflictingPath = await writeUserInventory(schema, { global: {
      mcp_user: "eos-mcp", mcp_password_env: "EOS_MCP_TEST_USER_PASSWORD", ansible_password: "literal-password"
    } });
    const conflicting = await buildValidateInventoryResult(buildConfig({ inventoryPath: conflictingPath }), { inventoryOnly: false });
    expect(conflicting.ok).toBe(false);
    expect(conflicting.errors).toContainEqual(expect.objectContaining({ code: "connection_password_source_invalid" }));
  });
});

describe("simplified inventory username compatibility", () => {
  it.each(["global", "parent", "child", "host"] as const)("rejects unsupported %s mcp_user", async (scope) => {
    const inventoryPath = await writeUserInventory("simplified-yaml", {
      global: { ansible_user: "admin" },
      [scope]: { mcp_user: "eos-mcp" }
    });
    const result = await validateInventory(inventoryPath);
    const errorPath = scope === "global" ? "vars.mcp_user"
      : scope === "host" ? "hosts.host1.mcp_user"
        : `groups.${scope === "parent" ? "fabric" : "leafs"}.vars.mcp_user`;

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "inventory_var_unsupported", path: errorPath,
      message: expect.stringContaining("only in canonical Ansible-style inventories")
    }));
    await expect(loadInventoryModel(inventoryPath)).rejects.toMatchObject({ code: "inventory_validation_failed" });
  });

  it.each(["", null, 0])("rejects unsupported mcp_user=%j regardless of its value", async (mcp_user) => {
    const result = await validateInventory(await writeUserInventory("simplified-yaml", { host: { mcp_user } }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "inventory_var_unsupported", path: "hosts.host1.mcp_user"
    }));
  });

  it.each([true, false])("rejects mcp_user in CLI validation (inventoryOnly=%s)", async (inventoryOnly) => {
    const inventoryPath = await writeUserInventory("simplified-yaml", {
      global: { ansible_user: "admin", mcp_user: "eos-mcp" }
    });
    const result = await buildValidateInventoryResult(
      buildConfig({ inventoryPath, defaultConnection: passwordDefaults }), { inventoryOnly }
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "inventory_var_unsupported", path: "vars.mcp_user"
    }));
  });

  it.each<{ name: string; vars: InventoryVarSets; username: string }>([
    { name: "inherited ansible_user", vars: { parent: { ansible_user: "admin" } }, username: "admin" },
    { name: "host ansible_user", vars: {
      global: { ansible_user: "admin" }, host: { ansible_user: "operator" }
    }, username: "operator" },
    { name: "server default", vars: {}, username: "server-default" }
  ])("preserves the $name fallback", async ({ vars, username }) => {
    const inventoryPath = await writeUserInventory("simplified-yaml", vars);
    const model = await loadInventoryModel(inventoryPath);
    const host = model.hostMap.get("host1");
    expect(host).toBeDefined();
    if (!host) return;

    expect(resolveEapiConnection(
      buildConfig({ defaultConnection: { ansibleUser: "server-default", ...passwordDefaults } }), host
    ).username).toBe(username);
  });
});
