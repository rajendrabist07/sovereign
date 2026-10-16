import { createSyncCache, syncKey } from "../lib/auth/sync-cache";
import { createChecker } from "./lib";

const { check, finish } = createChecker();

let clock = 0;
const cache = createSyncCache<string>({ ttlMs: 1000, maxEntries: 2, now: () => clock });

check("miss before anything is stored", cache.get("a") === undefined);
cache.set("a", "A");
check("hit within the TTL", cache.get("a") === "A");
clock = 999;
check("still a hit 1 ms before expiry", cache.get("a") === "A");
clock = 1000;
check("expired at the TTL boundary", cache.get("a") === undefined);

check(
  "a role change is a different key (stale role is never served)",
  syncKey("u", "o", "org:admin") !== syncKey("u", "o", "org:member")
);
check(
  "an organization change is a different key",
  syncKey("u", "o1", "org:admin") !== syncKey("u", "o2", "org:admin")
);
check(
  "a missing role is its own key",
  syncKey("u", "o", undefined) !== syncKey("u", "o", "org:member")
);
check(
  "keys cannot collide through delimiter characters in ids",
  syncKey("a", "b:c", "d") !== syncKey("a:b", "c", "d")
);

clock = 0;
const small = createSyncCache<string>({ ttlMs: 10_000, maxEntries: 2, now: () => clock });
small.set("x", "X");
small.set("y", "Y");
small.set("z", "Z");
check(
  "the oldest entry is evicted at capacity",
  small.get("x") === undefined && small.get("y") === "Y" && small.get("z") === "Z"
);

const refresh = createSyncCache<string>({ ttlMs: 10_000, maxEntries: 2, now: () => clock });
refresh.set("x", "X");
refresh.set("y", "Y");
refresh.set("x", "X2");
refresh.set("z", "Z");
check(
  "re-setting a key makes it the newest, so the other one is evicted",
  refresh.get("x") === "X2" && refresh.get("y") === undefined && refresh.get("z") === "Z"
);

finish();
