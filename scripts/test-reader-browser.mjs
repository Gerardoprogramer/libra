// Real React DOM / Edge regression harness. Supabase and the router are controlled
// adapters; no real accounts, PostgreSQL, R2 or production writes are used.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const baseline = process.argv.includes("--baseline");
const edge = process.env.LIBRA_TEST_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const stateModule = `
import React, {useSyncExternalStore} from "react";
export const state = window.fixture = {
 user:"A", path:"/en/books/dracula/chapter-1", mode:"reader", auth:new Set(), route:new Set(),
 cloud:new Map(), held:[], hold:false, heldHistory:[], holdHistory:false, writes:[], replacements:[],
 setUser(id){this.user=id; for(const fn of this.auth) fn("SIGNED_IN", id?{user:{id}}:null);},
 navigate(to){this.path=to;for(const fn of this.route)fn();},
 notify(){for(const fn of this.route)fn();}
};
export function usePathname(){return useSyncExternalStore(fn=>{state.route.add(fn);return()=>state.route.delete(fn)},()=>state.path,()=>null)}
export const Link=React.forwardRef(function Link({href,children,onClick,...props},ref){return <a {...props} ref={ref} href={href} onClick={event=>{onClick?.(event);event.preventDefault();state.navigate(href)}}>{children}</a>});
export const router={replace(to){state.replacements.push(to);state.navigate(to)},push(to){state.navigate(to)},refresh(){}};
export function useRouter(){return router}
`;
const cloudModule = `
import {state} from "fixture:state";
export async function getAuthenticatedUserId(){return state.user}
export function getCloudReadingProgress(editionId,userId){
 const p=state.cloud.get(userId)?.find(p=>p.editionId===editionId);
 const result=p?{id:"p",user_id:userId,edition_id:editionId,chapter_id:p.chapterId,paragraph_index:p.paragraphIndex,percentage:p.percentage,updated_at:p.updatedAt}:null;
 return state.hold?new Promise(resolve=>state.held.push(()=>resolve(result))):Promise.resolve(result);
}
export async function saveCloudReadingProgress(input,userId){state.writes.push({input,userId});return true}
export function getCloudReadingProgressHistory(userId){const result=state.cloud.get(userId)??[];return state.holdHistory?new Promise(resolve=>state.heldHistory.push(()=>resolve(result))):Promise.resolve(result)}
export const toReadingProgress=item=>item;
`;
const fixture = `
import React,{useSyncExternalStore} from "react";
import {createRoot} from "react-dom/client";
import {state} from "fixture:state";
import {ReaderView} from "@/components/reader/ReaderView";
import {ContinueReading} from "@/components/home/ContinueReading";
import {RecentlyRead} from "@/components/home/RecentlyRead";
import {BookReadingAction} from "@/components/books/BookReadingAction";
import {saveScopedReadingProgress} from "@/lib/reading-progress";
window.scrollTo=()=>{};
const routes=[{id:"chapter-1",slug:"chapter-1"},{id:"chapter-2",slug:"chapter-2"}];
const books=[{slug:"dracula",title:"Dracula",author:"Stoker",coverUrl:null},{slug:"frankenstein",title:"Frankenstein",author:"Shelley",coverUrl:null}];
function position(book,percentage){return {bookSlug:book,editionId:book+"-en",chapterId:"chapter-1",chapterSlug:"chapter-1",chapterTitle:"Chapter 1",chapterNumber:1,chapterIndex:0,totalChapters:1,contentLanguage:"en",percentage,paragraphIndex:0,updatedAt:"2026-01-01T00:00:00.000Z"}}
state.seed=(owner,book,percentage)=>{const p=position(book,percentage);state.cloud.set(owner,[p]);saveScopedReadingProgress(p,{type:"user",userId:owner})};
state.seed("A","dracula",40);
function App(){
 useSyncExternalStore(fn=>{state.route.add(fn);return()=>state.route.delete(fn)},()=>state.mode+state.path);
 const n=state.path.includes("chapter-2")?2:1;
 if(state.mode==="home")return <><div id="continue"><ContinueReading books={books} title="Continue" chapterLabel="Chapter" continueLabel="Read" storageUnavailableLabel="Storage unavailable"/></div><div id="recent"><RecentlyRead books={books} title="Recent" continueLabel="Read"/></div><div id="action"><BookReadingAction bookSlug="dracula" editionId="dracula-en" chapterSlugs={["chapter-1","chapter-2"]} firstChapterSlug="chapter-1" startLabel="Start" continueLabel="Continue" readAgainLabel="Again" progressLabel="{progress}%"/></div></>;
 return <ReaderView bookSlug="dracula" bookTitle="Dracula" author="Stoker" contentLanguage="en" editionId="dracula-en" chapterSlug={"chapter-"+n} chapterId={"chapter-"+n} chapterTitle={"Chapter "+n} chapterRoutes={routes} chapterNumber={n} chapterIndex={n-1} totalChapters={2} previousHref={n===2?"/en/books/dracula/chapter-1":undefined} nextHref={n===1?"/en/books/dracula/chapter-2":undefined}><p>First paragraph.</p><p>Second paragraph.</p></ReaderView>
}
createRoot(document.getElementById("root")).render(<App/>);
window.ready=true;
`;

const modules = {
  "fixture:state": stateModule,
  "fixture:cloud": cloudModule,
  "fixture:auth": `import {state} from "fixture:state";
    export function createClient(){return {auth:{onAuthStateChange(fn){
      state.auth.add(fn);
      queueMicrotask(()=>{if(state.auth.has(fn))fn("INITIAL_SESSION",state.user?{user:{id:state.user}}:null)});
      return {data:{subscription:{unsubscribe(){state.auth.delete(fn)}}}};
    }}};}`,
  "fixture:intl": `export const useTranslations=()=>key=>key;export const useLocale=()=>"en";`,
  "fixture:image": `import React from "react";export default function Image({fill,...props}){return <img {...props}/>}`,
};
const output = await build({
  stdin: { contents: fixture, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "controlled-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^(fixture:|@\/i18n\/navigation$|next\/navigation$|next-intl$|next\/image$|@\/lib\/supabase\/client$)|reading-progress-cloud$/,
          },
          ({ path: name }) => {
            const target = name.startsWith("fixture:")
              ? name
              : name.endsWith("reading-progress-cloud")
                ? "fixture:cloud"
                : name === "@/lib/supabase/client"
                  ? "fixture:auth"
                  : name === "next-intl"
                    ? "fixture:intl"
                    : name === "next/image"
                      ? "fixture:image"
                      : "fixture:state";
            return { path: target, namespace: "fixture" };
          },
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({
          contents: modules[name],
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
        if (baseline)
          plugin.onLoad({ filter: /ReaderView\.tsx$/ }, () => ({
            contents: execFileSync("git", ["show", "HEAD:src/components/reader/ReaderView.tsx"], { encoding: "utf8" }),
            loader: "tsx",
            resolveDir: path.resolve("src/components/reader"),
          }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(output.outputFiles[0].contents);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(tmpdir(), "libra-reader-test-"));
const browser = spawn(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-features=msImplicitSignin,msSingleSignOnOSForPrimaryAccountIsShared",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await wait(50);
    }
  }
  assert.ok(port, "Edge did not expose its debug port");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((target) => target.type === "page" && target.url === "about:blank");
  assert.ok(page, "Missing blank browser test tab");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const waiting = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.id) {
      const callbacks = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) callbacks.reject(message.error);
      else callbacks.resolve(message.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => {
        waiting.delete(requestId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      waiting.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const value = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    assert.equal(value.exceptionDetails, undefined, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const settle = () =>
    evaluate(
      "new Promise(resolve=>{let n=6;const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame)})",
    );
  await call("Runtime.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  for (let attempt = 0; attempt < 100 && !(await evaluate("window.ready===true")); attempt++) await wait(25);
  await settle();
  assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");
  await evaluate("[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').endsWith('chapter-2')).click()");
  await settle();
  if (baseline) {
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");
    assert.ok((await evaluate("fixture.replacements")).length > 0);
    console.log("BASELINE REPRODUCED: one Next click was reverted to Chapter 1 by router.replace.");
  } else {
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 2");
    await evaluate("[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').endsWith('chapter-1')).click()");
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");
    console.log("PASS authenticated Next / Previous: one click each.");
    await evaluate("fixture.setUser(null)");
    await settle();
    await evaluate("[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').endsWith('chapter-2')).click()");
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 2");
    console.log("PASS guest Next: one click.");
    await evaluate("fixture.setUser('A');fixture.hold=true;fixture.navigate('/en/books/dracula/chapter-1')");
    await settle();
    await evaluate("[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').endsWith('chapter-2')).click()");
    await settle();
    await evaluate("fixture.held.splice(0).forEach(resolve=>resolve());fixture.hold=false");
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 2");
    assert.deepEqual(await evaluate("fixture.replacements"), []);
    console.log("PASS delayed cloud responses cannot revert navigation.");
    await evaluate("localStorage.clear();fixture.seed('A','dracula',40);fixture.mode='home';fixture.navigate('/en')");
    await settle();
    assert.match(await evaluate("document.querySelector('#continue').textContent"), /Dracula.*40%/s);
    await evaluate("fixture.setUser(null)");
    await settle();
    assert.equal(await evaluate("document.querySelector('#continue').textContent"), "");
    await evaluate("fixture.setUser('B')");
    await settle();
    assert.equal(await evaluate("document.querySelector('#continue').textContent"), "");
    assert.doesNotMatch(await evaluate("document.querySelector('#action').textContent"), /40%/);
    await evaluate("fixture.seed('B','frankenstein',20);window.dispatchEvent(new Event('libra:cloud-progress-sync'))");
    await settle();
    assert.match(await evaluate("document.querySelector('#continue').textContent"), /Frankenstein.*20%/s);
    await evaluate("fixture.setUser(null)");
    await settle();
    await evaluate("fixture.setUser('A')");
    await settle();
    assert.match(await evaluate("document.querySelector('#continue').textContent"), /Dracula.*40%/s);
    assert.doesNotMatch(
      await evaluate("document.querySelector('#continue').textContent+document.querySelector('#recent').textContent"),
      /Frankenstein/,
    );
    console.log("PASS A/B login and logout without refresh; Continue, Recent and Book action stay scoped.");
    await evaluate(
      "fixture.holdHistory=true;window.dispatchEvent(new Event('libra:cloud-progress-sync'));fixture.setUser('B')",
    );
    await settle();
    await evaluate("fixture.heldHistory.splice(0).forEach(resolve=>resolve());fixture.holdHistory=false");
    await settle();
    assert.doesNotMatch(
      await evaluate("document.querySelector('#continue').textContent+document.querySelector('#recent').textContent"),
      /Dracula/,
    );
    await evaluate("fixture.user=null;fixture.navigate('/es')");
    await settle();
    assert.equal(await evaluate("document.querySelector('#continue').textContent"), "");
    assert.doesNotMatch(await evaluate("document.querySelector('#action').textContent"), /40%/);
    console.log("PASS stale history responses and server logout cookie changes cannot retain the previous account.");
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  await call("Browser.close");
} finally {
  socket?.close();
  browser.kill();
  server.close();
  // Only this run's generated temporary browser profile is eligible for removal.
  const root = path.resolve(tmpdir()) + path.sep;
  if (!path.resolve(profile).startsWith(root) || !path.basename(profile).startsWith("libra-reader-test-"))
    throw new Error("Unsafe temporary path");
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
