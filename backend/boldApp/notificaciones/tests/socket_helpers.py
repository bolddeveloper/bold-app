"""Consume multiplexed sockets with one deadline, never hide unexpected data.

Presence/security frames can precede a notification or a close. Reading exactly
one frame tests queue order, not delivery or revocation. Only known control
frames may be skipped; missing events and unexpected application data fail.
"""
import asyncio
import json


CONTROL_EVENTS = {"control.ready", "permissions.revision", "assignment.changed"}


async def receive_until(socket, predicate, *, timeout=2):
    deadline = asyncio.get_running_loop().time() + timeout
    for _ in range(200):
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise AssertionError("Expected socket event did not arrive before the deadline")
        frame = await socket.receive_output(timeout=remaining)
        if predicate(frame):
            return frame
        if frame.get("type") != "websocket.send":
            raise AssertionError(f"Unexpected socket frame: {frame}")
        event = json.loads(frame["text"])
        if event.get("entity_type") != "security_control" or event.get("event_type") not in CONTROL_EVENTS:
            raise AssertionError(f"Unexpected event while waiting: {event.get('event_type')}")
        payload = event["payload"]
        if not isinstance(payload.get("force"), bool) or payload.get("sequence", 0) < 1:
            raise AssertionError("Invalid control frame")
    raise AssertionError("Too many frames before the expected socket event")


async def receive_event(socket, event_type, *, payload_matches=lambda payload: True, timeout=2):
    types = {event_type} if isinstance(event_type, str) else set(event_type)
    def matches(frame):
        if frame.get("type") != "websocket.send":
            return False
        event = json.loads(frame["text"])
        return event.get("event_type") in types and payload_matches(event["payload"])

    frame = await receive_until(socket, matches, timeout=timeout)
    return json.loads(frame["text"])


async def receive_close(socket, *, timeout=2):
    return await receive_until(socket, lambda frame: frame.get("type") == "websocket.close", timeout=timeout)
