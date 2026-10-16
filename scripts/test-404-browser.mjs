// Headless Edge/Chrome check of the real HTTP status, rendered DOM and hydration of unmatched and valid URLs.
// Usage: node scripts/test-404-browser.mjs [baseUrl] [--with-data] [--runs=3]
// Start the app first (pnpm build && pnpm start). --with-data also visits book routes, which need DATABASE_URL.
// LIBRA_TEST_BROWSERS may hold a ";"-separated list of browser executables; default is Edge and Chrome if present.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { isBenignBrowserNotice } from "./lib/browser-notices.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const base = new URL(args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000");
const withData = args.includes("--with-data");
const runs = Number(args.find((arg) => arg.startsWith("--runs="))?.slice(7) ?? 3);
const HYDRATION_TIMEOUT_MS = 15_000;

const en = require("../messages/en.json").errors;
const es = require("../messages/es.json").errors;
const copy = { en, es };

const browsers = (
  process.env.LIBRA_TEST_BROWSERS
    ? process.env.LIBRA_TEST_BROWSERS.split(";")
    : [
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      ]
).filter((exe) => existsSync(exe));
assert.ok(browsers.length > 0, "No browser found; set LIBRA_TEST_BROWSERS");

const notFoundCase = (pathname, locale) => ({
  pathname,
  status: 404,
  lang: locale,
  title: `${copy[locale].notFoundTitle} — Libra`,
  h1: copy[locale].notFoundTitle,
});
const cases = [
  notFoundCase("/en/libra-test-missing-0f7b16", "en"),
  notFoundCase("/es/libra-test-missing-0f7b16", "es"),
  // No route handler owns /api/*: it is the same localized HTML 404, rendered in the default locale.
  notFoundCase("/api/libra-test-missing-0f7b16", "es"),
];
if (withData) {
  cases.push(
    { pathname: "/en/books", status: 200, lang: "en" },
    { pathname: "/es", status: 200, lang: "es" },
    { pathname: "/en/books/dracula", status: 200, lang: "en" },
    { pathname: "/en/books/libra-test-missing-0f7b16", status: 404, lang: "en" },
    { pathname: "/en/books/dracula/libra-test-missing-0f7b16", status: 404, lang: "en" },
  );
}

async function launch(exe) {
  const profile = await mkdtemp(path.join(tmpdir(), "libra-404-"));
  const child = spawn(
    exe,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const port = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error("browser did not expose a debug port")), 20_000);
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let nextId = 0;
  const waiting = new Map();
  const events = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && waiting.has(data.id)) waiting.get(data.id)(data);
    else events.push(data);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  for (const domain of ["Runtime", "Log", "Network", "Page"]) await send(`${domain}.enable`);
  const close = async () => {
    socket.close();
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return { send, events, close };
}

const probe = `(() => {
  const h1 = document.querySelector("h1");
  const reactOwned = (node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"));
  return {
    lang: document.documentElement.lang,
    title: document.title,
    h1: h1?.textContent ?? null,
    robots: document.querySelector('meta[name="robots"]')?.content ?? null,
    hydrated: Boolean(h1 && reactOwned(h1) && typeof window.next?.version === "string"),
  };
})()`;

// Names a failed request in the report: its resource type, its URL (query values are never printed, only their keys)
// and when it failed relative to the document request. It only describes the failure: every failed request still fails
// the case.
function describeFailedRequest(failed, events, documentRequestId) {
  const sent = (requestId) =>
    events.find((event) => event.method === "Network.requestWillBeSent" && event.params.requestId === requestId);
  const request = sent(failed.requestId);
  const documentSent = sent(documentRequestId);
  let where = "unknown URL";
  if (request) {
    const url = new URL(request.params.request.url);
    const keys = [...url.searchParams.keys()];
    where = `${url.origin}${url.pathname}${keys.length > 0 ? ` (query keys: ${keys.join(",")})` : ""}`;
  }
  const after = documentSent
    ? `${Math.round((failed.timestamp - documentSent.params.timestamp) * 1000)} ms after the document request`
    : "timing unknown";
  const type = failed.type ?? request?.params.type ?? "unknown type";
  return `request failed: ${failed.errorText} | ${type} | ${where} | canceled=${Boolean(failed.canceled)} | ${after}`;
}

async function runCase(session, testCase) {
  const url = new URL(testCase.pathname, base).href;
  session.events.length = 0;
  await session.send("Page.navigate", { url: "about:blank" });
  session.events.length = 0;
  await session.send("Page.navigate", { url });

  const started = Date.now();
  let state;
  while (Date.now() - started < HYDRATION_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await session.send("Runtime.evaluate", { expression: probe, returnByValue: true });
    state = result.result?.result?.value;
    if (state?.hydrated) break;
  }
  // Let late hydration errors (React reports them asynchronously) arrive before judging the page.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const documentResponse = session.events.find(
    (event) => event.method === "Network.responseReceived" && event.params.type === "Document",
  );
  const issues = { network: [], application: [], hydration: [] };
  const status = documentResponse?.params.response.status;
  if (status !== testCase.status) issues.network.push(`HTTP ${status}, expected ${testCase.status}`);
  for (const event of session.events) {
    if (event.method === "Network.loadingFailed") {
      issues.network.push(describeFailedRequest(event.params, session.events, documentResponse?.params.requestId));
    }
    if (event.method === "Network.responseReceived" && event.params.response.status >= 400) {
      const isExpectedDocument =
        event.params.requestId === documentResponse?.params.requestId && testCase.status === 404;
      if (!isExpectedDocument) issues.network.push(`HTTP ${event.params.response.status} ${event.params.response.url}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const details = event.params.exceptionDetails;
      issues.application.push(`exception: ${details.exception?.description ?? details.text}`);
    }
    const text =
      event.method === "Runtime.consoleAPICalled"
        ? `${event.params.type}: ${event.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`
        : event.method === "Log.entryAdded"
          ? `${event.params.entry.level}: ${event.params.entry.text} ${event.params.entry.url ?? ""}`
          : null;
    if (text === null) continue;
    // Only the browser's own notice for the expected 404 document is allowed; every other message is a failure.
    const isDocument404Notice =
      testCase.status === 404 &&
      event.method === "Log.entryAdded" &&
      event.params.entry.url === url &&
      /status of 404/.test(event.params.entry.text);
    if (isDocument404Notice) continue;
    if (event.method === "Log.entryAdded" && isBenignBrowserNotice(event.params.entry)) continue;
    (/hydrat|did not match|server rendered HTML/i.test(text) ? issues.hydration : issues.application).push(text);
  }
  if (!state?.hydrated) issues.hydration.push(`not hydrated after ${HYDRATION_TIMEOUT_MS} ms`);
  if (state?.lang !== testCase.lang) issues.application.push(`lang ${state?.lang}, expected ${testCase.lang}`);
  if (testCase.title && state?.title !== testCase.title) issues.application.push(`title "${state?.title}"`);
  if (testCase.h1 && state?.h1 !== testCase.h1) issues.application.push(`h1 "${state?.h1}"`);
  if (testCase.status === 404 && !/noindex/.test(state?.robots ?? "")) issues.application.push("404 is not noindex");
  return { issues, ms: Date.now() - started };
}

let failures = 0;
for (const exe of browsers) {
  const name = path.basename(exe);
  const session = await launch(exe);
  try {
    for (const testCase of cases) {
      for (let run = 1; run <= runs; run += 1) {
        const { issues, ms } = await runCase(session, testCase);
        const failed = Object.entries(issues).filter(([, list]) => list.length > 0);
        const label = `${name} ${testCase.pathname} [${run}/${runs}]`;
        if (failed.length === 0) console.log(`PASS ${label} ${ms} ms`);
        else {
          failures += 1;
          console.log(`FAIL ${label}`);
          for (const [kind, list] of failed) for (const item of list) console.log(`  ${kind}: ${item}`);
        }
      }
    }
  } finally {
    await session.close();
  }
}
console.log(failures === 0 ? "PASS all browser checks" : `FAIL ${failures} browser check(s)`);
process.exit(failures === 0 ? 0 : 1);
