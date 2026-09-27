"use client";
import { useState } from "react";
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
export function PRInput({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      parseGitHubInput(input, Number(number));
      setPending(true);
      router.push(
        `/analyze?input=${encodeURIComponent(input.trim())}${number ? `&pr=${number}` : ""}`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="input-panel" id="analyze">
      <div className="input-panel-heading">
        <Github size={20} />
        <h2>What are we reviewing?</h2>
        <span>PUBLIC REPOSITORIES</span>
      </div>
      <form onSubmit={start}>
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
              required
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
              onChange={(e) => setNumber(e.target.value)}
              placeholder="123"
              required
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
        <span>Just exploring? See the agent in action.</span>
        <Button
          variant="ghost"
          size="small"
          onClick={() => router.push("/analyze?demo=true")}
        >
          <Play size={13} fill="currentColor" />
          Run the demo
          <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}
