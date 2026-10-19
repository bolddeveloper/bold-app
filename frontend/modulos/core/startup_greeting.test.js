import test from "node:test";
import assert from "node:assert/strict";
import {startupGreeting} from "./startup_greeting.js";
test("startup greets only the authenticated first name with a safe anonymous fallback", () => {
    assert.equal(startupGreeting("  José Miguel Romero "), "Hola, José. Preparando tu espacio de trabajo…");
    assert.equal(startupGreeting(null), "Preparando tu espacio de trabajo…");
});
