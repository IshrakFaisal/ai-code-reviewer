import { describe, expect, it, vi } from "vitest";
import {
  ContreeClient,
  contreeConfiguration,
  type ContreeConfiguration,
} from "@/lib/sandbox/contree-client";

const image = "12345678-1234-1234-1234-123456789abc";
const checkpoint = "22345678-1234-1234-1234-123456789abc";
const id = "32345678-1234-1234-1234-123456789abc";
const config: ContreeConfiguration = {
  token: "test-iam-token",
  projectId: "test-project",
  baseUrl: "https://api.tokenfactory.nebius.com/sandboxes",
  image,
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const completed = (overrides: Record<string, unknown> = {}) => ({
  uuid: id,
  kind: "instance",
  status: "SUCCESS",
  result_image_uuid: checkpoint,
  metadata: {
    result: {
      state: { exit_code: 0, signal: 0, timed_out: false },
      stdout: { value: "ok", encoding: "ascii", truncated: false },
      stderr: { value: "", encoding: "base64", truncated: false },
    },
  },
  ...overrides,
});
const command = {
  command: "/usr/local/bin/node",
  args: ["--version"],
  networking: false,
};
const client = (fetcher: typeof fetch, signal?: AbortSignal, options = {}) =>
  new ContreeClient(config, signal, fetcher, { pollIntervalMs: 1, ...options });

describe("ConTree documented HTTP adapter", () => {
  it("validates IAM configuration, image UUID and HTTPS endpoint", () => {
    expect(
      contreeConfiguration({
        NEBIUS_SANDBOX_TOKEN: config.token,
        NEBIUS_SANDBOX_PROJECT_ID: config.projectId,
        NEBIUS_SANDBOX_IMAGE: image,
      }),
    ).toEqual(config);
    for (const changes of [
      { token: "" },
      { token: "secret\r\nInjected: yes" },
      { projectId: "" },
      { projectId: "a\nInjected" },
      { image: "tag:node:22" },
      { baseUrl: "http://remote.example/sandboxes" },
      { baseUrl: "https://user:secret@example.com" },
      { baseUrl: "https://example.com?q=1" },
      { baseUrl: "https://example.com/#fragment" },
      { baseUrl: "https://example.com/v1" },
    ])
      expect(() => new ContreeClient({ ...config, ...changes })).toThrow();
  });

  it("runs a nonroot offline command with explicit limits and checkpoint chaining", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(
        response({ uuid: id, kind: "instance", status: "EXECUTING" }),
      )
      .mockResolvedValueOnce(response(completed()));
    const remote = client(fetcher);
    const result = await remote.execute({
      ...command,
      stdin: "inputé",
      env: { CI: "1" },
      cwd: "/workspace",
      timeoutSeconds: 40,
    });
    expect(result).toMatchObject({
      operationId: id,
      imageId: checkpoint,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      truncated: false,
    });
    expect(remote.operationIds.has(id)).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${config.baseUrl}/v1/instances`);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Project: config.projectId,
      },
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      image,
      shell: false,
      uid: 1000,
      gid: 1000,
      preserve_env: false,
      disposable: false,
      networking: { enabled: false },
      resources_limits: { max_layer_bytes: 1610612736 },
      truncate_output_at: 32768,
      timeout: 40,
      stdin: {
        value: Buffer.from("inputé").toString("base64"),
        encoding: "base64",
        close: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain(config.token);
    await remote.destroy();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("allows disposable reads without creating a checkpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response(completed({ result_image_uuid: null })));
    expect(
      await client(fetcher).execute({
        ...command,
        image: checkpoint,
        disposable: true,
      }),
    ).toMatchObject({ imageId: undefined, stdout: "ok" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).image).toBe(
      checkpoint,
    );
  });

  it("rejects success without a required checkpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response(completed({ result_image_uuid: null })));
    await expect(client(fetcher).execute(command)).rejects.toThrow(
      "filesystem checkpoint",
    );
  });

  it("preserves an executed failure when no checkpoint could be saved", async () => {
    const data = completed();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(
        response({
          ...data,
          result_image_uuid: null,
          metadata: {
            result: { ...data.metadata.result, state: { exit_code: 9 } },
          },
        }),
      );
    expect(await client(fetcher).execute(command)).toMatchObject({
      exitCode: 9,
      imageId: undefined,
    });
  });

  it.each([
    { state: { exit_code: 7 }, exitCode: 7, timedOut: false },
    { state: { exit_code: 0, timed_out: true }, exitCode: 1, timedOut: true },
    { state: { exit_code: -1, signal: 9 }, exitCode: 1, timedOut: false },
    { state: {}, exitCode: 1, timedOut: false },
  ])(
    "does not report missing, timed-out or signalled command outcomes as success: $state",
    async ({ state, exitCode, timedOut }) => {
      const data = completed();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ uuid: id }, 201))
        .mockResolvedValueOnce(
          response({
            ...data,
            metadata: { result: { ...data.metadata.result, state } },
          }),
        );
      expect(await client(fetcher).execute(command)).toMatchObject({
        exitCode,
        timedOut,
      });
    },
  );

  it("decodes base64 and fails closed when either stream is truncated", async () => {
    const data = completed();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(
        response({
          ...data,
          metadata: {
            result: {
              ...data.metadata.result,
              stdout: {
                value: Buffer.from("real output").toString("base64"),
                encoding: "base64",
                truncated: true,
              },
            },
          },
        }),
      );
    expect(
      await client(fetcher).execute({ ...command, outputLimitBytes: 4 }),
    ).toMatchObject({ stdout: "real", truncated: true, exitCode: 1 });
  });

  it("rejects malformed stream encodings", async () => {
    const data = completed();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(
        response({
          ...data,
          metadata: {
            result: {
              ...data.metadata.result,
              stderr: { value: "!not-base64!", encoding: "base64" },
            },
          },
        }),
      );
    await expect(client(fetcher).execute(command)).rejects.toThrow(
      "invalid encoded output",
    );
  });

  it("cancels an operation after malformed or mismatched status responses", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response(completed({ uuid: checkpoint })))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(client(fetcher).execute(command)).rejects.toThrow(
      "invalid operation data",
    );
    expect(fetcher.mock.calls[2]).toMatchObject([
      `${config.baseUrl}/v1/operations/${id}`,
      { method: "DELETE" },
    ]);
  });

  it("sanitizes HTTP and fetch failures and never blindly retries a POST", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream-secret", { status: 429 }));
    await expect(client(fetcher).execute(command)).rejects.toThrow("HTTP 429");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const failing = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`network leaked ${config.token}`));
    await expect(client(failing).execute(command)).rejects.toThrow(
      "could not complete the request",
    );
  });

  it("cancels after an operation deadline using an independent cleanup signal", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockImplementation(async (_url, init) =>
        init?.method === "DELETE"
          ? new Response(null, { status: 202 })
          : response({ uuid: id, kind: "instance", status: "EXECUTING" }),
      );
    await expect(
      client(fetcher, undefined, { operationTimeoutMs: 20 }).execute(command),
    ).rejects.toThrow("cancelled or timed out");
    const cleanup = fetcher.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(cleanup).toBeDefined();
    expect(cleanup![1]?.signal?.aborted).toBe(false);
  });

  it("does not submit when the caller has already cancelled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const signal = AbortSignal.abort(new Error("user secret"));
    await expect(client(fetcher, signal).execute(command)).rejects.toThrow(
      "cancelled or timed out",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries unconfirmed cancellation during destroy", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response({ invalid: true }))
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const remote = client(fetcher);
    await expect(remote.execute(command)).rejects.toThrow(
      "cancellation could not be confirmed",
    );
    await remote.destroy();
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(2);
  });

  it("caps response bytes and cancels a known operation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(new Response("x".repeat(2_000_001)))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(client(fetcher).execute(command)).rejects.toThrow(
      "size limit",
    );
    expect(fetcher.mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("never returns success for a failed remote operation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response(completed({ status: "FAILED" })));
    expect(await client(fetcher).execute(command)).toMatchObject({
      exitCode: 1,
    });
  });

  it("stops reading a stalled body when its request deadline expires", async () => {
    let cancelled = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    await expect(
      client(fetcher, undefined, { requestTimeoutMs: 20 }).execute(command),
    ).rejects.toThrow("cancelled or timed out");
    expect(cancelled).toBe(true);
  });

  it("confirms terminal status when completion races cancellation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ uuid: id }, 201))
      .mockResolvedValueOnce(response({ invalid: true }))
      .mockResolvedValueOnce(response({}, 409))
      .mockResolvedValueOnce(response(completed()));
    const remote = client(fetcher);
    await expect(remote.execute(command)).rejects.toThrow(
      "invalid operation data",
    );
    await remote.destroy();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
