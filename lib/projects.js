'use strict';

// Pure helpers (no 'vscode' import) so they can be tested with plain Node.

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * A folder is a runnable Mule application when it holds mule-artifact.json and a pom.xml
 * with <packaging>mule-application</packaging> (parent poms, DW libraries and domains are skipped).
 */
function isMuleProject(dir) {
  const pom = path.join(dir, 'pom.xml');
  if (!fs.existsSync(pom) || !fs.existsSync(path.join(dir, 'mule-artifact.json'))) return false;
  const packaging = tag(stripXmlComments(fs.readFileSync(pom, 'utf8')), 'packaging');
  return packaging === 'mule-application';
}

function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name.replace(/\./g, '\\.')}>\\s*([^<]+?)\\s*</${name.replace(/\./g, '\\.')}>`));
  return m ? m[1] : undefined;
}

function defaultM2Repo() {
  return process.env.M2_REPO || path.join(os.homedir(), '.m2', 'repository');
}

/**
 * Read app.runtime from a pom, following <parent> poms found in the local Maven repository.
 * Returns undefined when it cannot be found.
 */
function appRuntimeFromPom(pomPath, m2Repo = defaultM2Repo(), depth = 0) {
  if (depth > 5 || !fs.existsSync(pomPath)) return undefined;
  const xml = stripXmlComments(fs.readFileSync(pomPath, 'utf8'));

  const props = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  if (props) {
    const value = tag(props[1], 'app.runtime');
    if (value && !value.startsWith('$')) return value;
  }

  const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/);
  if (!parent) return undefined;
  const groupId = tag(parent[1], 'groupId');
  const artifactId = tag(parent[1], 'artifactId');
  const version = tag(parent[1], 'version');
  if (!groupId || !artifactId || !version) return undefined;

  const parentPom = path.join(m2Repo, ...groupId.split('.'), artifactId, version, `${artifactId}-${version}.pom`);
  return appRuntimeFromPom(parentPom, m2Repo, depth + 1);
}

function versionTuple(v) {
  return (String(v).match(/\d+/g) || []).slice(0, 3).map(Number);
}

function compareVersions(a, b) {
  const x = versionTuple(a);
  const y = versionTuple(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Highest app.runtime across the projects.
 * ACB matches it against installed runtimes on major.minor (4.9.1 -> installed 4.9.15).
 */
function requiredRuntime(projectDirs, m2Repo = defaultM2Repo()) {
  const perProject = projectDirs.map((dir) => ({
    dir,
    runtime: appRuntimeFromPom(path.join(dir, 'pom.xml'), m2Repo),
  }));
  const found = perProject.map((p) => p.runtime).filter(Boolean);
  const highest = found.sort(compareVersions).pop();
  return { runtime: highest, perProject };
}

/** Default Arguments are an array since ACB 3.36 (a string before): return one string. */
function normalizeArgs(defaultArgs) {
  if (Array.isArray(defaultArgs)) return defaultArgs.join(' ');
  return typeof defaultArgs === 'string' ? defaultArgs : '';
}

/** Value of -M-Dmule.env=..., or undefined when not set. */
function muleEnv(defaultArgs) {
  const m = normalizeArgs(defaultArgs).match(/mule\.env=(\S+)/);
  return m ? m[1] : undefined;
}

/** True when the Default Arguments point Mule at a production environment. */
function targetsProduction(defaultArgs) {
  return /^(prd|prod|production)$/i.test(muleEnv(defaultArgs) || '');
}

module.exports = {
  isMuleProject,
  appRuntimeFromPom,
  requiredRuntime,
  compareVersions,
  normalizeArgs,
  muleEnv,
  targetsProduction,
};
