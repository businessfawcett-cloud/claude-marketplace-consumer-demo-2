#!/usr/bin/env node
// SessionStart hook: checks for skill updates, never installs them. Skills
// stay pinned until the engineer runs the exact command this prints. See
// FINDINGS.md for the full rationale. Silent when current; a check failure
// is always surfaced, never swallowed.
//
// Compares each enabled plugin's installed version against its actual
// per-skill version (from that skill's own plugin.json, stamped by the
// marketplace's CI -- see stamp-versions.js there). Deliberately not the
// marketplace's whole-repo commit SHA: that would flag every skill as
// "behind" whenever any other skill in the same marketplace changes.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const installedPluginsPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
const marketplacesDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function emit(text) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  }));
}

let settings;
try {
  settings = readJson(path.join(projectDir, ".claude", "settings.json"));
} catch (err) {
  emit(`Skill check failed: could not read .claude/settings.json (${err.message})`);
  process.exit(0);
}

const enabledPlugins = Object.keys(settings.enabledPlugins || {}).filter((k) => settings.enabledPlugins[k]);
if (enabledPlugins.length === 0) process.exit(0);

let installed;
try {
  installed = readJson(installedPluginsPath);
} catch (err) {
  emit(`Skill check failed: could not read installed_plugins.json (${err.message})`);
  process.exit(0);
}

const marketplaceNames = new Set(enabledPlugins.map((id) => id.slice(id.lastIndexOf("@") + 1)));
const refreshed = new Set();
const errors = [];

for (const name of marketplaceNames) {
  try {
    execSync(`claude plugin marketplace update "${name}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    refreshed.add(name);
  } catch (err) {
    errors.push(`could not refresh marketplace "${name}": ${(err.stderr || err.message).toString().trim()}`);
  }
}

const projectDirNorm = normalizePath(projectDir);
const behind = [];

for (const pluginId of enabledPlugins) {
  const atIndex = pluginId.lastIndexOf("@");
  const pluginName = pluginId.slice(0, atIndex);
  const marketplaceName = pluginId.slice(atIndex + 1);
  if (!refreshed.has(marketplaceName)) continue; // its refresh failed above; already reported

  let latestVersion;
  try {
    const manifest = readJson(path.join(marketplacesDir, marketplaceName, ".claude-plugin", "marketplace.json"));
    const entry = manifest.plugins.find((p) => p.name === pluginName);
    const sourcePath = entry?.source;
    if (typeof sourcePath !== "string") continue; // non-relative-path source; not handled here
    const pluginJson = readJson(path.join(marketplacesDir, marketplaceName, sourcePath, ".claude-plugin", "plugin.json"));
    latestVersion = pluginJson.version;
  } catch (err) {
    errors.push(`could not read latest version for "${pluginId}": ${err.message}`);
    continue;
  }
  if (!latestVersion) continue; // no stamped version yet -- nothing to compare

  const entry = (installed.plugins?.[pluginId] || []).find(
    (e) => e.scope === "project" && e.projectPath && normalizePath(e.projectPath) === projectDirNorm
  );
  if (!entry?.version) continue;

  if (entry.version !== latestVersion) {
    behind.push({ pluginId, current: entry.version, latest: latestVersion });
  }
}

if (errors.length > 0 || behind.length > 0) {
  const lines = [];
  if (behind.length > 0) {
    lines.push(`${behind.length} skill(s) have updates available. Tell the user this plainly, and give them each exact command:`);
    for (const b of behind) {
      lines.push(`- ${b.pluginId} (${b.current} -> ${b.latest}): claude plugin update "${b.pluginId}" --scope project`);
    }
  }
  if (errors.length > 0) {
    lines.push(`Skill update check ran into problems (results may be incomplete):`);
    for (const e of errors) lines.push(`- ${e}`);
  }
  emit(lines.join("\n"));
}

process.exit(0);
