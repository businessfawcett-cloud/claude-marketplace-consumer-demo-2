#!/usr/bin/env node
// SessionStart hook: refreshes every known marketplace, then explicitly
// updates every plugin listed in this repo's .claude/settings.json
// enabledPlugins at project scope. Uses only the per-plugin update command,
// which has been reliable in every test; does not depend on the
// marketplace-update-to-plugin cascade, which did not reproduce reliably.
//
// Reports outcome via the SessionStart hookSpecificOutput contract:
//   - additionalContext: a real, visible notification (only emitted when
//     there's something to say -- an update happened or something failed;
//     silent when everything was already current, to avoid noise).
//   - reloadSkills: true, so a successful update is picked up by *this*
//     session, not just the next one.
// Always exits 0 (a failed sync must not block the session from starting),
// but a failure is never swallowed -- it's surfaced in additionalContext.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const settingsPath = path.join(projectDir, ".claude", "settings.json");

function run(cmd) {
  try {
    const stdout = execSync(cmd, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stdout: err.stdout || "", stderr: err.stderr || String(err.message || err) };
  }
}

const notes = [];
const failures = [];

const marketplaceResult = run("claude plugin marketplace update");
if (!marketplaceResult.ok) {
  failures.push(`marketplace refresh failed: ${marketplaceResult.stderr.trim() || "unknown error"}`);
}

let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch (err) {
  failures.push(`could not read .claude/settings.json: ${err.message}`);
  settings = { enabledPlugins: {} };
}

const plugins = Object.keys(settings.enabledPlugins || {});
for (const plugin of plugins) {
  const result = run(`claude plugin update "${plugin}" --scope project`);
  if (!result.ok) {
    failures.push(`${plugin}: update failed - ${result.stderr.trim() || "unknown error"}`);
    continue;
  }
  const updated = result.stdout.match(/updated from (\S+) to (\S+)/);
  if (updated) notes.push(`${plugin}: ${updated[1]} -> ${updated[2]}`);
  // "already at the latest version" -> no note, this is the quiet/expected case
}

let additionalContext;
if (failures.length > 0) {
  additionalContext =
    `Skill sync encountered problems and may be stale:\n` +
    failures.map((f) => `- ${f}`).join("\n") +
    (notes.length > 0 ? `\n\nSuccessfully updated:\n${notes.map((n) => `- ${n}`).join("\n")}` : "");
} else if (notes.length > 0) {
  additionalContext = `Skill sync: updated ${notes.length} skill(s):\n${notes.map((n) => `- ${n}`).join("\n")}`;
}

if (additionalContext) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
      reloadSkills: true,
    },
  }));
}

process.exit(0);
