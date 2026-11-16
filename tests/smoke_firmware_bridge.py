"""Test host temperature policy against the compiled UNO firmware via AVR8js."""

import argparse
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from smart_home.adapters import DemoVisionAdapter
from smart_home.arduino import ArduinoHomeAdapter
from smart_home.database import Database
from smart_home.face import FaceMatcher
from smart_home.service import SmartHomeService
from tests.smoke_stage2 import image_data


class EmulatedSerial:
    def __init__(self, process):
        self.process = process
        self.reply = b""

    def request(self, **message):
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if "error" in response:
            raise RuntimeError(response["error"])
        return response

    def reset_input_buffer(self):
        self.reply = b""

    def write(self, command):
        response = self.request(command=command.decode("ascii").strip())
        self.reply = json.dumps(response).encode("ascii") + b"\n"

    def read_until(self, terminator, size):
        return self.reply[:size]

    def close(self):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hex_file", type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--faces", nargs=3, type=Path, metavar=("FIRST", "SECOND", "STRANGER"),
                        help="Optional images for two authorizations and one denial")
    args = parser.parse_args()
    bridge = Path(__file__).with_name("firmware_uno.cjs")
    with TemporaryDirectory() as directory, subprocess.Popen(
        [args.node, str(bridge), str(args.hex_file), "--bridge"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
    ) as process:
        serial = EmulatedSerial(process)
        adapter = ArduinoHomeAdapter("AVR8js", serial_factory=lambda *args, **kwargs: serial, boot_delay=0)
        matcher = FaceMatcher("models/face") if args.faces else None
        service = SmartHomeService(Database(Path(directory) / "emulated.db"), adapter, DemoVisionAdapter(), matcher)
        try:
            service.tick_hardware()
            assert service.dashboard()["home"]["temperature"] is None
            for temperature, expected_fan in [(28, True), (25, True), (23, False), (28, True)]:
                serial.request(temperature=temperature, humidity=52)
                service.tick_hardware()
                state = service.dashboard()["home"]
                assert state["online"] and state["temperature"] == temperature and state["humidity"] == 52, state
                assert state["fan"] is expected_fan, state
                print(f"UNO {temperature}C -> backend -> fan {'on' if expected_fan else 'off'}")
            serial.request(advance_ms=2350)
            service.tick_hardware()
            state = service.dashboard()["home"]
            assert state["temperature"] is None and state["fan"] is False, state
            assert [float(row["value"]) for row in service.history(metric="temperature")] == [28, 25, 23, 28]
            print("DHT timeout stopped fan; dashboard and history retained measured values.")
            if args.faces:
                service.seed()
                for person, path in zip(service.people(), args.faces[:2]):
                    service.enroll_face(person["id"], image_data(path))
                for index, path in enumerate(args.faces):
                    result = service.recognize_frame(image_data(path, variation=True), automatic=True)
                    authorized = index < 2
                    assert result["status"] == "checked" and result["reason"] is None, result
                    assert result["authorized"] is authorized and result["door_confirmed"], result
                    expected = "open" if authorized else "closed"
                    assert adapter.poll()["door"] == expected
                    assert Path(result["snapshot_path"]).is_file()
                    print(f"Face {index + 1} -> backend -> UNO door {expected}")
                    if authorized:
                        serial.request(advance_ms=5100)
                        assert adapter.poll()["door"] == "closed"
                    for _ in range(2):
                        assert service.recognize_frame(image_data(), automatic=True) == {"status": "no_face"}
        finally:
            adapter.close()
            process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
