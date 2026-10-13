import { z } from "zod";

const uuid = z.string().regex(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
const stream = z.object({
  value: z.string(),
  encoding: z.enum(["ascii", "base64"]),
  truncated: z.boolean().optional(),
});
const instanceResult = z.object({
  state: z.object({
    exit_code: z.number().int().optional(),
    signal: z.number().int().optional(),
    timed_out: z.boolean().optional(),
  }),
  stdout: stream,
  stderr: stream,
});
const operation = z.object({
  uuid,
  kind: z.literal("instance"),
  status: z.enum([
    "PENDING",
    "ASSIGNED",
    "EXECUTING",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
  ]),
  result_image_uuid: uuid.nullish(),
  metadata: z.object({ result: instanceResult.nullish() }).optional(),
});

export interface ContreeConfiguration {
  token: string;
  projectId: string;
  baseUrl: string;
  image: string;
}

function validatedConfiguration(
  config: ContreeConfiguration,
): ContreeConfiguration {
  if (
    !config.token ||
    config.token.length > 8192 ||
    /\s|[\u0000-\u001f\u007f]/.test(config.token)
  )
    throw new Error("Set NEBIUS_SANDBOX_TOKEN to a valid Nebius IAM token.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(config.projectId))
    throw new Error("Set NEBIUS_SANDBOX_PROJECT_ID to the Nebius project ID.");
  if (!uuid.safeParse(config.image).success)
    throw new Error(
      "Set NEBIUS_SANDBOX_IMAGE to an immutable imported image UUID.",
    );
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new Error(
      "NEBIUS_SANDBOX_BASE_URL must be a clean HTTPS base URL without /v1.",
    );
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    /\/v1\/?$/.test(base.pathname)
  )
    throw new Error(
      "NEBIUS_SANDBOX_BASE_URL must be a clean HTTPS base URL without /v1.",
    );
  return { ...config, baseUrl: base.href.replace(/\/+$/, "") };
}

export function contreeConfiguration(
  env: Record<string, string | undefined> = process.env,
): ContreeConfiguration {
  return validatedConfiguration({
    token: env.NEBIUS_SANDBOX_TOKEN || "",
    projectId: env.NEBIUS_SANDBOX_PROJECT_ID || "",
    baseUrl:
      env.NEBIUS_SANDBOX_BASE_URL ||
      "https://api.tokenfactory.nebius.com/sandboxes",
    image: env.NEBIUS_SANDBOX_IMAGE || "",
  });
}

export interface ContreeExecution {
  image?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  networking: boolean;
  disposable?: boolean;
  timeoutSeconds?: number;
  outputLimitBytes?: number;
  maxLayerBytes?: number;
  stdin?: string;
}

export interface ContreeResult {
  operationId: string;
  imageId?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

interface ClientOptions {
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  operationTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

class ContreeError extends Error {}
class ContreeHttpError extends ContreeError {
  constructor(readonly status: number) {
    super(
      `Nebius sandbox request failed (HTTP ${status}).${status === 429 ? " Rate limit reached; retry later." : ""}`,
    );
  }
}

function aborted(signal: AbortSignal) {
  if (signal.aborted)
    throw new ContreeError(
      "Nebius sandbox request was cancelled or timed out.",
    );
}

async function pause(ms: number, signal: AbortSignal) {
  aborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(
        new ContreeError("Nebius sandbox request was cancelled or timed out."),
      );
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ContreeError("Nebius sandbox returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      aborted(signal);
      const { done, value } = await reader.read();
      aborted(signal);
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        void reader.cancel().catch(() => {});
        throw new ContreeError(
          "Nebius sandbox response exceeded the size limit.",
        );
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ContreeError) throw error;
    throw new ContreeError("Nebius sandbox returned invalid response data.");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function decode(value: z.infer<typeof stream>, limit: number) {
  let data: Buffer;
  if (value.encoding === "base64") {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.value,
      )
    )
      throw new ContreeError("Nebius sandbox returned invalid encoded output.");
    data = Buffer.from(value.value, "base64");
  } else {
    data = Buffer.from(value.value, "utf8");
  }
  return {
    text: data.subarray(0, limit).toString("utf8"),
    truncated: !!value.truncated || data.length > limit,
  };
}

/** Documented ConTree /v1 protocol; only the server receives IAM credentials. */
export class ContreeClient {
  readonly config: ContreeConfiguration;
  readonly operationIds = new Set<string>();
  private readonly active = new Set<string>();
  private readonly options: Required<ClientOptions>;

  constructor(
    config: ContreeConfiguration,
    private readonly signal?: AbortSignal,
    private readonly transport: typeof fetch = fetch,
    options: ClientOptions = {},
  ) {
    this.config = validatedConfiguration(config);
    this.options = {
      pollIntervalMs: 750,
      requestTimeoutMs: 15000,
      operationTimeoutMs: 0,
      cleanupTimeoutMs: 5000,
      ...options,
    };
  }

  private async request(
    path: string,
    method: string,
    signal: AbortSignal,
    body?: unknown,
  ) {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.options.requestTimeoutMs),
    ]);
    aborted(requestSignal);
    try {
      const response = await this.transport(
        `${this.config.baseUrl}/v1${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Project: this.config.projectId,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          cache: "no-store",
          signal: requestSignal,
        },
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (method === "DELETE" && response.status === 404) return undefined;
        throw new ContreeHttpError(response.status);
      }
      if (method === "DELETE") {
        void response.body?.cancel().catch(() => {});
        return undefined;
      }
      return await boundedJson(response, requestSignal);
    } catch (error) {
      if (error instanceof ContreeError) throw error;
      throw new ContreeError(
        requestSignal.aborted
          ? "Nebius sandbox request was cancelled or timed out."
          : "Nebius sandbox could not complete the request.",
      );
    }
  }

  private async cancel(id: string) {
    const cleanupSignal = AbortSignal.timeout(this.options.cleanupTimeoutMs);
    try {
      await this.request(`/operations/${id}`, "DELETE", cleanupSignal);
    } catch (error) {
      if (!(error instanceof ContreeHttpError) || error.status !== 409)
        throw error;
      // Completion can race cancellation. A conflict alone does not prove termination.
      const final = operation.safeParse(
        await this.request(`/operations/${id}`, "GET", cleanupSignal),
      );
      if (
        !final.success ||
        final.data.uuid !== id ||
        !["SUCCESS", "FAILED", "CANCELLED"].includes(final.data.status)
      )
        throw new ContreeError(
          "Nebius sandbox cancellation could not be confirmed.",
        );
    }
    // Cancellation is accepted asynchronously; the server execution deadline remains a backstop.
    this.active.delete(id);
  }

  async execute(spec: ContreeExecution): Promise<ContreeResult> {
    const image = spec.image || this.config.image;
    const timeout = spec.timeoutSeconds ?? 60;
    const limit = spec.outputLimitBytes ?? 32768;
    const layer = spec.maxLayerBytes ?? 1_610_612_736;
    if (
      !uuid.safeParse(image).success ||
      !spec.command ||
      spec.command.length > 4096 ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 600 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 512000 ||
      !Number.isInteger(layer) ||
      layer < 1 ||
      layer > 12_884_901_888
    )
      throw new ContreeError("Invalid Nebius sandbox execution configuration.");
    const parentSignals = this.signal ? [this.signal] : [];
    const signal = AbortSignal.any([
      ...parentSignals,
      AbortSignal.timeout(
        this.options.operationTimeoutMs || (timeout + 30) * 1000,
      ),
    ]);
    aborted(signal);
    let id: string | undefined;
    const started = Date.now();
    try {
      const created = z.object({ uuid }).safeParse(
        await this.request("/instances", "POST", signal, {
          image,
          command: spec.command,
          args: spec.args ?? [],
          shell: false,
          env: spec.env ?? {},
          preserve_env: false,
          cwd: spec.cwd ?? "/tmp/change-verifier",
          uid: 1000,
          gid: 1000,
          timeout,
          truncate_output_at: limit,
          resources_limits: { max_layer_bytes: layer },
          networking: { enabled: spec.networking },
          disposable: spec.disposable ?? false,
          ...(spec.stdin === undefined
            ? {}
            : {
                stdin: {
                  value: Buffer.from(spec.stdin).toString("base64"),
                  encoding: "base64",
                  close: true,
                },
              }),
        }),
      );
      if (!created.success)
        throw new ContreeError(
          "Nebius sandbox returned an invalid operation ID.",
        );
      id = created.data.uuid;
      this.operationIds.add(id);
      this.active.add(id);
      while (true) {
        const parsed = operation.safeParse(
          await this.request(`/operations/${id}`, "GET", signal),
        );
        if (!parsed.success || parsed.data.uuid !== id)
          throw new ContreeError(
            "Nebius sandbox returned invalid operation data.",
          );
        const current = parsed.data;
        if (["SUCCESS", "FAILED", "CANCELLED"].includes(current.status)) {
          this.active.delete(id);
          if (current.status === "CANCELLED")
            throw new ContreeError("Nebius sandbox operation was cancelled.");
          const result = current.metadata?.result;
          if (!result)
            throw new ContreeError(
              "Nebius sandbox operation failed without a command result.",
            );
          const out = decode(result.stdout, limit);
          const err = decode(result.stderr, limit);
          const timedOut = result.state.timed_out === true;
          const signalled = (result.state.signal ?? 0) > 0;
          const code = result.state.exit_code;
          const truncated = out.truncated || err.truncated;
          const exitCode =
            timedOut ||
            signalled ||
            truncated ||
            code === undefined ||
            code < 0 ||
            current.status === "FAILED"
              ? code && code > 0
                ? code
                : 1
              : code;
          // A missing checkpoint is a provider failure even if the command itself exited zero.
          if (!spec.disposable && !current.result_image_uuid && exitCode === 0)
            throw new ContreeError(
              "Nebius sandbox did not return the required filesystem checkpoint.",
            );
          return {
            operationId: id,
            imageId: current.result_image_uuid || undefined,
            stdout: out.text,
            stderr: err.text,
            exitCode,
            timedOut,
            truncated,
            durationMs: Date.now() - started,
          };
        }
        await pause(this.options.pollIntervalMs, signal);
      }
    } catch (error) {
      if (id && this.active.has(id)) {
        try {
          await this.cancel(id);
        } catch {
          throw new ContreeError(
            "Nebius sandbox execution failed and cancellation could not be confirmed. Its server deadline limits execution; retry cleanup.",
          );
        }
      }
      if (error instanceof ContreeError) throw error;
      throw new ContreeError("Nebius sandbox execution failed.");
    }
  }

  async destroy() {
    const failures: string[] = [];
    for (const id of this.active) {
      try {
        await this.cancel(id);
      } catch {
        failures.push(id);
      }
    }
    if (failures.length)
      throw new ContreeError(
        "Nebius sandbox cancellation could not be confirmed. The server execution deadline still applies.",
      );
  }
}
