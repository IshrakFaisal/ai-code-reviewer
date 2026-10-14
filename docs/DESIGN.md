# Workspace interface

AI Change Verifier is an investigation and review workspace. Its interface should help a reviewer distinguish proposed risks, executed evidence, coverage limitations, and their own decisions.

## Visual system

- White content surfaces with a warm neutral sidebar. Graphite primary controls; muted green for navigation and supporting surfaces.
- Red, amber, and green communicate risk or evidence status. Every status also has a text label. A low score or zero high findings does not imply safety.
- System sans-serif typography for the workspace and a monospace stack for code, diff excerpts, and commit identifiers. No downloaded fonts or decorative imagery.
- A spacing scale of 4, 8, 12, 16, 20, 24, 32, and 40 pixels, with a 1-pixel border and 4–6-pixel component corners. Avoid nested containers where a heading, divider, or row suffices.
- Shared tokens and component states live in `src/app/globals.css`. Buttons reuse the existing Radix/CVA component. Focus, hover, selected, active, and disabled states remain explicit.

## Page composition

- Overview starts with the PR form and real local activity. Recent analyses use the same report-list component as history. Sample material is visibly marked as a demo.
- History presents report title, repository, PR, mode, priority, and analysis date in aligned rows. Mobile rows retain the same information and accessible column headers.
- Reports put metadata and scope ahead of findings. The section navigation stays available while scrolling, and its selected state tracks the visible section. Verification checks use rows; findings retain expandable tests, output, and diffs.
- Reviewer notes and decisions have a quiet, distinct treatment. Saving or dismissing a finding does not change its evidence.
- Progress shows the actual stages and completed count. Errors and retry actions appear before the stage list. Loading and empty states share the same typography and controls.

## Responsive behavior

The full sidebar becomes a compact rail on tablets and a labeled navigation bar on phones. Small-screen layouts stack the form, findings, verification rows, and sample content. Report section navigation scrolls horizontally without creating page overflow. Code wraps inside bounded output regions. Reduced-motion preferences disable transitions and animations.

Use the existing demo and saved real reports for browser verification. Check the workspace, history, report, input errors, interrupted analysis, saved decisions, filters, generated tests, outputs, and exports at desktop, tablet, and mobile widths before extending the design.
