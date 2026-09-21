import assert from "node:assert/strict";
import test from "node:test";

import { createCoreApi } from "../../core/core_api.js";


test("TOTP setup and confirmation always reauthenticate with the current password", async () => {
    const calls = [];
    const client = {
        request: async (path, options) => {
            calls.push({ path, options });
            return {};
        },
        list: async () => [],
        setSession() {},
        getSession: () => ({}),
    };
    const api = createCoreApi(client);

    await api.setupTotp("Teléfono corporativo", "frase-secreta");
    await api.confirmTotp("method-id", "123456", "frase-secreta");

    assert.deepEqual(calls, [
        {
            path: "/api/v2/auth/mfa/totp/setup/",
            options: {
                method: "POST",
                body: {
                    label: "Teléfono corporativo",
                    current_password: "frase-secreta",
                },
            },
        },
        {
            path: "/api/v2/auth/mfa/totp/confirm/",
            options: {
                method: "POST",
                body: {
                    method_id: "method-id",
                    code: "123456",
                    current_password: "frase-secreta",
                },
            },
        },
    ]);
});
