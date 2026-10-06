import {test} from "node:test";
import assert from "node:assert/strict";
import {defaultShortcuts, shortcutFromEvent, shortcutError, canRunShortcut} from "./keyboard_shortcuts.js";

test("Atajos: números con Shift, conflictos, teclas reservadas y escritura", () => {
    const event = {ctrlKey: true, shiftKey: true, code: "Digit5", key: "%"};
    assert.equal(shortcutFromEvent(event), "Ctrl+Shift+5");
    assert.equal(shortcutFromEvent({...event, isComposing: true}), "");
    assert.equal(shortcutFromEvent({...event, getModifierState: () => true}), "");
    assert.equal(shortcutFromEvent({...event, ctrlKey: false, metaKey: true}), "Meta+Shift+5");
    assert.match(shortcutError(defaultShortcuts.drive, defaultShortcuts, "tasks"), /asignado/);
    assert.match(shortcutError("Ctrl+S", defaultShortcuts, "tasks"), /reservada/);
    assert.equal(shortcutError("Ctrl+Alt+Z", defaultShortcuts, "tasks"), "");
    assert.equal(canRunShortcut({target: {closest: () => ({})}}, false), false);
    assert.equal(canRunShortcut({}, true), false);
    assert.equal(canRunShortcut({repeat: true}, false), false);
    assert.equal(canRunShortcut({defaultPrevented: true}, false), false);
    assert.equal(canRunShortcut({}, false), true);
    assert.equal(new Set(Object.values(defaultShortcuts)).size, Object.keys(defaultShortcuts).length);
});
