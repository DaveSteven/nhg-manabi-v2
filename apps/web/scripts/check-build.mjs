/**
 * Post-build verification of the SSG/SPA artifact shape (ADR-0007):
 * - build/client/index.html is the prerendered brand home: real copy,
 *   indexable (no noindex), canonical link present.
 * - build/client/__spa-fallback.html exists and is noindex (it serves
 *   /study/* only; the brand HTML must never be the global fallback).
 * - No credentials from repo .env leak into the build output.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = join(root, "build", "client");

function fail(msg) {
  console.error(`BUILD CHECK FAILED: ${msg}`);
  process.exit(1);
}

function read(p) {
  return readFileSync(join(client, p), "utf8");
}

let indexHtml;
let fallbackHtml;
try {
  indexHtml = read("index.html");
} catch {
  fail("build/client/index.html missing — brand home was not prerendered");
}
try {
  fallbackHtml = read("__spa-fallback.html");
} catch {
  fail("build/client/__spa-fallback.html missing — SPA fallback not emitted");
}

if (!/<h1[^>]*>JLPT GO<\/h1>/.test(indexHtml)) {
  fail("brand index.html lacks the H1 copy — initial HTML is incomplete");
}
if (/noindex/i.test(indexHtml)) {
  fail("brand index.html must be indexable (no noindex)");
}
if (!/rel="canonical"/.test(indexHtml)) {
  fail("brand index.html lacks a canonical link");
}
if (!/name="description"/.test(indexHtml)) {
  fail("brand index.html lacks meta description");
}
if (!/noindex/i.test(fallbackHtml)) {
  fail("__spa-fallback.html must carry noindex (serves /study/*)");
}
if (fallbackHtml.includes("进入学习") && !fallbackHtml.includes("<script")) {
  fail("fallback unexpectedly contains prerendered brand copy");
}

// Credential leak guard: nothing from repo .env may appear in build output.
const envPath = resolve(root, "..", "..", ".env");
try {
  const env = readFileSync(envPath, "utf8");
  const secrets = [...env.matchAll(/^(?:POSTGRES_PASSWORD|DATABASE_URL)=(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((v) => v && !v.includes("replace_me"));
  const haystacks = listFiles(client).map((f) => readFileSync(f, "utf8"));
  for (const secret of secrets) {
    for (const hay of haystacks) {
      if (hay.includes(secret)) {
        fail("build output contains a credential from repo .env");
      }
    }
  }
} catch {
  // no .env readable — skip secret scan
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

console.log("build checks passed: prerendered brand HTML + noindex SPA fallback + no credential leaks");
