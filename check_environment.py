import importlib.util
import platform
import sys


REQUIRED_BASE = ["sqlite3", "http.server"]
REQUIRED_AI = ["PIL", "numpy", "torch", "torchvision", "cv2", "ultralytics"]


def available(module):
    return importlib.util.find_spec(module) is not None


def main():
    print("Pixel Home environment check")
    print(f"Python: {platform.python_version()} ({platform.system()})")
    print("\nBase mode:")
    for module in REQUIRED_BASE:
        print(f"  [{'OK' if available(module) else 'MISSING'}] {module}")
    print("\nReal YOLO mode:")
    for module in REQUIRED_AI:
        print(f"  [{'OK' if available(module) else 'MISSING'}] {module}")

    base_ready = all(available(module) for module in REQUIRED_BASE)
    ai_ready = all(available(module) for module in REQUIRED_AI)
    print(f"\nBase dashboard: {'READY' if base_ready else 'NOT READY'}")
    print(f"Real YOLO: {'READY' if ai_ready else 'INSTALL requirements-ai.txt'}")
    return 0 if base_ready else 1


if __name__ == "__main__":
    sys.exit(main())

