import test from "node:test";
import assert from "node:assert/strict";
import { createDraftSync } from "./draft_sync.js";

function clock() {
    let time = 0, serial = 0; const timers = new Map();
    return { now: () => time, setTimer(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; }, clearTimer: id => timers.delete(id),
        async advance(ms) {
            const target = time + ms;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= target);
                if (!next) break;
                time = next[1].at; timers.delete(next[0]); await next[1].fn();
            }
            time = target;
        },
    };
}

test("Meet wait is finite, retries explicitly and never polls hidden/offline", async () => {
    const time = clock(); let active = true, polls = 0, heartbeats = 0; const warnings = [];
    const sync = createDraftSync({ ...time, canRun: () => active, needsMeet: () => true,
        poll: async () => { polls++; return {}; }, heartbeat: async () => { heartbeats++; }, onWarning: message => warnings.push(message),
    });
    try {
        await time.advance(60_000); assert.ok(polls > 0 && polls <= 12); assert.equal(warnings.length, 1);
        const count = polls; await time.advance(120_000); assert.equal(polls, count);
        active = false; await time.advance(120_000); assert.equal(polls, count); assert.equal(heartbeats, 3);
        active = true; sync.retry(); await time.advance(5_000); assert.equal(polls, count + 1);
    } finally { sync.stop(); }
});

test("Meet errors stop repeated reads, but keep recoverable draft heartbeat", async () => {
    const time = clock(); let polls = 0, beats = 0, warnings = 0;
    const sync = createDraftSync({ ...time, needsMeet: () => true, poll: async () => { polls++; throw new Error("offline"); },
        heartbeat: async () => { beats++; }, onWarning: () => warnings++,
    });
    try { await time.advance(300_000); assert.equal(polls, 3); assert.equal(warnings, 1); assert.equal(beats, 5); }
    finally { sync.stop(); }
});

test("completed Meet links stop polling and draft lifetime is bounded", async () => {
    const time = clock(); let pending = true, polls = 0, beats = 0, expired = 0;
    const sync = createDraftSync({ ...time, lifetimeMs: 120_000, needsMeet: () => pending,
        poll: async () => { polls++; return { hangoutLink: "https://meet.example" }; }, onEvent: () => { pending = false; },
        heartbeat: async () => { beats++; }, onExpired: () => expired++,
    });
    await time.advance(600_000); assert.equal(polls, 1); assert.equal(beats, 1); assert.equal(expired, 1); sync.stop();
});

test("slow requests cannot overlap, and unmount ignores a late event", async () => {
    let tick, resolve, signal, events = 0, requests = 0, schedules = 0;
    const sync = createDraftSync({ now: () => 0, pollMs: 0, needsMeet: () => true,
        setTimer: fn => { tick = fn; schedules++; return schedules; }, clearTimer: () => {},
        poll: options => { requests++; signal = options.signal; return new Promise(done => { resolve = done; }); },
        heartbeat: async () => {}, onEvent: () => events++,
    });
    const pending = tick(); await tick(); assert.equal(requests, 1); assert.equal(schedules, 1);
    sync.stop(); assert.equal(signal.aborted, true); resolve({}); await pending; assert.equal(events, 0); assert.equal(schedules, 1);
});

test("expired server draft stops heartbeat and informs recovery once", async () => {
    const time = clock(); let beats = 0, expired = 0;
    const sync = createDraftSync({ ...time, needsMeet: () => false, poll: async () => ({}),
        heartbeat: async () => { beats++; throw Object.assign(new Error("expired"), { status: 400 }); }, onExpired: () => expired++,
    });
    await time.advance(300_000); assert.equal(beats, 1); assert.equal(expired, 1); sync.stop();
});
