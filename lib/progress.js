'use strict';

// Reads the Mule runtime folder to tell how far a launch has gone (no 'vscode' import: testable).
//  - apps/<app>.jar copied            -> the runtime is about to start
//  - apps/<app>-anchor.txt created    -> <app> is deployed
//  - "Failed to deploy artifact [<app>]" in logs/mule_ee.log -> <app> failed

const fs = require('fs');
const path = require('path');

const FAILED_RE = /Failed to deploy artifact \[([^\]]+)\]/g;

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

/** Current size of the runtime log, used as the starting point for failure detection. */
function logSize(muleHome) {
  const st = safeStat(path.join(muleHome, 'logs', 'mule_ee.log'));
  return st ? st.size : 0;
}

/** New text appended to the runtime log since `offset` (the log is never read in full). */
function readLogSince(muleHome, offset) {
  const file = path.join(muleHome, 'logs', 'mule_ee.log');
  const st = safeStat(file);
  if (!st) return { text: '', offset };
  const start = st.size < offset ? 0 : offset; // log rotated or truncated
  if (st.size === start) return { text: '', offset: start };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), offset: st.size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * State of a launch started at `since` (ms). `logText` is the runtime log written since the launch.
 * Returns { copied, deployed: [app names], failed: [app names] }.
 */
function deploymentState(muleHome, since, logText = '') {
  const appsDir = path.join(muleHome, 'apps');
  let entries = [];
  try {
    entries = fs.readdirSync(appsDir);
  } catch {
    entries = [];
  }
  const fresh = entries.filter((name) => {
    const st = safeStat(path.join(appsDir, name));
    return st && st.mtimeMs >= since - 1000;
  });
  const deployed = fresh.filter((n) => n.endsWith('-anchor.txt')).map((n) => n.slice(0, -'-anchor.txt'.length));
  const failed = [...new Set([...logText.matchAll(FAILED_RE)].map((m) => m[1]))].filter((n) => !deployed.includes(n));
  return { copied: fresh.length > 0, deployed, failed };
}

/** Short status line for the progress notification. */
function describe(state, total) {
  if (state.deployed.length === 0 && state.failed.length === 0) {
    return state.copied ? 'Starting the Mule runtime…' : 'Preparing and building (Maven)…';
  }
  const parts = [`${state.deployed.length}/${total} deployed`];
  if (state.failed.length) parts.push(`${state.failed.length} failed`);
  return parts.join(', ');
}

module.exports = { logSize, readLogSince, deploymentState, describe };
