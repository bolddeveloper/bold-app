import test from "node:test";
import assert from "node:assert/strict";
import {startNotificationBellReminder} from "../core/notification_bell.js";
import {defaultNotificationSettings} from "../core/notification_sound.js";

test("la campana espera cinco minutos, anima dos segundos y vuelve a descansar", context => {
    context.mock.timers.enable({apis: ["setInterval", "setTimeout"]});
    const pulses = [];
    assert.equal(defaultNotificationSettings.bell_interval_minutes, 5);
    const stop = startNotificationBellReminder(defaultNotificationSettings.bell_interval_minutes, value => pulses.push(value), () => true);
    context.mock.timers.tick(299_999);
    assert.deepEqual(pulses, []);
    context.mock.timers.tick(1);
    assert.deepEqual(pulses, [true]);
    context.mock.timers.tick(1_999);
    assert.deepEqual(pulses, [true]);
    context.mock.timers.tick(1);
    assert.deepEqual(pulses, [true, false]);
    context.mock.timers.tick(297_999);
    assert.deepEqual(pulses, [true, false]);
    context.mock.timers.tick(1);
    assert.deepEqual(pulses, [true, false, true]);
    stop();
    context.mock.timers.tick(600_000);
    assert.deepEqual(pulses, [true, false, true]);
});

test("el intervalo elegido se respeta y no anima una pestaña oculta", context => {
    context.mock.timers.enable({apis: ["setInterval", "setTimeout"]});
    const pulses = [];
    let visible = false;
    const stop = startNotificationBellReminder(2, value => pulses.push(value), () => visible);
    context.mock.timers.tick(120_000);
    assert.deepEqual(pulses, []);
    visible = true;
    context.mock.timers.tick(120_000);
    assert.deepEqual(pulses, [true]);
    context.mock.timers.tick(2_000);
    assert.deepEqual(pulses, [true, false]);
    stop();
    context.mock.timers.tick(120_000);
    assert.deepEqual(pulses, [true, false]);
});
