"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Github,
  Link2,
  LockKeyhole,
  Play,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseGitHubInput } from "@/lib/github/input";
export function PRInput({
  demo,
  initialInput = "",
}: {
  demo: boolean;
  initialInput?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialInput);
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      parseGitHubInput(input, Number(number));
      startTransition(() =>
        router.push(
          `/analyze?input=${encodeURIComponent(input.trim())}${number ? `&pr=${number}` : ""}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="input-panel" id="analyze">
      <div className="input-panel-heading">
        <Github size={19} />
        <div>
          <h2>Start a new analysis</h2>
          <p>
            {initialInput
              ? "Review the URL below and start a fresh investigation of the latest PR revision."
              : "Paste a public pull request URL to investigate its changes."}
          </p>
        </div>
        <span>Public repositories</span>
      </div>
      <form onSubmit={start} aria-busy={pending}>
        <label htmlFor="pr-url">GitHub pull request</label>
        <div className="input-row">
          <div className="input-wrap">
            <Link2 size={18} />
            <input
              id="pr-url"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              autoComplete="off"
              maxLength={300}
              disabled={pending}
              required
              aria-invalid={!!error}
              aria-describedby={error ? "input-error" : "input-help"}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Opening analysis…" : "Analyze Pull Request"}
            <ArrowRight size={17} />
          </Button>
        </div>
        {input && !/\/pull\//.test(input) && (
          <div className="pr-number">
            <label htmlFor="pr-number">Pull request number</label>
            <input
              id="pr-number"
              type="number"
              min="1"
              max="2147483647"
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setError("");
              }}
              placeholder="123"
              required
              disabled={pending}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="form-error" id="input-error">
            <AlertCircle size={16} />
            {error}
          </p>
        )}
        <p className="input-help" id="input-help">
          <LockKeyhole size={13} />
          {demo
            ? "Demo mode uses the sample PR. No credentials or repository access required."
            : "Read-only GitHub access. Your tokens stay on the server."}
        </p>
      </form>
      <div className="input-bottom">
        <span>Try a sample investigation without credentials.</span>
        <Button
          variant="ghost"
          size="small"
          disabled={pending}
          onClick={() =>
            startTransition(() => router.push("/analyze?demo=true"))
          }
        >
          <Play size={13} />
          Run the demo
          <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}
