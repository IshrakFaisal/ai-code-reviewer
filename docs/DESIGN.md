# Workspace interface

AI Change Verifier is an investigation and review workspace. Its interface should help a reviewer distinguish proposed risks, executed evidence, coverage limitations, and their own decisions.

## Visual system

- Warm stone canvas with cream content surfaces and a dark slate sidebar. Burnt-orange primary controls and peach analysis surfaces; sand and clay accents distinguish supporting sections and comparison counts.
- Sidebar text and focus colors are scoped for the dark navigation. Mobile navigation uses the same slate palette. Red/amber/green remain reserved for semantic risk, verification, and diff states.
- Red, amber, and green communicate risk or evidence status. Every status also has a text label. A low score or zero high findings does not imply safety.
- System sans-serif typography for the workspace and a monospace stack for code, diff excerpts, and commit identifiers. No downloaded fonts or decorative imagery.
- A spacing scale of 4, 8, 12, 16, 20, 24, 32, and 40 pixels, with a 1-pixel border and 4–6-pixel component corners. Avoid nested containers where a heading, divider, or row suffices.
- Shared tokens and component states live in `src/app/globals.css`. Buttons reuse the existing Radix/CVA component. Focus, hover, selected, active, and disabled states remain explicit.

## Page composition

- Overview starts with the PR form and real local activity. Recent analyses use the same report-list component as history. Sample material is visibly marked as a demo.
- The sidebar workspace control opens real activity at `/workspace`; repository rows open prefiltered history. The former developer identity is a settings link, also available as a labeled top-bar control. No decorative identity block imitates a working account menu.
- Settings shows configuration presence and setup instructions, without sending provider requests or exposing credentials. The product guide has its own `/how-it-works` route, contents navigation, detailed workflow/evidence explanations, and native stage/FAQ disclosures.
- Accent color emphasizes primary actions and section headers. Neutral form bodies, restrained counters, and aligned navigation keep the workspace useful at higher content density.
- History presents report title, repository, PR, mode, priority, and analysis date in aligned rows. Mobile rows retain the same information and accessible column headers.
- History search combines title/repository/PR/commit terms with mode and priority filters. URL state preserves filters across refresh, browser navigation, and report visits. Empty results provide a clear reset action; only summary metadata is passed to the browser controls.
- Reproduction presents named assertions across base, head, and proposed repair before requiring raw-log inspection. Stable, unstable, missing, and inconclusive outcomes remain distinct. Previous saved evidence is labeled during reruns, and invalid/stale evidence offers recovery without displaying a successful repair state.
- Saved reports offer a fresh analysis and a comparison with earlier runs. Comparisons expose both commit scopes and evidence provenance, and use neutral labels for findings that were not observed again. Rerunning a live report returns to a prefilled PR form before any API call.
- Reports put metadata and scope ahead of findings. The section navigation stays available while scrolling, and its selected state tracks the visible section. Verification checks use rows; findings retain expandable tests, output, and diffs.
- Reviewer notes and decisions have a quiet, distinct treatment. Saving or dismissing a finding does not change its evidence.
- Verification gaps group file-linked execution, static inspection, skipped checks, demo-only evidence, and absent links without implying test coverage. Risk/scope filters and ten-row expansion keep large reports manageable.
- Finding handoff controls sit in a disclosure below the reviewer decision. Draft exports use saved notes; test proposal downloads stay separate and never execute source.
- Progress shows the actual stages and completed count. Errors and retry actions appear before the stage list. Loading and empty states share the same typography and controls.

## Responsive behavior

The full sidebar becomes a compact rail on tablets and a labeled navigation bar on phones. Small-screen layouts stack the form, findings, verification rows, and sample content. Report section navigation scrolls horizontally without creating page overflow. Code wraps inside bounded output regions. Reduced-motion preferences disable transitions and animations.

Use the existing demo and saved real reports for browser verification. Check the workspace, history, report, input errors, interrupted analysis, saved decisions, filters, generated tests, outputs, and exports at desktop, tablet, and mobile widths before extending the design.
