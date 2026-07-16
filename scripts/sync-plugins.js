#!/usr/bin/env node
// Refreshes every known marketplace, then explicitly updates every plugin
// listed in this repo's .claude/settings.json enabledPlugins at project
// scope. Uses only the two update paths confirmed reliable by direct
// testing (marketplace refresh + explicit per-plugin update); does not
// depend on the marketplace-update-to-plugin cascade, which did not
// reproduce reliably.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const settingsPath = path.join(projectDir, ".claude", "settings.json");

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit", cwd: projectDir });
  } catch {
    // Non-fatal: don't block session start on a network hiccup or a
    // plugin that's already current.
  }
}

run("claude plugin marketplace update");

let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch {
  process.exit(0);
}

const plugins = Object.keys(settings.enabledPlugins || {});
for (const plugin of plugins) {
  run(`claude plugin update "${plugin}" --scope project`);
}
