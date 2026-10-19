import Swal from "sweetalert2";

// Avisos de BOLD: texto plano, foco contenido y cancelación con Escape.
function dialog(options) {
    const target = [...(globalThis.document?.querySelectorAll?.("dialog[open]") || [])].at(-1);
    return Swal.fire({
        title: "BOLD", confirmButtonText: "Aceptar", cancelButtonText: "Cancelar",
        showCancelButton: true, focusCancel: true, allowOutsideClick: false,
        customClass: {container: "bold_dialog_container", popup: "bold_dialog", confirmButton: "bold_dialog_confirm", cancelButton: "bold_dialog_cancel", denyButton: "bold_dialog_cancel"},
        ...(target ? {target} : {}),
        ...options,
    });
}

export async function confirmBold(message, {rememberKey, title = "BOLD"} = {}) {
    try { if (rememberKey && localStorage.getItem(rememberKey) === "1") return true; } catch { /* The notice remains available without storage. */ }
    const result = await dialog({text: message, title, showDenyButton: Boolean(rememberKey), denyButtonText: "No volver a mostrar"});
    if (rememberKey && result.isDenied) {
        try { localStorage.setItem(rememberKey, "1"); } catch { /* Accept this action without persisting the preference. */ }
    }
    return Boolean(result.isConfirmed || rememberKey && result.isDenied);
}

export async function promptBold(message, value = "") {
    // Los campos del diálogo no deben perder la selección del editor original.
    const selection = globalThis.window?.getSelection?.();
    const ranges = selection ? Array.from({length: selection.rangeCount}, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const result = await dialog({text: message, input: "text", inputValue: value, focusCancel: false});
    if (selection && ranges.every(range => range.commonAncestorContainer.isConnected)) {
        selection.removeAllRanges();
        ranges.forEach(range => selection.addRange(range));
    }
    return result.isConfirmed ? result.value : null;
}
