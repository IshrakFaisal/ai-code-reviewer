"use client";
import { Component } from "react";
import { Button } from "@/components/ui/button";
import {
  caught,
  completion,
  labeled,
  noiseLevels,
  references,
  verdicts,
  type BlindRun,
  type FindingLabel,
  type PrLabel,
} from "./labels";
import styles from "./labeler.module.css";

type Step = { id: string; pr: PrLabel; finding?: FindingLabel };
type Save = { route: "labels" | "prs"; fields: Record<string, string> };
type State = {
  data: BlindRun;
  cursor: string;
  only: boolean;
  status: "idle" | "saving" | "failed" | "saved";
  metrics: string;
  scoring: boolean;
  scoreError: boolean;
};
function steps(data: BlindRun): Step[] {
  return data.prs.flatMap((pr) => [
    ...data.findings
      .filter((f) => f.pr_url === pr.pr_url)
      .map((finding) => ({ id: finding.finding_key, pr, finding })),
    { id: pr.pr_url, pr },
  ]);
}
function unfinished(step: Step) {
  return step.finding
    ? !labeled(step.finding)
    : !step.pr.caught_known_issue || !step.pr.noise;
}
const names: Record<string, string> = {
  useful: "Useful",
  false_positive: "False positive",
  unclear: "Unclear",
  y: "Yes",
  n: "No",
  yes: "Yes",
  no: "No",
  "n/a": "N/A",
  low: "Low",
  medium: "Medium",
  high: "High",
};
function Choices({
  label,
  values,
  selected,
  change,
  keys,
}: {
  label: string;
  values: readonly string[];
  selected: string;
  change: (value: string) => void;
  keys?: string[];
}) {
  return (
    <fieldset className={styles.choices}>
      <legend>{label}</legend>
      {values.map((v, i) => (
        <Button
          type="button"
          variant={selected === v ? "default" : "outline"}
          aria-pressed={selected === v}
          key={v}
          onClick={() => change(selected === v ? "" : v)}
        >
          {keys && <kbd>{keys[i]}</kbd>}
          {names[v]}
        </Button>
      ))}
    </fieldset>
  );
}
export class Labeler extends Component<{ initial: BlindRun }, State> {
  state: State = {
    data: this.props.initial,
    cursor: steps(this.props.initial)[0]?.id ?? "",
    only: false,
    status: "idle",
    metrics: "",
    scoring: false,
    scoreError: false,
  };
  private pending = new Map<string, Save>();
  private saving = false;
  private disposed = false;
  private revision = 0;
  componentDidMount() {
    this.disposed = false;
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("beforeunload", this.beforeUnload);
  }
  componentWillUnmount() {
    this.disposed = true;
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("beforeunload", this.beforeUnload);
  }
  beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.pending.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  visible() {
    return steps(this.state.data).filter(
      (s) => !this.state.only || unfinished(s) || s.id === this.state.cursor,
    );
  }
  current() {
    const visible = this.visible();
    return visible.find((s) => s.id === this.state.cursor) ?? visible[0];
  }
  move = (direction: number) => {
    const visible = this.visible(),
      active = this.current();
    const next =
      visible[visible.findIndex((s) => s.id === active?.id) + direction];
    if (next) this.setState({ cursor: next.id });
  };
  toggle = () => {
    const only = !this.state.only;
    const available = steps(this.state.data).filter(
      (s) => !only || unfinished(s),
    );
    this.setState({
      only,
      cursor:
        available.find((s) => s.id === this.state.cursor)?.id ??
        available[0]?.id ??
        "",
    });
  };
  keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.isComposing ||
      target?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      event.preventDefault();
      this.move(key === "j" ? 1 : -1);
      return;
    }
    if (!this.current()?.finding) return;
    if (["1", "2", "3"].includes(key)) {
      event.preventDefault();
      this.edit("verdict", verdicts[Number(key) - 1]);
    }
    if (key === "y" || key === "n") {
      event.preventDefault();
      this.edit("invented_reference", key);
    }
  };
  edit = (
    field:
      | "verdict"
      | "invented_reference"
      | "caught_known_issue"
      | "noise"
      | "notes",
    value: string,
  ) => {
    const step = this.current();
    if (!step) return;
    const route = step.finding ? "labels" : "prs";
    const id = step.id;
    const fields = {
      [step.finding ? "finding_key" : "pr_url"]: id,
      [field]: value,
    };
    this.revision++;
    this.pending.set(id + "|" + field, { route, fields });
    this.setState((s) => ({
      data: step.finding
        ? {
            ...s.data,
            findings: s.data.findings.map((f) =>
              f.finding_key === id ? { ...f, [field]: value } : f,
            ),
          }
        : {
            ...s.data,
            prs: s.data.prs.map((p) =>
              p.pr_url === id ? { ...p, [field]: value } : p,
            ),
          },
      status: "saving",
      metrics: "",
      scoreError: false,
    }));
    void this.flush();
  };
  flush = async () => {
    if (this.saving) return;
    this.saving = true;
    if (!this.disposed) this.setState({ status: "saving" });
    try {
      while (this.pending.size) {
        const [key, job] = this.pending.entries().next().value!;
        const res = await fetch(
          "/api/eval/" + this.state.data.run + "/" + job.route,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(job.fields),
          },
        );
        if (!res.ok) throw new Error();
        if (this.pending.get(key) === job) this.pending.delete(key);
      }
    } catch {
      if (!this.disposed) this.setState({ status: "failed" });
      return;
    } finally {
      this.saving = false;
    }
    if (!this.disposed) this.setState({ status: "saved" });
  };
  score = async () => {
    if (this.pending.size || this.state.scoring) return;
    const revision = this.revision;
    this.setState({ scoring: true, scoreError: false });
    try {
      const res = await fetch("/api/eval/" + this.state.data.run + "/score", {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const { metrics } = await res.json();
      if (!this.disposed && revision === this.revision)
        this.setState({ metrics });
    } catch {
      if (!this.disposed) this.setState({ scoreError: true });
    } finally {
      if (!this.disposed) this.setState({ scoring: false });
    }
  };
  render() {
    const { data, status, metrics, scoring, scoreError } = this.state;
    const { labeled: count, percent } = completion(data.findings);
    const visible = this.visible(),
      current = this.current();
    const idx = visible.findIndex((s) => s.id === current?.id);
    const f = current?.finding,
      pr = current?.pr;
    return (
      <div className={styles.workspace}>
        <div className={styles.toolbar}>
          <div>
            <strong>
              {count} of {data.findings.length} findings labeled
            </strong>{" "}
            · {percent}%
            <progress
              aria-label="Finding completion"
              value={percent}
              max={100}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={this.state.only}
              onChange={this.toggle}
            />{" "}
            Unlabeled only
          </label>
          <Button
            variant="outline"
            disabled={scoring || status === "saving" || status === "failed"}
            onClick={this.score}
          >
            {scoring ? "Scoring…" : "Score now"}
          </Button>
        </div>
        {pr && current ? (
          <section className={"panel " + styles.card}>
            <div className={styles.links}>
              <a href={pr.pr_url} target="_blank" rel="noreferrer">
                {pr.pr_url.replace("https://github.com/", "")}
              </a>
              <a href={pr.pr_url + "/files"} target="_blank" rel="noreferrer">
                Files changed ↗
              </a>
            </div>
            {f ? (
              <>
                <p>
                  {f.severity} · {f.evidence_label}
                </p>
                <h2>{f.title}</h2>
                <p className={styles.prose}>
                  {f.description || "Description unavailable for this run."}
                </p>
                <h3>Cited locations</h3>
                <pre>{f.location || "No locations cited."}</pre>
                <Choices
                  label="Verdict"
                  values={verdicts}
                  selected={f.verdict}
                  change={(v) => this.edit("verdict", v)}
                  keys={["1", "2", "3"]}
                />
                <Choices
                  label="Invented reference?"
                  values={references}
                  selected={f.invented_reference}
                  change={(v) => this.edit("invented_reference", v)}
                  keys={["Y", "N"]}
                />
              </>
            ) : (
              <>
                <h2>PR assessment</h2>
                {pr.reverted_by && (
                  <p>
                    Reverted by{" "}
                    <a href={pr.reverted_by} target="_blank" rel="noreferrer">
                      {pr.reverted_by}
                    </a>
                  </p>
                )}
                <Choices
                  label="Caught the known issue?"
                  values={caught}
                  selected={pr.caught_known_issue}
                  change={(v) => this.edit("caught_known_issue", v)}
                />
                <Choices
                  label="Noise"
                  values={noiseLevels}
                  selected={pr.noise}
                  change={(v) => this.edit("noise", v)}
                />
              </>
            )}
            <label className={styles.notes}>
              Notes
              <textarea
                rows={3}
                maxLength={20000}
                value={(f ?? pr).notes}
                onChange={(e) => this.edit("notes", e.target.value)}
              />
            </label>
          </section>
        ) : (
          <p>
            {data.prs.length
              ? "All entries are labeled."
              : "This run has no PRs to label."}
          </p>
        )}
        <div className={styles.toolbar}>
          <Button
            variant="outline"
            disabled={idx <= 0}
            onClick={() => this.move(-1)}
          >
            Previous <kbd>K</kbd>
          </Button>
          <Button
            variant="outline"
            disabled={idx < 0 || idx >= visible.length - 1}
            onClick={() => this.move(1)}
          >
            Next <kbd>J</kbd>
          </Button>
          <span role="status">
            {status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "Saved"
                : status === "failed"
                  ? "Autosave failed. Your edits are still here."
                  : ""}
          </span>
          {status === "failed" && (
            <Button variant="outline" onClick={this.flush}>
              Retry save
            </Button>
          )}
        </div>
        {scoreError && (
          <p role="alert">Scores could not be computed for this run.</p>
        )}
        {metrics && (
          <section className={"panel " + styles.card}>
            <h2>Evaluation scores</h2>
            <p>Indicative only for this labeled sample.</p>
            <pre>{metrics.replace(/^# Evaluation scores\s*/, "")}</pre>
          </section>
        )}
      </div>
    );
  }
}
