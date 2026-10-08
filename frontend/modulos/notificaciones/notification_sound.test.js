import test from "node:test";
import assert from "node:assert/strict";
import {containsNewUnreadNotification, createEntryNotificationSound, notificationSounds, defaultNotificationSettings, showDesktopNotification} from "../core/notification_sound.js";

test("entry sound waits for settings and plays once despite repeated refreshes", async () => {
    const calls = [], target = new EventTarget(), rows = [{id: "pending", is_read: false}];
    const entry = createEntryNotificationSound({target, visible: () => true, play: async settings => calls.push(settings)});
    await entry.update(rows, null);
    assert.equal(calls.length, 0);
    await entry.update(rows, defaultNotificationSettings);
    await entry.update(rows, defaultNotificationSettings);
    target.dispatchEvent(new Event("pointerdown"));
    assert.deepEqual(calls, [defaultNotificationSettings]);
    entry.dispose();
});

test("entry sound retries autoplay blocking on interaction and stops after success", async () => {
    let calls = 0;
    const target = new EventTarget();
    const entry = createEntryNotificationSound({target, visible: () => true, play: async () => { if (++calls === 1) throw new DOMException("Blocked", "NotAllowedError"); }});
    await entry.update([{is_read: false}], defaultNotificationSettings);
    target.dispatchEvent(new Event("keydown"));
    await Promise.resolve();
    target.dispatchEvent(new Event("pointerdown"));
    assert.equal(calls, 2);
    entry.dispose();
});

test("entry sound respects mute, read notifications, visibility and cleanup", async () => {
    let calls = 0, visible = false;
    for (const [rows, settings] of [[[], defaultNotificationSettings], [[{is_read: true}], defaultNotificationSettings], [[{is_read: false}], {...defaultNotificationSettings, enabled: false}]]) {
        const entry = createEntryNotificationSound({target: new EventTarget(), visible: () => true, play: async () => calls++});
        await entry.update(rows, settings);
        assert.equal(calls, 0);
        entry.dispose();
    }
    const target = new EventTarget(), entry = createEntryNotificationSound({target, visible: () => visible, play: async () => calls++});
    await entry.update([{is_read: false}], defaultNotificationSettings);
    assert.equal(calls, 0);
    visible = true;
    target.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    assert.equal(calls, 1);
    entry.dispose();
    target.dispatchEvent(new Event("pointerdown"));
    assert.equal(calls, 1);
});

test("notification tones play only for newly received unread items, not bootstrap or read changes", () => {
    const old = [{id: "first", is_read: false}];
    assert.equal(containsNewUnreadNotification(null, old), false);
    assert.equal(containsNewUnreadNotification(old, [{id: "first", is_read: true}]), false);
    assert.equal(containsNewUnreadNotification(old, [...old, {id: "second", is_read: false}]), true);
    assert.equal(containsNewUnreadNotification(old, [...old, {id: "second", is_read: true}]), false);
    assert.equal(containsNewUnreadNotification([], old), true);
});


test("five supplied audio presets replace synthesized tones", () => {
    assert.equal(notificationSounds.length, 5);
    assert.equal(defaultNotificationSettings.sound, "post");
    assert.equal(notificationSounds.some(([id]) => ["soft", "bell", "double"].includes(id)), false);
});


test("desktop alerts require saved opt-in and browser permission", () => {
    const original = globalThis.Notification, notices = [];
    try {
        globalThis.Notification = class {static permission = "default"; constructor(title, options) {notices.push({title, options});}};
        const row = {id: "private", title: "BOLD", body: "Nuevo aviso"};
        showDesktopNotification(row, {desktop_enabled: true}); assert.equal(notices.length, 0);
        Notification.permission = "granted";
        showDesktopNotification(row, {desktop_enabled: false}); assert.equal(notices.length, 0);
        showDesktopNotification(row, {desktop_enabled: true}); assert.equal(notices.length, 1);
        assert.equal(notices[0].options.tag, "bold-private");
        assert.equal(notices[0].options.silent, true);
    } finally {if (original) globalThis.Notification = original; else delete globalThis.Notification;}
});
