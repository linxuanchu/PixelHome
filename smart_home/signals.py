"""
Simple pub-sub signal bus for detection events.
Stage 2: replace subscribers with MQTT publisher, serial writer, or GPIO triggers.
"""

import threading
from datetime import datetime, timezone


class SignalBus:
    """In-memory event bus. Keeps the latest alert per event type so pollers
    (HTTP API, future MQTT/serial adapters) can read state without pushing."""

    def __init__(self):
        self._subscribers = {}  # event_type -> [callable]
        self._latest = {}       # event_type -> dict (the most recent alert)
        self._lock = threading.Lock()

    def subscribe(self, event_type, callback):
        """Register *callback(data)* to be called on every ``emit(event_type, data)``."""
        with self._lock:
            self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, event_type, data):
        """Fire all subscribers for *event_type* and store as latest alert."""
        data["event_type"] = event_type
        data["fired_at"] = datetime.now(timezone.utc).replace(tzinfo=None).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        with self._lock:
            self._latest[event_type] = data
            listeners = list(self._subscribers.get(event_type, []))
        for cb in listeners:
            try:
                cb(data)
            except Exception:
                pass

    def get_alerts(self):
        """Return a snapshot of the latest alert per event type."""
        with self._lock:
            return dict(self._latest)

    def acknowledge(self, event_type):
        """Dismiss the alert for *event_type*."""
        with self._lock:
            self._latest.pop(event_type, None)

    def clear(self):
        """Dismiss all alerts."""
        with self._lock:
            self._latest.clear()


# Module-level singleton shared across the process.
signal_bus = SignalBus()
