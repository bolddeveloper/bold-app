import test from "node:test";
import assert from "node:assert/strict";
import {containsNewUnreadNotification, notificationSounds, defaultNotificationSettings, showDesktopNotification} from "../core/notification_sound.js";

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
