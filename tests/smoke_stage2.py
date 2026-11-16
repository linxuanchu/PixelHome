"""Run the actual local HTTP server against supplied, consented test images."""

import argparse
import base64
import io
import json
import tempfile
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageEnhance

from smart_home.server import build_server


def image_data(path=None, variation=False):
    if path is None:
        image = Image.new("RGB", (640, 480))
    else:
        with Image.open(path) as source:
            image = source.convert("RGB")
    if variation:
        image = ImageEnhance.Brightness(image.rotate(4)).enhance(0.85)
    image.thumbnail((800, 800))
    data = io.BytesIO()
    image.save(data, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(data.getvalue()).decode()


def main():
    parser = argparse.ArgumentParser()
    for name in ("first", "second", "stranger", "drone", "extinguisher"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--offline-test-port", help="An intentionally absent serial port")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory, build_server(
        port=0, db_path=Path(directory) / "smoke.db", vision_mode="hybrid",
        serial_port=args.offline_test_port, face_model_dir=Path("models/face"),
    ) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"

        def request(path, payload=None, method=None):
            data = json.dumps(payload).encode() if payload is not None else None
            req = Request(root + path, data, {"Content-Type": "application/json"}, method=method)
            with urlopen(req, timeout=20) as result:
                return json.load(result)

        try:
            assert request("/api/health")["face_camera"]
            for index, path in enumerate((args.first, args.second), start=1):
                data = {"image_data": image_data(path)}
                assert request(f"/api/people/{index}/faces", data)["face_samples"] == 1
            for index, path in enumerate((args.first, args.second, args.stranger), start=1):
                data = {"image_data": image_data(path, variation=True), "automatic": True}
                result = request("/api/access/camera", data)
                assert result["status"] == "checked", result
                assert result["reason"] is None, result
                assert result["authorized"] == (index != 3), result
                if index != 3:
                    assert result["person"]["id"] == index, result
                assert result["door_confirmed"] == (args.offline_test_port is None), result
                with Image.open(result["snapshot_path"]) as saved:
                    assert saved.format == "JPEG"
                print(f"Face {index}: authorized={result['authorized']} score={result['confidence']:.3f}")
                assert request("/api/access/camera", data) == {"status": "waiting_for_clear"}
                for _ in range(2):
                    assert request("/api/access/camera", {"image_data": image_data(), "automatic": True}) == {"status": "no_face"}
            saved = request("/api/captures", {"image_data": image_data(args.drone)})
            assert Path(saved["path"]).is_file()
            for label, path in (("drone", args.drone), ("fire_extinguisher", args.extinguisher)):
                result = request("/api/vision/detect", {"image_data": image_data(path), "source": "audit"})
                assert label in result["labels"], result
                print(f"YOLO {label}: {result['confidence']:.3f}")
            try:
                request("/api/access/recognize", {"face_key": "resident-lin"})
                raise AssertionError("Simulation shortcut was accepted in camera mode")
            except HTTPError as error:
                assert error.code == 400
            if args.offline_test_port:
                state = request("/api/dashboard")
                assert state["mode"] == "arduino" and not state["home"]["online"]
                assert state["home"]["temperature"] is None
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
