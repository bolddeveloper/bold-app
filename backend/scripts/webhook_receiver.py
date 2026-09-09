"""Receptor HTTP local para probar y verificar webhooks de boldApp."""

import hashlib
import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 9000
state = {"secrets": [], "events": []}


class WebhookHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "configured_secrets": len(state["secrets"])})
            return

        if self.path == "/events":
            self._send_json(200, {"count": len(state["events"]), "events": state["events"]})
            return

        self._send_json(404, {"detail": "Ruta no encontrada."})

    def do_POST(self):
        body = self._read_body()

        if self.path == "/configure":
            try:
                payload = json.loads(body)
                secret = payload["secret"]
                reset = payload.get("reset", True)
                if not isinstance(secret, str) or not secret:
                    raise ValueError
            except (json.JSONDecodeError, KeyError, ValueError):
                self._send_json(400, {"detail": "Se requiere un secret no vacío."})
                return

            if reset:
                state["secrets"].clear()
                state["events"].clear()
            if secret not in state["secrets"]:
                state["secrets"].append(secret)
            self._send_json(200, {"configured": True, "configured_secrets": len(state["secrets"])})
            return

        if self.path == "/reset":
            state["events"].clear()
            self._send_json(200, {"events_cleared": True})
            return

        if self.path != "/webhook":
            self._send_json(404, {"detail": "Ruta no encontrada."})
            return

        if not state["secrets"]:
            self._send_json(503, {"detail": "Configura primero el secreto en POST /configure."})
            return

        received_signature = self.headers.get("X-BoldApp-Signature", "")
        signature_valid = any(
            hmac.compare_digest(
                received_signature,
                hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest(),
            )
            for secret in state["secrets"]
        )

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._send_json(400, {"detail": "El cuerpo no es JSON válido."})
            return

        event = {
            "event_type": self.headers.get("X-BoldApp-Event"),
            "event_id": payload.get("event_id"),
            "entity_type": payload.get("entity_type"),
            "entity_id": payload.get("entity_id"),
            "signature_valid": signature_valid,
            "payload": payload,
        }
        state["events"].append(event)
        print(
            f"{event['event_type']} {event['event_id']} "
            f"firma={'válida' if signature_valid else 'INVÁLIDA'}",
            flush=True,
        )

        self._send_json(
            200 if signature_valid else 401,
            {"received": True, "signature_valid": signature_valid},
        )

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), WebhookHandler)
    print(f"Receptor listo en http://{HOST}:{PORT}/webhook", flush=True)
    print(f"Eventos capturados en http://{HOST}:{PORT}/events", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nReceptor detenido.")
    finally:
        server.server_close()
