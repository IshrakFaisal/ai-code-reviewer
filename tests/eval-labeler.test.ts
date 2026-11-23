import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Labeler } from "@/components/eval/labeler";
import type { BlindRun } from "@/components/eval/labels";

const url = "https://github.com/team/example/pull/1";
function mount() {
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ saved: true }));
  vi.stubGlobal("fetch", send);
  const initial: BlindRun = {
    run: "2026-11-23T12-00-00.000Z",
    prs: [
      {
        pr_url: url,
        reverted_by: "",
        caught_known_issue: "",
        noise: "",
        notes: "",
      },
    ],
    findings: [1, 2].map((n) => ({
      pr_url: url,
      finding_key: url + "#f" + n,
      evidence_label: "AI inference",
      severity: "HIGH",
      title: "Finding " + n,
      description: "Example description",
      location: "example.ts:4",
      verdict: n === 1 ? "" : "useful",
      invented_reference: n === 1 ? "" : "n",
      notes: "",
    })),
  };
  const component = new Labeler({ initial });
  vi.spyOn(component, "setState").mockImplementation((update, cb) => {
    Object.assign(
      component.state,
      typeof update === "function"
        ? update(component.state, component.props)
        : update,
    );
    cb?.();
  });
  component.componentDidMount();
  const key = (key: string) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key,
    });
    events.dispatchEvent(event);
  };
  return {
    component,
    send,
    key,
    html: () => renderToStaticMarkup(component.render()),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("maps each verdict and reference key to its CSV value and autosaves the selected finding", async () => {
  const { component, send, key } = mount();
  for (const [keyboard, field, value] of [
    ["1", "verdict", "useful"],
    ["2", "verdict", "false_positive"],
    ["3", "verdict", "unclear"],
    ["Y", "invented_reference", "y"],
    ["n", "invented_reference", "n"],
  ] as const) {
    key(keyboard);
    await vi.waitFor(() => expect(component.state.status).toBe("saved"));
    expect(component.current()?.finding?.[field]).toBe(value);
    const [endpoint, init] = send.mock.lastCall!;
    expect(endpoint).toBe("/api/eval/" + component.state.data.run + "/labels");
    expect(JSON.parse(String(init?.body))).toEqual({
      finding_key: url + "#f1",
      [field]: value,
    });
  }
  component.componentWillUnmount();
  key("1");
  expect(send).toHaveBeenCalledTimes(5);
});
it("navigates in PR order and filters completed findings while keeping the PR assessment reachable", async () => {
  const { component, key, html, send } = mount();
  key("j");
  expect(html()).toContain("Finding 2");
  key("K");
  expect(html()).toContain("Finding 1");
  component.toggle();
  key("J");
  expect(html()).toContain("PR assessment");
  component.edit("caught_known_issue", "n/a");
  component.edit("noise", "low");
  component.edit("notes", "Reviewed");
  await vi.waitFor(() => expect(component.state.status).toBe("saved"));
  expect(String(send.mock.lastCall?.[0])).toMatch(/\/prs$/);
  key("k");
  expect(html()).toContain("Finding 1");
  expect(html()).not.toContain("Finding 2");
});
it("keeps the selected value after autosave fails and retries the same edit", async () => {
  const { component, key, html, send } = mount();
  send.mockResolvedValueOnce(new Response(null, { status: 500 }));
  key("2");
  await vi.waitFor(() => expect(html()).toContain("Autosave failed"));
  expect(component.current()?.finding?.verdict).toBe("false_positive");
  expect(html()).toContain("Retry save");
  await component.score();
  expect(send).toHaveBeenCalledTimes(1);
  await component.flush();
  expect(component.state.status).toBe("saved");
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
it("saves the latest notes even when another edit arrives during the first request", async () => {
  const { component, send } = mount();
  let complete!: (r: Response) => void;
  send.mockReturnValueOnce(
    new Promise((r) => {
      complete = r;
    }),
  );
  component.edit("notes", "a");
  component.edit("notes", "ab");
  component.edit("notes", "abc");
  expect(send).toHaveBeenCalledTimes(1);
  complete(Response.json({ saved: true }));
  await vi.waitFor(() => expect(component.state.status).toBe("saved"));
  expect(send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(send.mock.lastCall?.[1]?.body)).notes).toBe("abc");
});
it("leaves text editing shortcuts alone and renders aggregate scores with the caveat", async () => {
  const { component, send, html } = mount();
  component.keydown({
    key: "2",
    target: { tagName: "TEXTAREA" },
  } as unknown as KeyboardEvent);
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValueOnce(
    Response.json({
      metrics: "# Evaluation scores\n\n- Overall precision: n/a",
    }),
  );
  await component.score();
  expect(send.mock.calls[0][0]).toBe(
    "/api/eval/" + component.state.data.run + "/score",
  );
  expect(html()).toContain("Indicative only");
  expect(html()).toContain("Overall precision");
});
