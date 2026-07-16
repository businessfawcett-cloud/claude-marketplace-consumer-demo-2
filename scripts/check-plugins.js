#!/usr/bin/env node
// SessionStart hook: checks for skill updates, never installs them. Skills
// stay pinned until the engineer runs the exact command this prints. See
// FINDINGS.md for the full rationale. Silent when current; a check failure
// is always surfaced, never swallowed.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const installedPluginsPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function latestRemoteSha(repo, ref) {
  const out = execSync(`git ls-remote "https://github.com/${repo}.git" "${ref || "HEAD"}"`, { encoding: "utf8" });
  const sha = out.split(/\s+/)[0];
  if (!sha) throw new Error(`no ref returned for ${repo}`);
  return sha;
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

const marketplaces = settings.extraKnownMarketplaces || {};
const shaCache = new Map(); // marketplace name -> latest remote sha, or null if unavailable
const projectDirNorm = normalizePath(projectDir);
const behind = [];
const errors = [];

for (const pluginId of enabledPlugins) {
  const marketplaceName = pluginId.slice(pluginId.lastIndexOf("@") + 1);
  const marketplaceEntry = marketplaces[marketplaceName];
  if (!marketplaceEntry || marketplaceEntry.source?.source !== "github") continue;

  if (!shaCache.has(marketplaceName)) {
    try {
      shaCache.set(marketplaceName, latestRemoteSha(marketplaceEntry.source.repo, marketplaceEntry.source.ref));
    } catch (err) {
      errors.push(`could not check marketplace "${marketplaceName}": ${err.message.trim()}`);
      shaCache.set(marketplaceName, null);
    }
  }
  const latestSha = shaCache.get(marketplaceName);
  if (!latestSha) continue;

  const entry = (installed.plugins?.[pluginId] || []).find(
    (e) => e.scope === "project" && e.projectPath && normalizePath(e.projectPath) === projectDirNorm
  );
  if (!entry?.gitCommitSha) continue;

  // ls-remote returns a full 40-char SHA; installed_plugins.json stores a
  // 12-char short one -- compare as a prefix match, not equality.
  if (!latestSha.startsWith(entry.gitCommitSha) && !entry.gitCommitSha.startsWith(latestSha)) {
    behind.push({ pluginId, current: entry.gitCommitSha.slice(0, 12), latest: latestSha.slice(0, 12) });
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
