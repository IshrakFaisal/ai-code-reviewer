# Submission screenshot checklist

Capture these from the running application after starting `npm run dev`.

1. **Workspace / landing page** — review workspace, PR input, recent analyses, three-step workflow and sample investigation. Suggested filename: `workspace.png`.
2. **Investigation progress** — click Run the demo and capture the numbered stages and live action log. Suggested filename: `investigation.png`.
3. **Evidence-backed report** — include the DEMO MODE notice, risk map, token-reuse finding and expanded failed assertion output. Suggested filename: `report.png`.

For a fourth capture, expand the AI-generated test template. Keep the demo/source labels visible in submission screenshots so the fixture evidence cannot be mistaken for verification of a real repository.

For follow-up review, capture **Compare runs** on a later saved report, with both commits and the finding counts visible. Capture **Analysis history** with a repository search and a mode filter. These features work with saved local reports and do not require another inference request.

These are capture placeholders, not fabricated screenshots. No image-generation model was used to simulate the application.

Capture the dedicated **How it works** page with its contents navigation and workflow detail. **Local workspace** should show actual repository activity, and **Settings & integrations** should show configuration states without credential values.

For the evidence-to-action workflow, capture **Verification gaps** with the high-risk gap filter and one expanded file. Capture **Finding handoff & test proposal** with the saved decision and available draft/test downloads. Retain the demo and provenance labels.

Capture **Reproduce & repair** after running the base/head comparison and fixture repair. Show the original PASS, changed FAIL, and repaired PASS results, the repeated runs, and the visible synthetic-fixture notice. For a live run, show exact commits, environment fingerprints, and repository checks instead; never present the fixture as a live GitHub regression.
