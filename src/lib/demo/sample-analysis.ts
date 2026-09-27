import type { PullRequest, Hypothesis, Behavior } from "@/lib/types";
import { parseDiff } from "@/lib/github/diff";
import { categorize } from "@/lib/analysis/categorizer";
import { assessRisk } from "@/lib/risk/engine";

const sampleFiles: [string, number, number, string][] = [
  [
    "src/auth/reset.ts",
    104,
    22,
    `@@ -80,5 +80,12 @@\n export async function resetPassword(token, password) {\n-  validateResetRequest(token, password);\n+  const record = await tokens.findUnique({ where: { token } });\n+  if (!record || record.expiresAt <= new Date()) {\n+    return { status: 400, error: "Invalid or expired token" };\n+  }\n+  await users.update({\n+    where: { id: record.userId },\n+    data: { password: await hash(password) },\n+  });\n+  return { status: 200 };\n }`,
  ],
  [
    "src/auth/token.ts",
    86,
    9,
    `@@ -20,3 +20,9 @@\n export async function issueResetToken(userId) {\n+  const token = randomBytes(32).toString("hex");\n+  await tokens.create({ data: {\n+    token, userId,\n+    expiresAt: new Date(Date.now() + 3600000),\n+  } });\n+  return token;\n }`,
  ],
  [
    "prisma/schema.prisma",
    32,
    4,
    `@@ -40,1 +40,9 @@\n+model ResetToken {\n+  id        String   @id @default(cuid())\n+  token     String   @unique\n+  userId    String\n+  expiresAt DateTime\n+  user      User     @relation(fields: [userId], references: [id])\n+  @@index([userId])\n+}\n `,
  ],
  [
    "src/email/reset.ts",
    92,
    12,
    `@@ -1,0 +1,5 @@\n+export async function sendResetEmail(to, token) {\n+  const url = process.env.APP_URL + "/reset?token=" + token;\n+  await mailer.send({ to, template: "reset-password", url });\n+  return { sent: true };\n+}`,
  ],
  [
    "src/api/users.ts",
    98,
    35,
    `@@ -60,2 +60,5 @@\n export async function requestReset(email) {\n+  const user = await users.findUnique({ where: { email } });\n+  if (user) await sendResetEmail(user.email, await issueResetToken(user.id));\n+  return { message: "If this email exists, a reset link has been sent." };\n }`,
  ],
  [
    "src/components/reset-form.tsx",
    145,
    18,
    `@@ -1,0 +1,3 @@\n+export function ResetForm() {\n+  return <form aria-label="Reset password"><input type="password" /></form>;\n+}`,
  ],
  [
    "src/app/reset/page.tsx",
    78,
    0,
    `@@ -1,0 +1,1 @@\n+export default function Page() { return <ResetForm />; }`,
  ],
  [
    "src/app/forgot/page.tsx",
    65,
    0,
    `@@ -1,0 +1,1 @@\n+export default function Page() { return <ForgotPasswordForm />; }`,
  ],
  [
    "tests/auth/reset.test.ts",
    121,
    25,
    `@@ -1,0 +1,2 @@\n+test("rejects an expired token", expiredTokenTest);\n+test("rejects an invalid token", invalidTokenTest);`,
  ],
  [
    "tests/api/users.test.ts",
    54,
    10,
    `@@ -1,0 +1,1 @@\n+test("returns a neutral reset message", neutralResponseTest);`,
  ],
  [
    "src/components/input.tsx",
    24,
    15,
    `@@ -5,1 +5,1 @@\n-const label = "Password";\n+const label = "New password";`,
  ],
  [
    "src/components/button.tsx",
    18,
    9,
    `@@ -5,1 +5,1 @@\n-const label = "Submit";\n+const label = "Reset password";`,
  ],
  [
    "src/styles/forms.css",
    56,
    22,
    `@@ -5,1 +5,1 @@\n-.form { gap: 8px; }\n+.form { gap: 12px; }`,
  ],
  [
    "src/types/user.ts",
    22,
    6,
    `@@ -5,0 +5,1 @@\n+export type ResetRequest = { email: string };`,
  ],
  [
    "src/lib/validators.ts",
    35,
    15,
    `@@ -5,0 +5,1 @@\n+export const resetSchema = z.object({ password: z.string().min(12) });`,
  ],
  [
    "README.md",
    150,
    5,
    `@@ -1,0 +1,1 @@\n+Password reset links expire after one hour.`,
  ],
  [".env.example", 5, 2, `@@ -1,0 +1,1 @@\n+APP_URL=https://app.example.com`],
  [
    "src/components/forgot-password-form.tsx",
    42,
    1,
    `@@ -1,0 +1,1 @@\n+export function ForgotPasswordForm() { return <form aria-label="Forgot password" />; }`,
  ],
];
export function samplePullRequest(): PullRequest {
  const files = sampleFiles.map(([path, additions, deletions, patch]) => {
    const file = {
      path,
      additions,
      deletions,
      patch,
      status: "modified",
      categories: categorize(path),
      lines: parseDiff(patch),
    };
    return { ...file, risk: assessRisk(file) };
  });
  const additions = files.reduce((s, f) => s + f.additions, 0),
    deletions = files.reduce((s, f) => s + f.deletions, 0);
  return {
    owner: "acme",
    repo: "platform",
    number: 127,
    title: "Add password reset functionality",
    description:
      "Add an email-based password reset flow with expiring tokens, a reset form, and authentication tests.",
    url: "https://github.com/acme/platform/pull/127",
    author: "sarahchen",
    base: "main",
    head: "feat/password-reset",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    files,
    changedFiles: files.length,
    additions,
    deletions,
    warnings: [
      "Synthetic PR with abbreviated diff excerpts. Line coverage is partial. Execution evidence comes from the bundled fixture, not a GitHub repository.",
    ],
  };
}
export const sampleHypotheses: Hypothesis[] = [
  {
    title: "Password reset token reuse",
    category: "AUTHENTICATION",
    description:
      "The reset handler updates the password but never consumes the reset token. A second request may reuse the same credential.",
    behavioralChange:
      "Successful password resets leave the original token available until its expiry.",
    potentialImpact:
      "Someone holding a previously used reset link could change the password again within the expiry window.",
    affectedFiles: [
      { path: "src/auth/reset.ts", startLine: 81, endLine: 89, side: "RIGHT" },
      { path: "src/auth/token.ts", startLine: 21, endLine: 26, side: "RIGHT" },
    ],
    recommendation:
      "Consume the token atomically with the password update, then add a regression test for token reuse and concurrent requests.",
  },
  {
    title: "Reset token retention needs a policy",
    category: "DATABASE",
    description:
      "The new token table has an expiry field, but the excerpt does not establish cleanup behavior.",
    behavioralChange:
      "Password reset credentials are now persisted in a dedicated table.",
    potentialImpact:
      "Expired credentials may accumulate without an explicit retention or deletion policy.",
    affectedFiles: [
      {
        path: "prisma/schema.prisma",
        startLine: 40,
        endLine: 47,
        side: "RIGHT",
      },
    ],
    recommendation:
      "Inspect token hashing, retention, indexes, and deletion behavior against production requirements.",
  },
  {
    title: "Reset email delivery needs integration coverage",
    category: "EMAIL",
    description:
      "The reset link depends on APP_URL and an external mail provider. Delivery is not exercised by the fixture.",
    behavioralChange: "The application sends password reset links via email.",
    potentialImpact:
      "Incorrect environment configuration could produce unusable reset links.",
    affectedFiles: [
      { path: "src/email/reset.ts", startLine: 1, endLine: 5, side: "RIGHT" },
    ],
    recommendation:
      "Verify APP_URL and delivery in a staging environment with the real mail provider.",
  },
];
export const sampleBehaviors: Behavior[] = [
  {
    title: "Email-based account recovery",
    description:
      "Users can request a reset link and choose a new password without an active session.",
    files: ["src/auth/reset.ts", "src/api/users.ts"],
    source: "DEMO",
  },
  {
    title: "Persistent, time-limited tokens",
    description:
      "Reset tokens are stored with a one-hour expiry; consumption after use needs verification.",
    files: ["src/auth/token.ts", "prisma/schema.prisma"],
    source: "DEMO",
  },
  {
    title: "Neutral account lookup response",
    description:
      "The reset-request endpoint returns the same message whether the email exists or not. Timing behavior is not verified.",
    files: ["src/api/users.ts"],
    source: "DEMO",
  },
];
