# Walk through a demo investigation

Start the app with `npm run dev`, open [the local workspace](http://127.0.0.1:3000), and select **Run the demo**. The sample PR changes password recovery. Its findings are curated, and its verification step launches a local Node process against the bundled fixture.

## From a finding to a comment

1. Follow the stages on the progress page. When the report opens, check the demo label, review priority, and execution summary.
2. In **Findings**, open **Password reset token reuse**. In **Verification**, inspect the failed assertion: the fixture tries to reset a password twice with the same token and expects the second request to be rejected. Its output shows that the second request succeeded.
3. In **Workbench**, inspect the reset handler's diff. **Change impact** identifies affected areas. **Evidence gaps** shows where repository execution is missing. A fixture result applies only to the bundled scenario.
4. In **Your review**, enter a decision and note, then save. Compare **Next steps** with **Activity** to see planned reviewer work and recorded analysis stages. Saved decisions are separate from the underlying evidence.
5. In the report header, open **Preview comment**, then choose **Copy PR comment**. Look for **Copied**. If clipboard access fails, use **Select all** and copy manually. The comment uses saved decisions and excludes unsaved drafts. Paste and publish it yourself if appropriate.
6. Open **Reproduce & repair** on the token-reuse finding. Choose **Run base/head comparison**, inspect both repeats, then **Run fixture repair** and compare the same assertion again. **Evidence bundle (JSON)** downloads the recorded comparison. Both revisions and the repair in this walkthrough are curated.

## Find a run after leaving the page

Start another demo and select **Pause analysis** while it is running. If it finishes first, it appears among completed reports. Go to **History** and look above the completed reports for **Unfinished analyses**.

| Action | What happens |
| --- | --- |
| **Open** | Returns to that run's progress page. Refreshing reconnects using the run ID. |
| **Resume** | Continues a paused or interrupted run from its saved checkpoint. After a restart, History shows a checkpoint marked running as interrupted if this process has no active job for it. |
| **Discard** | Asks for confirmation, then removes the inactive checkpoint. The discarded run can no longer resume. Pause an active run first. |

The section appears when there are unfinished runs or unreadable checkpoints. A running row enables polling. Unreadable checkpoints are reported separately.

## Try the same output in a terminal

```sh
npm run --silent review -- --demo
npm run --silent review -- --demo --format json --out report.json
```

For a live report, use the [integration guide](INTEGRATIONS.md). Live findings distinguish verified locations, path-only locations, and unanchored citations. The PR comment lists eligible findings and counts unanchored omissions. The [validation record](VALIDATION.md) identifies which workflows were exercised.
