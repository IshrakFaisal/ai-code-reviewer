import { describe, it, expect } from "vitest";
import { dockerEnvironmentFile } from "../scripts/docker-setup.mjs";
describe("exact-repository Docker environment setup", () => {
  it("recognizes tab-separated exports and preserves CRLF consistently", () => {
    const value = dockerEnvironmentFile(
      "# keep\r\nexport\tSANDBOX_PROVIDER\t=disabled\r\nNEBIUS_API_KEY=preserved\r\n",
      "owner/project",
    );
    expect(value).toContain("SANDBOX_PROVIDER=docker\r\n");
    expect(value).not.toContain("disabled");
    expect(value).toContain("NEBIUS_API_KEY=preserved\r\n");
    expect(value.replaceAll("\r\n", "")).not.toContain("\n");
  });
  it("preserves credentials and unrelated configuration", () => {
    const source =
      "NEBIUS_API_KEY=private-value\nNEBIUS_MODEL=nvidia/model\nAPP_AUTH_PASSWORD=secret-password\n# operator note\nSANDBOX_PROVIDER=disabled\n";
    const result = dockerEnvironmentFile(source, "owner/project");
    expect(result).toContain(
      "NEBIUS_API_KEY=private-value\nNEBIUS_MODEL=nvidia/model\nAPP_AUTH_PASSWORD=secret-password\n# operator note\n",
    );
    expect(result).toContain("SANDBOX_PROVIDER=docker");
    expect(result).toContain("LOCAL_SANDBOX_REPOSITORIES=owner/project");
    expect(result).toContain("ENABLE_PRODUCTION_SANDBOX=false");
  });
  it("updates repeated settings without widening the allowlist", () => {
    const result = dockerEnvironmentFile(
      "LOCAL_SANDBOX_REPOSITORIES=old/repo\r\nexport SANDBOX_PROVIDER=nebius\r\nSANDBOX_PROVIDER=disabled\r\n",
      "owner/project",
      true,
    );
    expect(result).not.toContain("old/repo");
    expect(result).not.toContain("nebius");
    expect(result).toContain("ENABLE_PRODUCTION_SANDBOX=true");
    expect(result.match(/SANDBOX_PROVIDER=docker/g)).toHaveLength(2);
    expect(result).not.toContain("\r\r\n");
  });
  it.each([
    "owner/*",
    "owner/repo,other/repo",
    "owner/repo\nNEBIUS_API_KEY=leak",
    "../repo",
    "owner;command/repo",
    "https://github.com/owner/repo",
  ])("rejects non-exact repository input: %s", (value) =>
    expect(() => dockerEnvironmentFile("", value)).toThrow(),
  );
});
