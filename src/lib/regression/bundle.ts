import { generatedPlan } from "@/lib/sandbox/commands";
import { repairDiff } from "./patch";
import type { RegressionResult } from "./types";

export function reproductionBundle(
  result: RegressionResult,
  repository: { owner: string; repo: string },
) {
  const files: Record<string, string> = {};
  files["evidence.json"] = JSON.stringify(result, null, 2);
  files[result.test.filename] = result.test.code;
  if (result.repair?.proposal)
    files["proposed-repair.diff"] = repairDiff(result.repair.proposal);
  if (result.mode === "DEMO") {
    if (result.fixtureSources) {
      files["fixture-base.mjs"] = result.fixtureSources.base;
      files["fixture-head.mjs"] = result.fixtureSources.head;
      files["fixture-repaired.mjs"] = result.fixtureSources.repaired;
    }
    files["README.md"] =
      "# Synthetic fixture reproduction\n\nThis bundle does not verify a GitHub repository or establish AI accuracy.\n\nRun `npm run evaluate:regressions` in the AI Change Verifier project for all five curated cases. The runner executes trusted Node assertions, not Vitest.\n\nIf fixture sources are included, concatenate each source with the unchanged fixture-regression.test.mjs assertion into a fresh .mjs file and run it with Node. The original and repaired variants should pass; the head variant should fail its token-reuse assertion.\n\nThe synthetic report commit identifiers are illustrative, not actual Git revisions. No build, typecheck, repository tests, or live inference is represented.\n";
  } else {
    if (
      !/^[A-Za-z0-9_.-]+$/.test(repository.owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repository.repo) ||
      !/^([a-f0-9]{40})$/.test(result.baseSha) ||
      !/^([a-f0-9]{40})$/.test(result.headSha)
    )
      throw new Error("Invalid immutable reproduction scope.");
    const plan = generatedPlan("regression.test.ts");
    files[".change-verifier/regression.test.ts"] = result.test.code;
    files[plan.config] = plan.content;
    files["README.md"] =
      `# Behavioral regression reproduction\n\nRepository: ${repository.owner}/${repository.repo}\nBase: ${result.baseSha}\nHead: ${result.headSha}\nTest SHA-256: ${result.test.sha256}\nRecorded provider: ${result.provider}\n\n## Execution environment\n\nUse the same isolated Docker/Nebius image, Node version, and locked dependencies at both revisions. Compare environmentHash values in evidence.json. Each test ran twice; changed dependencies, missing scripts, runtime exceptions, and unstable results are inconclusive. Review the expected behavior and test validity.\n\n## Repeat for each revision\n\nUse a fresh disposable checkout for each of two runs at base and two at head. Replace COMMIT below with the exact base or head SHA above. Run dependency installation with networking, then disable networking for verification. Never inject app credentials.\n\n\`\`\`sh\ngit clone --no-checkout --depth=1 https://github.com/${repository.owner}/${repository.repo}.git verifier-checkout\ncd verifier-checkout\ngit fetch --depth=1 origin COMMIT\ngit checkout --detach COMMIT\ngit rev-parse HEAD\n\`\`\`\n\nInstall the root lockfile without lifecycle scripts: npm uses \`npm ci --ignore-scripts --no-audit --no-fund\`; pnpm uses its exact packageManager version with \`install --frozen-lockfile --ignore-scripts --ignore-pnpmfile\`; Yarn uses the frozen/immutable, no-build installation described in src/lib/sandbox/commands.ts. Never regenerate a lockfile.\n\nCopy the two .change-verifier files from this bundle into the checkout. The test must be byte-for-byte identical at both commits. Then run:\n\n\`\`\`sh\nnode node_modules/vitest/vitest.mjs run --config .change-verifier/regression.config.mjs --reporter=json --outputFile .change-verifier/regression.report.json\n\`\`\`\n\nInspect the JSON assertion results. An exit code alone is not sufficient evidence. Both repeats must agree and assertion identities must match across commits.\n\n## Proposed repair\n\nIf present, proposed-repair.diff changes application source only. Review it, apply it only in a fresh isolated head checkout, run the unchanged regression test twice, then run the declared build, typecheck, and existing-test scripts. The original file hashes and complete before/after source are retained in evidence.json. No patch has been committed, merged, or posted to GitHub.\n\nPassing these checks supports only this test and recorded scope; it does not establish complete coverage or merge safety.\n`;
  }
  return { format: "change-verifier-reproduction-v1", files };
}
