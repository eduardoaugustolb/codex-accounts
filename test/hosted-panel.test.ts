import { expect, test } from "bun:test";
import { hostedPanelCors, hostedPanelOrigin, hostedPanelUrl } from "../src/hosted-panel";

test("hosted panel pairing keeps the local capability in a fragment", () => {
  const local = "http://127.0.0.1:32123/fixture-secret/";
  const url = new URL(hostedPanelUrl(local));
  expect(url.origin).toBe(hostedPanelOrigin);
  expect(url.pathname).toBe("/");
  expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("connect")).toBe(local);
});

test("only the exact hosted origin receives CORS access", () => {
  for (const origin of ["https://evil.example", "null", hostedPanelOrigin + ".evil.example", "http://ca.eduardoaugusto.work"]) {
    expect(hostedPanelCors(new Request("http://127.0.0.1", { headers: { origin } }))).toEqual({});
  }
  const headers = hostedPanelCors(new Request("http://127.0.0.1", { headers: { origin: hostedPanelOrigin } }));
  expect(headers["access-control-allow-origin"]).toBe(hostedPanelOrigin);
  expect(headers["access-control-allow-private-network"]).toBe("true");
  expect(headers["access-control-allow-credentials"]).toBeUndefined();
});
