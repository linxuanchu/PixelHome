import json
import math
import threading
import time


class ArduinoHomeAdapter:
    mode = "arduino"
    EMPTY = {
        "temperature": None, "humidity": None, "door": None,
        "window": None, "light": None, "fan": None, "online": False,
    }

    def __init__(self, port, serial_factory=None, boot_delay=2.0):
        if serial_factory is None:
            from serial import Serial

            serial_factory = Serial
        self.port = port
        self.serial_factory = serial_factory
        self.boot_delay = boot_delay
        self._serial = None
        self._lock = threading.Lock()
        self._state = self._offline("Waiting for Arduino")

    def _offline(self, error):
        return {**self.EMPTY, "port": self.port, "error": str(error)}

    def snapshot(self):
        return self._state.copy()

    def _request(self, line):
        with self._lock:
            try:
                if self._serial is None:
                    self._serial = self.serial_factory(
                        self.port, baudrate=115200, timeout=0.8, write_timeout=0.5
                    )
                    time.sleep(self.boot_delay)
                self._serial.reset_input_buffer()
                self._serial.write(line.encode("ascii") + b"\n")
                raw = self._serial.read_until(b"\n", size=256)
                if not raw:
                    raise ValueError(f"No reply to {line} at 115200 baud")
                if not raw.endswith(b"\n"):
                    raise ValueError("Incomplete Arduino reply")
                packet = json.loads(raw)
                if not isinstance(packet, dict) or packet.get("protocol") != "pixelhome-1":
                    raise ValueError("Unexpected Arduino protocol")
                if packet.get("command") != line:
                    raise ValueError("Unexpected Arduino reply")
                temp, humidity = packet["temperature"], packet["humidity"]
                if temp is not None and (type(temp) not in (int, float) or not math.isfinite(temp) or not -40 <= temp <= 85):
                    raise ValueError("Invalid temperature")
                if humidity is not None and (type(humidity) not in (int, float) or not math.isfinite(humidity) or not 0 <= humidity <= 100):
                    raise ValueError("Invalid humidity")
                if packet["door"] not in {"open", "closed"} or not isinstance(packet["fan"], bool):
                    raise ValueError("Invalid actuator state")
                if type(packet["light"]) is not int or not 0 <= packet["light"] <= 100:
                    raise ValueError("Invalid light setting")
                self._state = {
                    **self.EMPTY, "port": self.port, "online": True,
                    "temperature": temp, "humidity": humidity, "door": packet["door"],
                    "light": packet["light"], "fan": packet["fan"],
                }
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                self._state = self._offline(error)
                self._disconnect()
                raise OSError(f"Arduino {self.port} is offline: {error}") from error
            return self.snapshot()

    def poll(self):
        try:
            return self._request("STATUS")
        except OSError:
            return self.snapshot()

    def command(self, device, action=None, value=None):
        if device == "door" and action in {"open", "close"}:
            return self._request("DOOR 1" if action == "open" else "DOOR 0")
        if device == "fan" and action in {"on", "off"}:
            return self._request("FAN 1" if action == "on" else "FAN 0")
        if device == "light" and type(value) is int and 0 <= value <= 100:
            return self._request(f"LIGHT {value}")
        raise ValueError("Unsupported Arduino command")

    def _disconnect(self):
        if self._serial is not None:
            try:
                self._serial.close()
            except OSError:
                pass
            finally:
                self._serial = None

    def close(self):
        with self._lock:
            self._disconnect()
