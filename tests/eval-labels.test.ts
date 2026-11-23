import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  link,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  csv,
  parseCsv,
  scoreFile,
  labelColumns,
  prColumns,
  anchorColumns,
} from "../scripts/eval-score";
import { evaluationStore, evaluations } from "@/app/api/eval/_lib/store";
import { GET as list } from "@/app/api/eval/route";
import { GET as load } from "@/app/api/eval/[run]/route";
import { PATCH as patchLabel } from "@/app/api/eval/[run]/labels/route";
import { PATCH as patchPr } from "@/app/api/eval/[run]/prs/route";
import { POST as scores } from "@/app/api/eval/[run]/score/route";
import RunPage from "@/app/eval/[run]/page";
import ListPage from "@/app/eval/page";
import { config as proxyConfig } from "@/proxy";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const run = "2026-11-23T12-34-56.789Z",
  url = "https://github.com/acme/app/pull/2",
  second = "https://github.com/acme/app/pull/4";
const key = url + "#finding-1",
  other = second + "#finding-2";
const sentinel = "ANCHOR_REASON_FOR_SCORER_ONLY";
const firstRow = [
  key,
  url,
  "AI inference",
  "HIGH",
  "First finding",
  "src/a.ts:2",
  "",
  "",
  "",
];
const otherRow = [
  other,
  second,
  "AI inference",
  "HIGH",
  "Second finding",
  "src/b.ts:4",
  "useful",
  "n",
  "old\nnotes",
];
// Deliberately unconventional (valid) quoting and LF endings on the untouched record.
const unchanged =
  otherRow.map((s) => '"' + s.replaceAll('"', '""') + '"').join(",") + "\n";
let root: string, dir: string, store: ReturnType<typeof evaluationStore>;
const context = (name = run) => ({ params: Promise.resolve({ run: name }) });
function request(method = "GET", data?: unknown, extra: HeadersInit = {}) {
  return new Request("http://localhost/api/eval", {
    method,
    headers: extra,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
const label = (data: unknown) => patchLabel(request("PATCH", data), context());
const pr = (data: unknown) => patchPr(request("PATCH", data), context());
const file = (name: string) => path.join(dir, name);
beforeEach(async () => {
  for (const k of ["APP_ORIGIN", "APP_AUTH_USERNAME", "APP_AUTH_PASSWORD"])
    vi.stubEnv(k, "");
  vi.stubEnv("ENABLE_EVAL_UI", "true");
  root = await mkdtemp(path.join(tmpdir(), "eval-labels-"));
  dir = path.join(root, run);
  await mkdir(dir);
  store = evaluationStore(root);
  vi.spyOn(evaluations, "list").mockImplementation(store.list);
  vi.spyOn(evaluations, "load").mockImplementation(store.load);
  vi.spyOn(evaluations, "scores").mockImplementation(store.scores);
  vi.spyOn(evaluations, "patch").mockImplementation(store.patch);
  await Promise.all([
    writeFile(
      file("labels.csv"),
      "\uFEFF" + csv([labelColumns, firstRow]) + unchanged,
    ),
    writeFile(
      file("prs.csv"),
      csv([prColumns, [url, second, "", "", ""], [second, "", "", "", ""]]),
    ),
    writeFile(
      file("anchors.csv"),
      csv([
        anchorColumns,
        [key, "path-only", "y", "1", sentinel],
        [other, "verified", "y", "2", ""],
      ]),
    ),
    writeFile(
      file("descriptions.json"),
      JSON.stringify({ [key]: "Blind description." }),
    ),
    writeFile(
      file("summary.json"),
      JSON.stringify({
        commit: "a".repeat(40),
        ai: false,
        model: "",
        selected: 2,
        attempts: [],
      }),
    ),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it.each([
  "=text",
  "+text",
  "-text",
  "@text",
  "\ttext",
  "\rtext",
  "   +text",
  "  \ttext",
  " \rtext",
])("guards trigger case %# and recovers the original cell", (text) => {
  const encoded = csv([[text]]);
  expect(encoded.replace(/^"/, "").startsWith("'" + text)).toBe(true);
  expect(parseCsv(encoded)).toEqual([[text]]);
});
it.each(["'original", "'=literal", "''=literal", "'  @literal", 'a,\r\nb"c'])(
  "preserves legitimate text and multiline quoting (%#)",
  (value) => {
    expect(parseCsv(csv([[value]]))).toEqual([[value]]);
  },
);
it("lists only labelable timestamp runs with completed finding counts", async () => {
  await mkdir(path.join(root, "not-a-run"));
  await mkdir(path.join(root, "2026-11-23T13-00-00.000Z"));
  const res = await list(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { run, findings: 2, prs: 2, labeled: 1, percent: 50 },
  ]);
});
it("returns original citations and the blind finding description", async () => {
  const res = await load(request(), context());
  expect(res.status).toBe(200);
  expect((await res.json()).findings[0]).toMatchObject({
    finding_key: key,
    location: "src/a.ts:2",
    description: "Blind description.",
  });
});
it("reads historical runs without descriptions", async () => {
  await rm(file("descriptions.json"));
  expect((await store.load(run)).findings[0].description).toBe("");
});
it("patches a finding, preserves unrelated bytes and scores the same CSV as the CLI", async () => {
  const notes = " \t=sample,\r\nsecond line";
  expect(
    (
      await label({
        finding_key: key,
        verdict: "false_positive",
        invented_reference: "y",
        notes,
      })
    ).status,
  ).toBe(200);
  const raw = await readFile(file("labels.csv"), "utf8");
  expect(raw.startsWith("\uFEFF")).toBe(true);
  expect(raw.endsWith(unchanged)).toBe(true);
  expect(raw).toContain("\"' " + "\t=sample");
  expect(parseCsv(raw)[1].slice(-3)).toEqual(["false_positive", "y", notes]);
  const response = await scores(request("POST"), context());
  expect(response.status).toBe(200);
  const metrics = (await response.json()).metrics;
  expect(metrics).toBe(await scoreFile(file("labels.csv")));
  expect(metrics).toContain("Overall precision: 0.500 (1/2, n=2)");
});
it("patches the PR assessment and keeps its revert link and the next PR intact", async () => {
  expect(
    (
      await pr({
        pr_url: url,
        caught_known_issue: "yes",
        noise: "medium",
        notes: "-note",
      })
    ).status,
  ).toBe(200);
  expect(parseCsv(await readFile(file("prs.csv"), "utf8"))).toEqual([
    prColumns,
    [url, second, "yes", "medium", "-note"],
    [second, "", "", "", ""],
  ]);
});
it("preserves both concurrent partial updates", async () => {
  await Promise.all([
    label({ finding_key: key, verdict: "unclear" }),
    label({ finding_key: key, invented_reference: "n" }),
  ]);
  expect((await store.load(run)).findings[0]).toMatchObject({
    verdict: "unclear",
    invented_reference: "n",
  });
});
it("keeps the original byte-for-byte on failed atomic replacement and cleans up the temp", async () => {
  const original = await readFile(file("labels.csv"));
  const broken = evaluationStore(root, async (temp, dest) => {
    expect(path.dirname(String(temp))).toBe(dir);
    expect(dest).toBe(file("labels.csv"));
    expect(await readFile(temp, "utf8")).toContain("unclear");
    throw new Error("Simulated failure");
  });
  await expect(
    broken.patch(run, "labels", { finding_key: key, verdict: "unclear" }),
  ).rejects.toThrow("Simulated failure");
  expect(await readFile(file("labels.csv"))).toEqual(original);
  expect((await readdir(dir)).some((s) => s.endsWith(".tmp"))).toBe(false);
});
it.each([
  { verdict: "ok" },
  { invented_reference: "yes" },
  { title: "changed" },
  {},
  { notes: 1 },
])("rejects an invalid finding patch (%#)", async (update) => {
  expect((await label({ finding_key: key, ...update })).status).toBe(400);
});
it.each([
  { caught_known_issue: "maybe" },
  { noise: "none" },
  { reverted_by: second },
])("rejects invalid PR changes (%#)", async (update) => {
  expect((await pr({ pr_url: url, ...update })).status).toBe(400);
});
it.each([
  "..",
  "%2e%2e",
  "..%2Foutside",
  "/tmp/outside",
  "C:\\outside",
  run + "/other",
  "2026-02-31T12-34-56.789Z",
])("rejects a non-run directory (%#)", async (name) => {
  for (const response of [
    await load(request(), context(name)),
    await scores(request("POST"), context(name)),
    await patchLabel(
      request("PATCH", { finding_key: key, notes: "x" }),
      context(name),
    ),
    await patchPr(request("PATCH", { pr_url: url, notes: "x" }), context(name)),
  ])
    expect(response.status).toBe(400);
});
it("does not follow a linked run or read a hardlinked CSV", async () => {
  const otherRun = "2026-11-22T12-34-56.789Z";
  await symlink(dir, path.join(root, otherRun), "junction");
  expect((await load(request(), context(otherRun))).status).toBe(400);
  await link(file("labels.csv"), file("copy.csv"));
  expect((await load(request(), context())).status).toBe(422);
});
it("returns 404 for unknown runs and rows", async () => {
  expect(
    (await load(request(), context("2026-11-22T12-34-56.789Z"))).status,
  ).toBe(404);
  expect((await label({ finding_key: "missing", notes: "x" })).status).toBe(
    404,
  );
  expect((await pr({ pr_url: second + "9", notes: "x" })).status).toBe(404);
});
async function all() {
  return Promise.all([
    list(request()),
    load(request(), context()),
    label({ finding_key: key, notes: "x" }),
    pr({ pr_url: url, notes: "x" }),
    scores(request("POST"), context()),
  ]);
}
it("disables both pages and all API handlers before filesystem access", async () => {
  vi.stubEnv("ENABLE_EVAL_UI", undefined);
  expect((await all()).map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  for (const page of [ListPage(), RunPage(context())])
    await expect(page).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  for (const method of Object.values(evaluations))
    expect(method).not.toHaveBeenCalled();
});
it.each([401, 403, 503])(
  "uses the existing owner boundary on every handler (%i)",
  async (status) => {
    if (status === 403) vi.stubEnv("APP_ORIGIN", "https://review.example");
    else {
      vi.stubEnv("APP_AUTH_USERNAME", "owner");
      vi.stubEnv(
        "APP_AUTH_PASSWORD",
        status === 401 ? "long-enough-password-for-testing" : "short",
      );
    }
    for (const res of await all()) expect(res.status).toBe(status);
  },
);
it("rejects cross-origin writes and oversized JSON", async () => {
  const body = { finding_key: key, notes: "x" };
  expect(
    (
      await patchLabel(
        request("PATCH", body, { origin: "https://other.example" }),
        context(),
      )
    ).status,
  ).toBe(403);
  expect((await label({ ...body, notes: "a".repeat(131073) })).status).toBe(
    413,
  );
});
it("matches the unmodified proxy on both page and API prefixes", () => {
  for (const url of [
    "/eval",
    "/eval/" + run,
    "/api/eval",
    "/api/eval/" + run + "/labels",
  ])
    expect(
      unstable_doesMiddlewareMatch({
        config: proxyConfig,
        nextConfig: {},
        url,
      }),
    ).toBe(true);
});
it("keeps anchor data out of page markup, serialized client props, and every API response", async () => {
  const page = await RunPage(context());
  const detail = renderToStaticMarkup(page);
  expect(detail).toContain("Blind description.");
  expect(detail).toContain(url + "/files");
  const responses = await all();
  const output = [
    detail,
    JSON.stringify(page.props.children.at(-1).props.initial),
    renderToStaticMarkup(await ListPage()),
    ...(await Promise.all(responses.map((r) => r.text()))),
  ].join("\n");
  for (const hidden of [
    sentinel,
    "anchor_status",
    "shown_in_comment",
    "comment_rank",
    "path-only",
  ])
    expect(output).not.toContain(hidden);
});
