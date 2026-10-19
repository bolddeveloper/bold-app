import {test} from "node:test";
import assert from "node:assert/strict";
import Swal from "sweetalert2";
import {confirmBold, promptBold} from "./bold_dialog.js";

test("Los avisos BOLD esperan confirmación y conservan cancelación, texto plano y entrada", async () => {
    const original = Swal.fire, calls = [];
    let answer;
    Swal.fire = async options => {calls.push(options); return answer;};
    try {
        answer = {isConfirmed: false};
        assert.equal(await confirmBold("¿Descartar cambios?"), false);
        answer = {isConfirmed: true};
        assert.equal(await confirmBold("¿Eliminar?"), true);
        answer = {isConfirmed: false};
        assert.equal(await promptBold("Nombre", "Original"), null);
        answer = {isConfirmed: true, value: "Nuevo"};
        assert.equal(await promptBold("<script>texto</script>", "Original"), "Nuevo");
        assert.equal(calls[0].focusCancel, true);
        assert.equal(calls[0].allowOutsideClick, false);
        assert.equal(calls[0].showCancelButton, true);
        assert.equal(calls[0].cancelButtonText, "Cancelar");
        assert.equal(calls[3].text, "<script>texto</script>");
        assert.equal(calls[3].html, undefined);
        assert.equal(calls[3].input, "text");
        assert.equal(calls[3].inputValue, "Original");
        assert.equal(calls[0].customClass.popup, "bold_dialog");
    } finally {Swal.fire = original;}
});

// Preparado; no ejecutar mientras siga vigente la indicación de no probar.
test("Las confirmaciones dentro de un diálogo nativo usan su capa visible", async () => {
    const originalFire = Swal.fire, originalDocument = globalThis.document;
    const first = {}, last = {};
    globalThis.document = {querySelectorAll: () => [first, last]};
    let options;
    Swal.fire = async value => {options = value; return {isConfirmed: true};};
    try {
        assert.equal(await confirmBold("¿Restaurar versión?"), true);
        assert.equal(options.target, last);
    } finally {
        Swal.fire = originalFire;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test("La preferencia del aviso se guarda solo al aceptar con No volver a mostrar", async () => {
    const originalFire = Swal.fire, originalStorage = globalThis.localStorage;
    const saved = new Map();
    globalThis.localStorage = {getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value)};
    let answer = {isConfirmed: false}, calls = 0;
    Swal.fire = async () => {calls++; return answer;};
    try {
        assert.equal(await confirmBold("Compartir", {rememberKey: "person-a"}), false);
        assert.equal(saved.size, 0);
        answer = {isConfirmed: true};
        assert.equal(await confirmBold("Compartir", {rememberKey: "person-a"}), true);
        assert.equal(saved.size, 0);
        answer = {isDenied: true};
        assert.equal(await confirmBold("Compartir", {rememberKey: "person-a"}), true);
        assert.equal(saved.get("person-a"), "1");
        assert.equal(await confirmBold("Compartir", {rememberKey: "person-a"}), true);
        assert.equal(calls, 3);
        answer = {isConfirmed: false};
        assert.equal(await confirmBold("Compartir", {rememberKey: "person-b"}), false);
        assert.equal(calls, 4);
    } finally {
        Swal.fire = originalFire;
        if (originalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalStorage;
    }
});
