export function startupGreeting(name) {
    const first = typeof name === "string" ? name.trim().split(/\s+/)[0] : "";
    return first ? `Hola, ${first}. Preparando tu espacio de trabajo…` : "Preparando tu espacio de trabajo…";
}
