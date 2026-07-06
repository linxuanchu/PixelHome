import base64

import requests

from smart_home.adapters import UltralyticsVisionAdapter


SAMPLE_IMAGE = "https://ultralytics.com/images/bus.jpg"


def main():
    print("Downloading the official Ultralytics sample image...")
    response = requests.get(SAMPLE_IMAGE, timeout=60)
    response.raise_for_status()
    image_data = "data:image/jpeg;base64," + base64.b64encode(response.content).decode("ascii")

    print("Loading yolo11n.pt and running CPU inference...")
    adapter = UltralyticsVisionAdapter("yolo11n.pt")
    result = adapter.detect("ultralytics-bus-sample", image_data)
    print(f"Mode: {result['mode']}")
    print(f"Model: {result['model']}")
    print(f"Objects: {result['count']}")
    print(f"Labels: {', '.join(result['labels'])}")
    print(f"Top confidence: {result['confidence']:.2%}")
    if not result["labels"]:
        raise SystemExit("YOLO verification failed: no objects detected")
    print("YOLO verification: PASS")


if __name__ == "__main__":
    main()

