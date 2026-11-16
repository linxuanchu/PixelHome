"""List serial ports or verify the UNO's status without sending actuator commands."""

import argparse
import json
import time

from serial.tools import list_ports

from smart_home.arduino import ArduinoHomeAdapter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="Explicit USB serial port, e.g. COM5")
    args = parser.parse_args()
    if not args.port:
        for port in sorted(list_ports.comports()):
            print(f"{port.device}\t{port.description}\t{port.hwid}")
        return 0

    adapter = ArduinoHomeAdapter(args.port)
    try:
        for attempt in range(3):
            state = adapter.poll()
            if not state["online"] or state["temperature"] is not None:
                break
            if attempt < 2:
                time.sleep(1)
        print(json.dumps(state, ensure_ascii=False, indent=2))
        if not state["online"]:
            print("No PixelHome reply. Check the USB data cable, COM port, sketch, and Serial Monitor.")
            return 2
        if state["temperature"] is None:
            print("UNO replied but DHT temperature is missing. Check the module model, pinout and power.")
            return 3
        return 0
    finally:
        adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
