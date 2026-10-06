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
