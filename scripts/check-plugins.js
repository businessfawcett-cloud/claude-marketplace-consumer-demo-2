#!/usr/bin/env node
// SessionStart hook: NOTIFY-ONLY. Never runs `claude plugin update` and never
// mutates any plugin's installed version -- an engineer's installed skills
// stay pinned exactly where they are until *they* choose to run the exact
// command this script hands them.
//
// Check method: a single read-only `git ls-remote` against each relevant
// marketplace's source URL (no local clone refresh needed -- `claude plugin
// update` refreshes the marketplace itself before updating, confirmed by
// source trace, so the handed command is self-sufficient). Compared against
// each enabled plugin's recorded gitCommitSha in installed_plugins.json.
//
// Reports via the SessionStart hookSpecificOutput contract. Silent when
// everything is current. A check failure (e.g. offline) is surfaced, never
// swallowed -- silent failure here is the exact silent-drift problem this
// project exists to kill.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const settingsPath = path.join(projectDir, ".claude", "settings.json");
const installedPluginsPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function marketplaceUrl(source) {
  if (!source) return null;
  if (source.source === "github") return `https://github.com/${source.repo}.git`;
  if (source.source === "url") return source.url;
  return null; // directory/git-subdir/npm sources aren't checkable this way
}

function latestRemoteSha(url, ref) {
  const out = execSync(`git ls-remote "${url}" "${ref || "HEAD"}"`, { encoding: "utf8" });
  const sha = out.split(/\s+/)[0];
  if (!sha) throw new Error(`no ref returned for ${url}`);
  return sha;
}

let settings;
try {
  settings = readJson(settingsPath);
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
const shaCache = new Map(); // marketplace name -> latest remote sha (or Error)
const behind = [];
const errors = [];
const projectDirNorm = normalizePath(projectDir);

for (const pluginId of enabledPlugins) {
  const atIndex = pluginId.lastIndexOf("@");
  if (atIndex < 0) continue;
  const marketplaceName = pluginId.slice(atIndex + 1);
  const marketplaceEntry = marketplaces[marketplaceName];
  if (!marketplaceEntry) continue; // official/other marketplaces not in our own settings.json -- skip

  if (!shaCache.has(marketplaceName)) {
    const url = marketplaceUrl(marketplaceEntry.source);
    if (!url) {
      shaCache.set(marketplaceName, null);
    } else {
      try {
        shaCache.set(marketplaceName, latestRemoteSha(url, marketplaceEntry.source.ref));
      } catch (err) {
        errors.push(`could not check marketplace "${marketplaceName}": ${err.message.trim()}`);
        shaCache.set(marketplaceName, null);
      }
    }
  }
  const latestSha = shaCache.get(marketplaceName);
  if (!latestSha) continue;

  const entries = installed.plugins?.[pluginId];
  if (!entries || entries.length === 0) continue;
  const entry = entries.find(
    (e) => e.scope === "user" || (e.scope === "project" && e.projectPath && normalizePath(e.projectPath) === projectDirNorm)
  );
  if (!entry) continue;

  if (entry.gitCommitSha && !latestSha.startsWith(entry.gitCommitSha) && !entry.gitCommitSha.startsWith(latestSha)) {
    behind.push({ pluginId, current: entry.gitCommitSha.slice(0, 12), latest: latestSha.slice(0, 12) });
  }
}

function emit(text) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  }));
}

if (errors.length > 0 || behind.length > 0) {
  const lines = [];
  if (behind.length > 0) {
    lines.push(
      `${behind.length} skill(s) have updates available. Tell the user this plainly, and give them each exact command:`
    );
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
