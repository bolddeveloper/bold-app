import assert from "node:assert/strict";
import test from "node:test";
import { onboardingStorageKey, readOnboardingState, writeOnboardingState } from "./onboarding_state.js";

function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("el onboarding se separa por asignación", () => {
    assert.notEqual(onboardingStorageKey({ id: "a" }), onboardingStorageKey({ id: "b" }));
});

test("guarda y recupera los estados terminales", () => {
    const storage = memoryStorage(), identity = { id: "assignment-1" };
    writeOnboardingState(storage, identity, "completed");
    assert.equal(readOnboardingState(storage, identity).status, "completed");
});

test("ignora valores dañados o desconocidos", () => {
    const identity = { id: "assignment-1" };
    assert.equal(readOnboardingState({ getItem: () => "not-json" }, identity), null);
    assert.equal(readOnboardingState({ getItem: () => '{"status":"pending"}' }, identity), null);
});
