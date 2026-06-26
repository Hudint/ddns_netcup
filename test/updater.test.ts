import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUpdate, computeRecordUpdate } from "../src/updater.js";
import { mapHostname, type AppConfig } from "../src/config.js";
import type { NetcupClient, DnsRecord } from "../src/netcup.js";

const config: AppConfig = {
  port: 8080,
  trustProxy: false,
  netcup: { customerNumber: "1", apiKey: "k", apiPassword: "p", apiUrl: "http://x" },
  ddnsToken: "t",
  allowedDomains: ["example.com", "b.example.com"],
  allowedHostnames: [],
  enableIpv4: true,
  enableIpv6: true,
};

/** A fake NetcupClient that records which records it was asked to push. */
function fakeClient(existing: DnsRecord[] = []) {
  const calls: { domain: string; pushed: DnsRecord[] }[] = [];
  const client = {
    async withDomain(domain: string, work: (records: DnsRecord[]) => DnsRecord[]) {
      calls.push({ domain, pushed: work(existing) });
    },
  } as unknown as NetcupClient;
  return { client, calls };
}

test("mapHostname maps a subdomain to zone + record host", () => {
  assert.deepEqual(mapHostname("home.example.com", config), {
    domain: "example.com",
    recordHost: "home",
  });
});

test("mapHostname maps the apex to @", () => {
  assert.deepEqual(mapHostname("example.com", config), {
    domain: "example.com",
    recordHost: "@",
  });
});

test("mapHostname prefers the longest matching zone", () => {
  assert.deepEqual(mapHostname("x.b.example.com", config), {
    domain: "b.example.com",
    recordHost: "x",
  });
});

test("mapHostname rejects hostnames outside allowed domains", () => {
  assert.equal(mapHostname("home.evil.com", config), null);
});

test("mapHostname enforces explicit allowedHostnames when set", () => {
  const restricted = { ...config, allowedHostnames: ["home.example.com"] };
  assert.deepEqual(mapHostname("home.example.com", restricted), {
    domain: "example.com",
    recordHost: "home",
  });
  assert.equal(mapHostname("other.example.com", restricted), null);
});

const existing: DnsRecord[] = [
  { id: "101", hostname: "home", type: "A", destination: "1.1.1.1", priority: "0" },
  { id: "102", hostname: "home", type: "AAAA", destination: "::1", priority: "0" },
];

test("computeRecordUpdate updates an existing record in place, keeping its id", () => {
  const d = computeRecordUpdate(existing, "home", "A", "2.2.2.2");
  assert.equal(d.changed, true);
  assert.equal(d.record.id, "101");
  assert.equal(d.record.destination, "2.2.2.2");
  assert.equal(d.record.deleterecord, false);
});

test("computeRecordUpdate reports no change when destination is identical", () => {
  const d = computeRecordUpdate(existing, "home", "A", "1.1.1.1");
  assert.equal(d.changed, false);
  assert.equal(d.record.id, "101");
});

test("computeRecordUpdate creates a new record (no id) when none matches", () => {
  const d = computeRecordUpdate(existing, "new", "A", "3.3.3.3");
  assert.equal(d.changed, true);
  assert.equal(d.record.id, undefined);
  assert.equal(d.record.hostname, "new");
  assert.equal(d.record.destination, "3.3.3.3");
});

test("applyUpdate skips IPv6 when ENABLE_IPV6 is false (no session opened)", async () => {
  const cfg = { ...config, enableIpv6: false };
  const { client, calls } = fakeClient(existing);
  const results = await applyUpdate(client, cfg, "home.example.com", { ipv6: "2001:db8::99" });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 0); // disabled-only request never touches Netcup
});

test("applyUpdate honours ENABLE_IPV4=false but still updates IPv6", async () => {
  const cfg = { ...config, enableIpv4: false };
  const { client, calls } = fakeClient(existing);
  const results = await applyUpdate(client, cfg, "home.example.com", {
    ipv4: "9.9.9.9",
    ipv6: "2001:db8::99",
  });
  assert.deepEqual(
    results.map((r) => r.type),
    ["AAAA"],
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.pushed.length, 1);
  assert.equal(calls[0]!.pushed[0]!.type, "AAAA");
});

test("applyUpdate updates both families when both enabled", async () => {
  const { client, calls } = fakeClient(existing);
  const results = await applyUpdate(client, config, "home.example.com", {
    ipv4: "9.9.9.9",
    ipv6: "2001:db8::99",
  });
  assert.deepEqual(
    results.map((r) => r.type).sort(),
    ["A", "AAAA"],
  );
  assert.equal(calls[0]!.pushed.length, 2);
});
