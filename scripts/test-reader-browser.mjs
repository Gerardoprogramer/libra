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
 cloud:new Map(), held:[], hold:false, heldHistory:[], holdHistory:false, writes:[], replacements:[], prefetches:[],
 setUser(id){this.user=id; for(const fn of this.auth) fn("SIGNED_IN", id?{user:{id}}:null);},
 navigate(to){this.path=to;for(const fn of this.route)fn();},
 notify(){for(const fn of this.route)fn();}
};
export function usePathname(){return useSyncExternalStore(fn=>{state.route.add(fn);return()=>state.route.delete(fn)},()=>state.path,()=>null)}
// prefetch is Next's Link prop, not a DOM attribute: it is shown as data-prefetch. router.prefetch fetches nothing; it
// records each call, with the callback passed to it.
export const Link=React.forwardRef(function Link({href,children,onClick,prefetch,...props},ref){return <a {...props} data-prefetch={prefetch===undefined?undefined:String(prefetch)} ref={ref} href={href} onClick={event=>{onClick?.(event);event.preventDefault();state.navigate(href)}}>{children}</a>});
export const router={replace(to){state.replacements.push(to);state.navigate(to)},push(to){state.navigate(to)},refresh(){},prefetch(href,options){state.prefetches.push({href,kind:options?.kind,onInvalidate:options?.onInvalidate})}};
export function useRouter(){return router}
export function getPathname({href}){return href}
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
// Options of the reading-progress scenarios, kept in sessionStorage so they survive a reload; without them the fixture
// is unchanged. realScroll: the reader's scrollTo scrolls (otherwise a no-op); long: a chapter long enough to scroll;
// guest: the page starts signed out. For the next-chapter prefetch: noIntersectionObserver removes the API before the
// reader mounts; fakeConnection replaces navigator.connection with one the test sets (fixtureConnection), as the
// browser's own Network Information API cannot be set to data saver or 2g from here.
const options=JSON.parse(sessionStorage.getItem("fixture:options")||"{}");
const realScrollTo=window.scrollTo.bind(window);
window.scrollTo=(...args)=>{if(options.realScroll)realScrollTo(...args)};
if(options.guest)state.user=null;
if(options.noIntersectionObserver)delete window.IntersectionObserver;
if(options.fakeConnection){const connection=Object.assign(new EventTarget(),{saveData:false,effectiveType:"4g"});Object.defineProperty(navigator,"connection",{configurable:true,get:()=>connection});window.fixtureConnection=connection}
const longText=" The narrow road climbed through the pines while the coach swayed and the driver urged the horses on into the dusk.".repeat(6);
const routes=[{id:"chapter-1",slug:"chapter-1"},{id:"chapter-2",slug:"chapter-2"}];
const books=[{slug:"dracula",title:"Dracula",author:"Stoker",coverUrl:null},{slug:"frankenstein",title:"Frankenstein",author:"Shelley",coverUrl:null}];
function position(book,percentage){return {bookSlug:book,editionId:book+"-en",chapterId:"chapter-1",chapterSlug:"chapter-1",chapterTitle:"Chapter 1",chapterNumber:1,chapterIndex:0,totalChapters:1,contentLanguage:"en",percentage,paragraphIndex:0,updatedAt:"2026-01-01T00:00:00.000Z"}}
state.seed=(owner,book,percentage)=>{const p=position(book,percentage);state.cloud.set(owner,[p]);saveScopedReadingProgress(p,{type:"user",userId:owner})};
state.seed("A","dracula",40);
function App(){
 useSyncExternalStore(fn=>{state.route.add(fn);return()=>state.route.delete(fn)},()=>state.mode+state.path);
 const n=state.path.includes("chapter-2")?2:1;
 if(state.mode==="home")return <><div id="continue"><ContinueReading books={books} title="Continue" chapterLabel="Chapter" continueLabel="Read" storageUnavailableLabel="Storage unavailable"/></div><div id="recent"><RecentlyRead books={books} title="Recent" continueLabel="Read"/></div><div id="action"><BookReadingAction bookSlug="dracula" editionId="dracula-en" chapterSlugs={["chapter-1","chapter-2"]} firstChapterSlug="chapter-1" startLabel="Start" continueLabel="Continue" readAgainLabel="Again" progressLabel="{progress}%"/></div></>;
 return <ReaderView bookSlug="dracula" bookTitle="Dracula" author="Stoker" contentLanguage="en" editionId="dracula-en" chapterSlug={"chapter-"+n} chapterId={"chapter-"+n} chapterTitle={"Chapter "+n} chapterRoutes={routes} chapterNumber={n} chapterIndex={n-1} totalChapters={2} previousHref={n===2?"/en/books/dracula/chapter-1":undefined} nextHref={n===1?"/en/books/dracula/chapter-2":undefined}>{options.long?Array.from({length:40},(_,index)=><p key={index}>{"Paragraph "+(index+1)+"."+longText}</p>):<><p>First paragraph.</p><p>Second paragraph.</p></>}</ReaderView>
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

    // Theme and settings panel, by keyboard: the surface (data-reader-theme), the pressed swatch and the portaled
    // panel (data-reader-panel-theme) follow the choice, the panel stays open until Escape returns focus to "Aa", and
    // the theme is restored after another chapter, a remount of the reader and a reload. No CSS is loaded here, so
    // only the attributes are checked, not the colors.
    const keys = {
      Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
      " ": { code: "Space", windowsVirtualKeyCode: 32, text: " " },
      Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
      Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
    };
    const press = async (key) => {
      const { text, ...rest } = keys[key];
      await call("Input.dispatchKeyEvent", { type: "keyDown", key, text, ...rest });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key, ...rest });
      await settle();
    };
    const trigger = "document.querySelector('button[aria-label=readingSettings]')";
    const panel = "document.querySelector('[data-slot=popover-content]')";
    const themeState = () =>
      evaluate(
        `(()=>{const panel=${panel};return {surface:document.querySelector('[data-reader-theme]').dataset.readerTheme,expanded:${trigger}.getAttribute('aria-expanded'),panel:panel?.getAttribute('data-reader-panel-theme')??null,pressed:panel?[...panel.querySelectorAll('button[aria-pressed][aria-label$=Theme]')].map(b=>b.getAttribute('aria-label')+'='+b.getAttribute('aria-pressed')):null,focus:document.activeElement.getAttribute('aria-label')}})()`,
      );
    const storedTheme = async () =>
      JSON.parse(await evaluate("localStorage.getItem('libra:reader-preferences')"))?.theme;

    await evaluate(
      "localStorage.clear();fixture.user=null;fixture.mode='reader';fixture.navigate('/en/books/dracula/chapter-1')",
    );
    await settle();
    assert.deepEqual(await themeState(), {
      surface: "light",
      expanded: "false",
      panel: null,
      pressed: null,
      focus: null,
    });
    await evaluate(`${trigger}.focus()`);
    await press("Enter");
    assert.deepEqual(await themeState(), {
      surface: "light",
      expanded: "true",
      panel: "light",
      pressed: ["lightTheme=true", "sepiaTheme=false", "darkTheme=false"],
      // Focus moves into the panel, onto its first control.
      focus: "lightTheme",
    });
    await press("Tab");
    await press("Enter");
    assert.deepEqual(await themeState(), {
      surface: "sepia",
      expanded: "true",
      panel: "sepia",
      pressed: ["lightTheme=false", "sepiaTheme=true", "darkTheme=false"],
      focus: "sepiaTheme",
    });
    assert.equal(await storedTheme(), "sepia");
    await press("Tab");
    await press(" ");
    assert.deepEqual(await themeState(), {
      surface: "dark",
      expanded: "true",
      panel: "dark",
      pressed: ["lightTheme=false", "sepiaTheme=false", "darkTheme=true"],
      focus: "darkTheme",
    });
    assert.equal(await storedTheme(), "dark");
    await press("Escape");
    assert.deepEqual(await themeState(), {
      surface: "dark",
      expanded: "false",
      panel: null,
      pressed: null,
      focus: "readingSettings",
    });
    assert.equal(await evaluate(`document.activeElement===${trigger}`), true);

    // Another chapter keeps the same reader mounted with new props; leaving for the home page and coming back mounts a
    // new one, which reads the stored theme; a reload starts the page again from storage alone.
    await evaluate("[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').endsWith('chapter-2')).click()");
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 2");
    assert.equal((await themeState()).surface, "dark");
    await evaluate("fixture.mode='home';fixture.navigate('/en')");
    await settle();
    assert.equal(await evaluate("document.querySelector('[data-reader-theme]')"), null);
    await evaluate("fixture.mode='reader';fixture.navigate('/en/books/dracula/chapter-1')");
    await settle();
    assert.equal((await themeState()).surface, "dark");
    await evaluate("window.ready=false;location.reload()");
    for (let attempt = 0; attempt < 100 && !(await evaluate("window.ready===true")); attempt++) await wait(25);
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");
    await evaluate(`${trigger}.focus()`);
    await press("Enter");
    assert.deepEqual(await themeState(), {
      surface: "dark",
      expanded: "true",
      panel: "dark",
      pressed: ["lightTheme=false", "sepiaTheme=false", "darkTheme=true"],
      focus: "lightTheme",
    });
    await press("Escape");
    assert.equal(await evaluate(`document.activeElement===${trigger}`), true);
    console.log("PASS theme by keyboard: surface, pressed swatch and panel follow it; panel stays open until Escape.");
    console.log("PASS theme restored after another chapter, a remount of the reader and a reload.");

    // Reading progress on a real layout: a guest reads a 40-paragraph chapter in an 800x600 viewport, with the reader's
    // scrollTo scrolling for real. The checks use what the page shows and stores (the guest's saved position, the
    // progress bar, where the saved paragraph sits on screen), never the reader's own measuring rule. They depend on the
    // guest storage key below and on the progress bar's classes (h-1, aria-hidden, in ReaderView): renaming either
    // breaks these checks without a fault in the reader.
    const progressKey = "libra:reading-progress:v2:guest:dracula:edition:dracula-en";
    const saved = async () => {
      const progress = JSON.parse(await evaluate(`localStorage.getItem(${JSON.stringify(progressKey)})`));
      return progress && { percentage: progress.percentage, paragraphIndex: progress.paragraphIndex };
    };
    // Polls an expression until it is truthy. A failed evaluation (a page being reloaded) counts as not yet.
    const waitFor = async (expression, label, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await evaluate(expression);
          if (last) return last;
        } catch (error) {
          last = error.message;
        }
        await wait(25);
      }
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
    };
    // Resolves with scrollY once it has not changed for five frames (a wheel scroll may animate).
    const stableScroll = () =>
      evaluate(
        "new Promise(resolve=>{let last=-1,same=0,frames=0;const frame=()=>{frames++;same=scrollY===last?same+1:0;last=scrollY;if(same>=5||frames>300)resolve(scrollY);else requestAnimationFrame(frame)};requestAnimationFrame(frame)})",
      );
    const wheel = async (deltaY) => {
      await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY });
      return stableScroll();
    };
    const bar = () => evaluate("document.querySelector('div.h-1[aria-hidden=true] > div').style.width");
    // Where paragraph `index` sits in the viewport.
    const paragraphTop = (index) =>
      evaluate(`document.querySelectorAll('article p')[${index}].getBoundingClientRect().top`);
    // The paragraph being read is on screen and starts in the upper half of the viewport, or above it when the reader
    // is partway through it.
    const assertReading = async (index, label) => {
      const { top, bottom } = await evaluate(
        `(()=>{const r=document.querySelectorAll('article p')[${index}].getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()`,
      );
      assert.ok(top < 300 && bottom > 0, `${label}: paragraph ${index} from ${top}px to ${bottom}px`);
      return top;
    };
    const loadReader = async () => {
      await call("Page.reload");
      await waitFor("window.ready===true&&document.querySelectorAll('article p').length===40", "the long chapter");
      await settle();
      return stableScroll();
    };

    await call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate(
      "localStorage.clear();sessionStorage.setItem('fixture:options',JSON.stringify({realScroll:true,long:true,guest:true}));window.ready=false",
    );
    await loadReader();
    assert.equal(await evaluate("innerWidth+'x'+innerHeight"), "800x600");
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");

    // 1. A scroll the reader did not cause (a script, a restored position) saves nothing before the reader interacts.
    assert.deepEqual(await saved(), { percentage: 0, paragraphIndex: 0 });
    await evaluate("window.scrollTo(0,1500)");
    assert.ok((await stableScroll()) >= 1000, "the programmatic scroll moved the page");
    await settle();
    assert.deepEqual(await saved(), { percentage: 0, paragraphIndex: 0 });
    assert.equal(await bar(), "0%");
    await evaluate("window.scrollTo(0,0)");
    await stableScroll();
    console.log("PASS progress: a scroll without reader interaction saves nothing.");

    // 2. Wheel scrolling saves a position that grows with the scroll, and the bar shows the saved percentage.
    const positions = [];
    for (let step = 0; step < 3; step++) {
      const before = positions.at(-1) ?? { percentage: 0, paragraphIndex: 0 };
      await wheel(900);
      const after = await waitFor(
        `(()=>{const p=JSON.parse(localStorage.getItem(${JSON.stringify(progressKey)}));return p.paragraphIndex>${before.paragraphIndex}&&p.percentage>${before.percentage}&&{percentage:p.percentage,paragraphIndex:p.paragraphIndex}})()`,
        `progress beyond ${JSON.stringify(before)}`,
      );
      assert.ok(after.percentage > 0 && after.percentage < 100, JSON.stringify(after));
      assert.equal(await bar(), `${after.percentage}%`);
      positions.push(after);
    }
    const reading = positions.at(-1);
    // The saved paragraph is the one being read: on screen, in the upper half of the viewport.
    await assertReading(reading.paragraphIndex, "saved");
    console.log("PASS progress: wheel scrolling saves a growing position and the bar shows it.");

    // 3. Leaving the reader and coming back mounts a new one, which scrolls the saved paragraph back into view.
    await evaluate("fixture.mode='home';fixture.navigate('/en')");
    await settle();
    assert.equal(await evaluate("document.querySelector('article')"), null);
    assert.deepEqual(await saved(), reading);
    await evaluate("fixture.mode='reader';fixture.navigate('/en/books/dracula/chapter-1')");
    await waitFor("scrollY>0", "the restored scroll");
    await stableScroll();
    const restoredTop = await assertReading(reading.paragraphIndex, "restored");
    // Restored to the start of the paragraph, not partway through it.
    assert.ok(restoredTop >= -1, `restored paragraph ${reading.paragraphIndex} starts at ${restoredTop}px`);
    // Restoring is not reading: the saved position is not rewritten, and the bar shows it.
    await settle();
    assert.deepEqual(await saved(), reading);
    assert.equal(await bar(), `${reading.percentage}%`);
    console.log("PASS progress: a remounted reader restores the saved paragraph.");

    // 4. A reload restores the same paragraph to the same place.
    await evaluate("window.ready=false");
    await loadReader();
    await waitFor("scrollY>0", "the restored scroll after a reload");
    await stableScroll();
    const reloadedTop = await paragraphTop(reading.paragraphIndex);
    assert.ok(
      Math.abs(reloadedTop - restoredTop) <= 2,
      `after reload ${reloadedTop}px, after remount ${restoredTop}px`,
    );
    assert.deepEqual(await saved(), reading);
    console.log("PASS progress: a reload restores the same paragraph to the same place.");

    // 5. Leaving right after a scroll, before the frame that would save it, still saves that latest position. The
    // page is scrolled for real; the scroll event is dispatched in the same task so the reader's frame cannot run first.
    // It is a synthetic event: with wheel events the browser decides when the scroll event fires, so that order could
    // not be guaranteed.
    await wheel(300);
    const beforeLeaving = await waitFor(
      `(()=>{const p=JSON.parse(localStorage.getItem(${JSON.stringify(progressKey)}));return p.paragraphIndex>${reading.paragraphIndex}&&{percentage:p.percentage,paragraphIndex:p.paragraphIndex}})()`,
      "the position after an interaction",
    );
    const leaving = await evaluate(`(async()=>{
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const paragraphs=document.querySelectorAll('article p');
      window.scrollTo(0,paragraphs[${beforeLeaving.paragraphIndex}+10].getBoundingClientRect().top+scrollY);
      window.dispatchEvent(new Event('scroll'));
      let frameRan=false;
      requestAnimationFrame(()=>{frameRan=true});
      fixture.mode='home';fixture.navigate('/en');
      await new Promise(resolve=>setTimeout(resolve,0));
      const p=JSON.parse(localStorage.getItem(${JSON.stringify(progressKey)}));
      return {frameRan,unmounted:!document.querySelector('article'),percentage:p.percentage,paragraphIndex:p.paragraphIndex};
    })()`);
    assert.equal(leaving.frameRan, false, "the check ran before the next frame");
    assert.equal(leaving.unmounted, true, "the reader unmounted");
    assert.ok(
      leaving.paragraphIndex > beforeLeaving.paragraphIndex && leaving.percentage > beforeLeaving.percentage,
      `${JSON.stringify(leaving)} after ${JSON.stringify(beforeLeaving)}`,
    );
    console.log("PASS progress: leaving right after a scroll saves the latest position.");

    // 6. At the bottom of the chapter the saved position is 100% and the last paragraph.
    await evaluate("fixture.mode='reader';fixture.navigate('/en/books/dracula/chapter-1')");
    await waitFor("scrollY>0", "the restored scroll before reading to the end");
    await stableScroll();
    for (
      let attempt = 0;
      attempt < 20 && !(await evaluate("scrollY+innerHeight>=document.documentElement.scrollHeight-1"));
      attempt++
    )
      await wheel(1200);
    assert.equal(await evaluate("scrollY+innerHeight>=document.documentElement.scrollHeight-1"), true);
    const end = await waitFor(
      `(()=>{const p=JSON.parse(localStorage.getItem(${JSON.stringify(progressKey)}));return p.percentage===100&&{percentage:p.percentage,paragraphIndex:p.paragraphIndex}})()`,
      "100% at the bottom",
    );
    assert.equal(await bar(), "100%");
    // Known limitation of the reader: the saved paragraph need not be the last one. A last paragraph shorter than the
    // space below the reading point never reaches it, so 100% can come with the one before (here 38 of 0-39). What
    // holds is that the saved paragraph and every one after it, to the end, are on screen; no index is expected.
    const unseen = await evaluate(
      `[...document.querySelectorAll('article p')].slice(${end.paragraphIndex}).map((p,i)=>[${end.paragraphIndex}+i,p.getBoundingClientRect()]).filter(([,r])=>r.bottom<=0||r.top>=innerHeight).map(([i])=>i)`,
    );
    assert.deepEqual(unseen, [], `saved paragraph ${end.paragraphIndex}: paragraphs after it off screen`);
    console.log(
      `PASS progress: the bottom of the chapter saves 100% with paragraph ${end.paragraphIndex} of 0-39 and the rest of the chapter on screen.`,
    );

    await evaluate("sessionStorage.removeItem('fixture:options')");
    await call("Emulation.clearDeviceMetricsOverride");

    // Next-chapter prefetch (usePrefetchNextChapter) on the same long chapter: what reaches router.prefetch and the
    // "Next" link's prefetch prop. router.prefetch is the harness's recorder: whether Next.js fetches, keeps or reuses
    // the chapter is not exercised here.
    const nextHref = "/en/books/dracula/chapter-2";
    const prefetches = () =>
      evaluate("fixture.prefetches.map(p=>({href:p.href,kind:p.kind,onInvalidate:typeof p.onInvalidate}))");
    const nextLinkPrefetch = () => evaluate("document.querySelector('a[rel=next]')?.dataset.prefetch??null");
    // Scrolls so the top of the chapter's footer is `screens` viewport heights below the top of the viewport. The
    // prefetch starts within one screen below the viewport (NEXT_CHAPTER_FOOTER_MARGIN): 2.5 is outside, 1.5 inside.
    const footerAt = async (screens) => {
      await evaluate(
        `window.scrollTo(0,document.querySelector('nav[aria-label=chapterNavigation]').closest('footer').getBoundingClientRect().top+scrollY-innerHeight*${screens})`,
      );
      await stableScroll();
      await settle();
    };
    // A fresh page (and so a fresh prefetcher) at the top of chapter 1, with no saved position and nothing recorded. The
    // reader is left first (for the short home page): a reader still shown would save its position as the page unloads,
    // after the storage is cleared, and the reload would restore it.
    const openChapter = async (extra = {}) => {
      await evaluate("fixture.mode='home';fixture.navigate('/en')");
      await settle();
      await evaluate(
        `localStorage.clear();sessionStorage.setItem('fixture:options',JSON.stringify(${JSON.stringify({ realScroll: true, long: true, guest: true, ...extra })}));window.ready=false`,
      );
      await loadReader();
      assert.equal(await evaluate("scrollY"), 0);
      assert.deepEqual(await prefetches(), []);
    };
    const full = { href: nextHref, kind: "full", onInvalidate: "function" };
    await call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });

    // 1. Nothing while the footer is far; one full prefetch of the next chapter once it is within a screen.
    await openChapter();
    assert.equal(await nextLinkPrefetch(), "true");
    await footerAt(2.5);
    assert.deepEqual(await prefetches(), []);
    await footerAt(1.5);
    await waitFor("fixture.prefetches.length>0", "the prefetch near the footer");
    await settle();
    assert.deepEqual(await prefetches(), [full]);
    console.log(
      "PASS prefetch: one full prefetch of the next chapter once its footer is within a screen, none before.",
    );

    // 2. Crossing the threshold again, and network events, add none for the same URL.
    for (let crossing = 0; crossing < 3; crossing++) {
      await footerAt(2.5);
      await footerAt(1.5);
    }
    await footerAt(0.5);
    await evaluate(
      "window.dispatchEvent(new Event('online'));navigator.connection?.dispatchEvent(new Event('change'))",
    );
    await settle();
    assert.deepEqual(await prefetches(), [full]);
    console.log("PASS prefetch: crossing the threshold again and network events add no prefetch.");

    // 3. An invalidation refreshes the prefetch once; later ones (of either call) do not.
    await evaluate("fixture.prefetches[0].onInvalidate()");
    await waitFor("fixture.prefetches.length===2", "the refresh after an invalidation");
    await evaluate("fixture.prefetches[0].onInvalidate();fixture.prefetches[1].onInvalidate()");
    await settle();
    assert.deepEqual(await prefetches(), [full, full]);
    console.log("PASS prefetch: an invalidation refreshes it once, and only once.");

    // 4. In the last chapter (no next one) a pending invalidation of the previous chapter's prefetch, network events
    // and scrolling start none, and there is no "Next" link. A fresh prefetch is used: one never refreshed would.
    await openChapter();
    await footerAt(1.5);
    await waitFor("fixture.prefetches.length===1", "a fresh prefetch");
    await evaluate("fixture.navigate('/en/books/dracula/chapter-2')");
    await settle();
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 2");
    assert.equal(await evaluate("document.querySelector('a[rel=next]')"), null);
    await evaluate(
      "fixture.prefetches[0].onInvalidate();window.dispatchEvent(new Event('online'));navigator.connection?.dispatchEvent(new Event('change'))",
    );
    await evaluate("window.scrollTo(0,0)");
    await stableScroll();
    await evaluate("window.scrollTo(0,document.documentElement.scrollHeight)");
    await stableScroll();
    await settle();
    assert.deepEqual(await prefetches(), [full]);
    console.log("PASS prefetch: the last chapter starts none, even on an earlier invalidation or network events.");

    // 5. Offline, data saver or 2g: the link keeps its default ("auto") and nothing is prefetched near the footer;
    // once the connection allows it, one prefetch and the full link prefetch. Each case starts on a fresh page.
    await call("Network.enable");
    await openChapter({ fakeConnection: true });
    await call("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await waitFor(
      "navigator.onLine===false&&document.querySelector('a[rel=next]').dataset.prefetch==='auto'",
      "offline",
    );
    await footerAt(1.5);
    assert.deepEqual(await prefetches(), []);
    await call("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await waitFor("navigator.onLine===true&&fixture.prefetches.length===1", "the prefetch once back online");
    await evaluate("window.dispatchEvent(new Event('online'))");
    await settle();
    assert.deepEqual(await prefetches(), [full]);
    assert.equal(await nextLinkPrefetch(), "true");
    for (const [setting, blocked, allowed] of [
      ["saveData", true, false],
      ["effectiveType", "'2g'", "'4g'"],
    ]) {
      await openChapter({ fakeConnection: true });
      await evaluate(`fixtureConnection.${setting}=${blocked};fixtureConnection.dispatchEvent(new Event('change'))`);
      await waitFor("document.querySelector('a[rel=next]').dataset.prefetch==='auto'", `${setting} blocked`);
      await footerAt(1.5);
      assert.deepEqual(await prefetches(), [], setting);
      await evaluate(`fixtureConnection.${setting}=${allowed};fixtureConnection.dispatchEvent(new Event('change'))`);
      await waitFor("fixture.prefetches.length===1", `the prefetch once ${setting} allows it`);
      await evaluate("fixtureConnection.dispatchEvent(new Event('change'))");
      await settle();
      assert.deepEqual(await prefetches(), [full], setting);
      assert.equal(await nextLinkPrefetch(), "true", setting);
    }
    console.log("PASS prefetch: offline, data saver and 2g prefetch nothing; allowed again, exactly one.");

    // 6. Focus: a mouse press on "Next" adds no prefetch of its own; keyboard focus (Tab from "Aa") adds one full
    // prefetch. The press is released elsewhere, so it is not a click and does not navigate.
    await openChapter();
    await footerAt(0.5);
    await waitFor("fixture.prefetches.length===1", "the prefetch near the footer");
    const linkCenter = await evaluate(
      "(()=>{const r=document.querySelector('a[rel=next]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
    );
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...linkCenter, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 300, button: "left", clickCount: 1 });
    await settle();
    assert.deepEqual(
      await evaluate(
        "(()=>{const a=document.activeElement;return [a.getAttribute('rel'),a.matches(':focus-visible')]})()",
      ),
      ["next", false],
    );
    assert.equal(await evaluate("document.querySelector('h1')?.textContent"), "Chapter 1");
    assert.deepEqual(await prefetches(), [full]);
    await evaluate("document.querySelector('button[aria-label=readingSettings]').focus()");
    await press("Tab");
    assert.deepEqual(
      await evaluate(
        "(()=>{const a=document.activeElement;return [a.getAttribute('rel'),a.matches(':focus-visible')]})()",
      ),
      ["next", true],
    );
    assert.deepEqual(await prefetches(), [full, { href: nextHref, kind: "full", onInvalidate: "undefined" }]);
    console.log("PASS prefetch: keyboard focus on Next prefetches the chapter, a mouse press does not.");

    // 7. Without IntersectionObserver, scrolling past the footer prefetches nothing and the link keeps its own full
    // prefetch.
    await openChapter({ noIntersectionObserver: true });
    assert.equal(await evaluate("typeof IntersectionObserver"), "undefined");
    await footerAt(1.5);
    await footerAt(0.5);
    await evaluate("window.scrollTo(0,document.documentElement.scrollHeight)");
    await stableScroll();
    await evaluate("window.dispatchEvent(new Event('online'))");
    await settle();
    assert.deepEqual(await prefetches(), []);
    assert.equal(await nextLinkPrefetch(), "true");
    console.log(
      "PASS prefetch: without IntersectionObserver, scrolling prefetches nothing and the link keeps its own.",
    );

    await evaluate("sessionStorage.removeItem('fixture:options')");
    await call("Emulation.clearDeviceMetricsOverride");
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
