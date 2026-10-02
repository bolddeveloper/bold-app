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

test("completar Inicio no omite los otros módulos ni los formularios", () => {
    const storage = memoryStorage(), identity = { id: "a" };
    writeOnboardingState(storage, identity, "completed", "home");
    for (const guide of ["tasks", "suggestions", "task-create", "task-detail"]) {
        assert.equal(readOnboardingState(storage, identity, guide), null);
        assert.notEqual(onboardingStorageKey(identity, guide), onboardingStorageKey(identity));
    }
    writeOnboardingState(storage, identity, "skipped", "tasks");
    assert.equal(readOnboardingState(storage, identity, "tasks").status, "skipped");
    assert.equal(readOnboardingState(storage, identity).status, "completed");
});

test("ignora el recorrido global antiguo y estados de otra versión o guía", () => {
    const identity = { id: "a" };
    for (const data of [{ status: "completed", version: "1" }, { status: "completed", version: "2", guide: "tasks" }]) {
        assert.equal(readOnboardingState({ getItem: () => JSON.stringify(data) }, identity, "home"), null);
    }
});

test("almacenamiento bloqueado no impide el recorrido", () => {
    assert.equal(readOnboardingState(null, { id: "a" }), null);
    assert.equal(writeOnboardingState(null, { id: "a" }, "completed").status, "completed");
});
