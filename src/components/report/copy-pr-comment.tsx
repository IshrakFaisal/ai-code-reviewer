"use client";

import { Component, createRef } from "react";

type Props = { comment: string; hasDrafts: boolean };

type State = { result: "idle" | "copied" | "error" };

export class CopyPrComment extends Component<Props, State> {
  state: State = { result: "idle" };
  private fallback = createRef<HTMLTextAreaElement>();

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.props.comment);
      this.setState({ result: "copied" });
    } catch {
      this.setState({ result: "error" });
    }
  };

  render() {
    const { comment, hasDrafts } = this.props;
    const { result } = this.state;
    return (
      <div className="relative">
        <button type="button" className="text-link" onClick={this.copy}>
          Copy PR comment
        </button>
        <span role="status">{result === "copied" ? " Copied" : ""}</span>
        {hasDrafts && (
          <p className="small-note">Unsaved review drafts are excluded.</p>
        )}
        {result === "error" ? (
          <div>
            <p role="alert">
              Clipboard unavailable. Select the comment and copy it manually.
            </p>
            <textarea
              aria-label="PR comment to copy"
              ref={this.fallback}
              readOnly
              value={comment}
              rows={5}
            />
            <button
              type="button"
              className="text-link"
              onClick={() => {
                this.fallback.current?.focus();
                this.fallback.current?.select();
              }}
            >
              Select all
            </button>
          </div>
        ) : (
          <details>
            <summary className="text-link">Preview comment</summary>
            <textarea
              aria-label="PR comment preview"
              readOnly
              value={comment}
              rows={8}
              className="w-full"
            />
          </details>
        )}
      </div>
    );
  }
}
