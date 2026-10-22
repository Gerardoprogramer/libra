import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { registerServiceWorker, ServiceWorkerRegistration } from "./ServiceWorkerRegistration";

function fakeNavigator(register: (url: string, options: RegistrationOptions) => Promise<unknown>) {
  const calls: [string, RegistrationOptions][] = [];
  const browser = {
    serviceWorker: {
      register: (url: string, options: RegistrationOptions) => {
        calls.push([url, options]);
        return register(url, options);
      },
    },
  } as unknown as Navigator;
  return { browser, calls };
}

test("in production, the offline fallback worker is registered for the whole site, fetched past the HTTP cache", async () => {
  const registration = {};
  const { browser, calls } = fakeNavigator(async () => registration);

  assert.equal(await registerServiceWorker("production", browser), registration);
  assert.deepEqual(calls, [["/sw.js", { scope: "/", updateViaCache: "none" }]]);
});

test("outside production builds, nothing is registered", () => {
  for (const environment of ["development", "test", undefined]) {
    const { browser, calls } = fakeNavigator(async () => ({}));

    assert.equal(registerServiceWorker(environment, browser), null);
    assert.equal(calls.length, 0);
  }
});

test("a browser without service workers is left alone", () => {
  assert.equal(registerServiceWorker("production", {} as Navigator), null);
  assert.equal(registerServiceWorker("production", undefined), null);
});

test("a failed registration is ignored, so the page goes on without the worker", async () => {
  const { browser } = fakeNavigator(async () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });

  assert.equal(await registerServiceWorker("production", browser), null);
});

test("on the server it renders nothing and registers nothing", () => {
  assert.equal(renderToStaticMarkup(<ServiceWorkerRegistration />), "");
});
