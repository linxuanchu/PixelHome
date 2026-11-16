import argparse
import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .adapters import DemoVisionAdapter, HybridVisionAdapter, SimulatedHomeAdapter, SpecializedVisionAdapter, UltralyticsVisionAdapter
from .arduino import ArduinoHomeAdapter
from .database import Database
from .face import FaceMatcher
from .paths import data_root, resource_root
from .service import SmartHomeService


ROOT = resource_root()
WEB = ROOT / "web"


def create_service(
    db_path=None,
    vision_mode="demo",
    model_path="yolo11n.pt",
    drone_model_path="models/baseline/drone_yolo11n.pt",
    extinguisher_model_path="models/baseline/fire_extinguisher_yolov8.pt",
    specialized_confidence=0.8,
    serial_port=None,
    face_model_dir=None,
    extinguisher_confidence=None,
):
    if serial_port and face_model_dir is None:
        raise ValueError("Arduino mode requires camera face recognition")
    if extinguisher_confidence is not None and vision_mode != "hybrid":
        raise ValueError("The extinguisher threshold override requires hybrid mode")
    if vision_mode != "demo":
        config_dir = (Path(db_path).resolve().parent if db_path else data_root()) / "ultralytics"
        config_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))
        required_models = {
            "hybrid": (model_path, drone_model_path, extinguisher_model_path),
            "specialized": (drone_model_path, extinguisher_model_path),
            "yolo": (model_path,),
        }
        paths = required_models.get(vision_mode)
        if not os.environ.get("YOLO_OFFLINE") and paths and all(Path(path).is_file() for path in paths):
            os.environ["YOLO_OFFLINE"] = "true"
    default_db = "pixel_home_hardware.db" if serial_port else "pixel_home.db"
    if vision_mode == "hybrid":
        vision = HybridVisionAdapter(
            model_path,
            drone_model_path,
            extinguisher_model_path,
            specialized_confidence=specialized_confidence,
            extinguisher_confidence=extinguisher_confidence,
        )
    elif vision_mode == "specialized":
        vision = SpecializedVisionAdapter(drone_model_path, extinguisher_model_path)
    elif vision_mode == "yolo":
        vision = UltralyticsVisionAdapter(model_path)
    else:
        vision = DemoVisionAdapter()
    service = SmartHomeService(
        Database(Path(db_path) if db_path else data_root() / default_db),
        ArduinoHomeAdapter(serial_port) if serial_port else SimulatedHomeAdapter(),
        vision,
        FaceMatcher(face_model_dir) if face_model_dir else None,
    )
    service.seed()
    return service


class Handler(BaseHTTPRequestHandler):
    service = None
    runtime_mode = "demo"

    def log_message(self, fmt, *args):
        print(f"[PixelHome] {fmt % args}")

    def json_response(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Use application/json")
        length = int(self.headers.get("Content-Length", 0))
        if length < 0 or length > 12 * 1024 * 1024:
            raise ValueError("Request body exceeds 12 MB")
        payload = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object")
        return payload

    def valid_local_request(self):
        if self.service.face is None:
            return True
        host = self.headers.get("Host")
        port = self.server.server_port
        valid_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            valid_hosts.update({"127.0.0.1", "localhost"})
        origin = self.headers.get("Origin")
        if host in valid_hosts and (origin is None or origin == f"http://{host}"):
            return True
        self.json_response({"error": "Camera door access is local only"}, 403)
        return False

    def do_GET(self):
        if not self.valid_local_request():
            return
        parsed = urlparse(self.path)
        routes = {
            "/api/dashboard": lambda: self.service.dashboard(),
            "/api/people": lambda: self.service.people(),
            "/api/events": lambda: self.service.events(),
            "/api/admin/suspects": lambda: self.service.suspects(),
            "/api/admin/settings": lambda: self.service.settings(),
            "/api/admin/storage": lambda: self.service.storage_stats(),
            "/api/capabilities": lambda: self.service.capabilities(),
            "/api/history": lambda: self.history_response(parsed.query),
            "/api/health": self.health_response,
            "/api/alerts": lambda: self.service.get_alerts(),
        }
        if parsed.path in routes:
            try:
                return self.json_response(routes[parsed.path]())
            except ValueError as error:
                return self.json_response({"error": str(error)}, 400)
        self.serve_static(parsed.path)

    def health_response(self):
        result = {"status": "ok", "stage": 2, "mode": self.runtime_mode,
                  "hardware": self.service.mode, "face_camera": self.service.face is not None}
        if self.runtime_mode == "hybrid":
            result["vision_thresholds"] = self.service.vision.class_thresholds
        return result

    def history_response(self, query):
        params = {key: values[0] for key, values in parse_qs(query).items()}
        return self.service.history(int(params.get("limit", 30)), params.get("metric"), params.get("start"), params.get("end"))

    def do_POST(self):
        if not self.valid_local_request():
            return
        try:
            data = self.body()
            if self.path == "/api/command":
                result = self.service.send_command(data)
            elif self.path == "/api/people":
                result = self.service.add_person(data)
            elif self.path == "/api/vision/detect":
                result = self.service.detect(data.get("source", "demo-camera"), data.get("image_data"))
            elif self.path == "/api/access/recognize":
                result = self.service.recognize(data.get("face_key", ""))
            elif self.path == "/api/access/camera":
                result = self.service.recognize_frame(data.get("image_data"), automatic=data.get("automatic") is True)
            elif self.path == "/api/captures":
                result = self.service.capture(data.get("image_data"))
            elif self.path.startswith("/api/people/") and self.path.endswith("/faces"):
                result = self.service.enroll_face(int(self.path.split("/")[3]), data.get("image_data"))
            elif self.path == "/api/admin/storage/cleanup":
                result = self.service.cleanup_storage()
            elif self.path == "/api/alerts/ack":
                result = self.service.acknowledge_alert(data.get("event_type", ""))
            else:
                return self.json_response({"error": "Not found"}, 404)
            self.json_response(result)
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            self.json_response({"error": str(error)}, 400)
        except OSError as error:
            self.json_response({"error": str(error)}, 503)
        except Exception as error:
            self.json_response({"error": f"服务器内部错误: {error}"}, 500)

    def do_PATCH(self):
        if not self.valid_local_request():
            return
        try:
            data = self.body()
            if self.path.startswith("/api/people/"):
                result = self.service.update_person(int(self.path.rsplit("/", 1)[-1]), data)
            elif self.path == "/api/admin/settings":
                result = self.service.update_settings(data)
            elif self.path.startswith("/api/admin/suspects/"):
                result = self.service.resolve_suspect(unquote(self.path.rsplit("/", 1)[-1]))
            else:
                return self.json_response({"error": "Not found"}, 404)
            self.json_response(result)
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            self.json_response({"error": str(error)}, 400)
        except Exception as error:
            self.json_response({"error": f"服务器内部错误: {error}"}, 500)

    def do_DELETE(self):
        if not self.valid_local_request():
            return
        try:
            if self.path.startswith("/api/people/") and self.path.endswith("/faces"):
                return self.json_response(self.service.clear_faces(int(self.path.split("/")[3])))
            if self.path.startswith("/api/people/"):
                return self.json_response(self.service.delete_person(int(self.path.rsplit("/", 1)[-1])))
            self.json_response({"error": "Not found"}, 404)
        except ValueError as error:
            self.json_response({"error": str(error)}, 400)
        except Exception as error:
            self.json_response({"error": f"服务器内部错误: {error}"}, 500)

    def serve_static(self, request_path):
        relative = "index.html" if request_path == "/" else request_path.lstrip("/")
        file_path = (WEB / relative).resolve()
        if WEB.resolve() not in file_path.parents or not file_path.is_file():
            return self.json_response({"error": "Not found"}, 404)
        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file_path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


class PixelHomeServer(ThreadingHTTPServer):
    def __init__(self, address, handler, service):
        super().__init__(address, handler)
        self.service = service
        self.stop_hardware = threading.Event()
        self.hardware_worker = None
        if service.mode == "arduino":
            self.hardware_worker = threading.Thread(target=self.poll_hardware, daemon=True)
            self.hardware_worker.start()

    def poll_hardware(self):
        while not self.stop_hardware.is_set():
            self.service.tick_hardware()
            self.stop_hardware.wait(1)

    def server_close(self):
        self.stop_hardware.set()
        if self.hardware_worker is not None:
            self.hardware_worker.join()
            self.service.home.close()
        super().server_close()


def build_server(
    host="127.0.0.1",
    port=8000,
    db_path=None,
    vision_mode="demo",
    model_path=None,
    drone_model_path=None,
    extinguisher_model_path=None,
    specialized_confidence=0.8,
    serial_port=None,
    face_model_dir=None,
    extinguisher_confidence=None,
):
    if (serial_port or face_model_dir) and host not in {"127.0.0.1", "localhost"}:
        raise ValueError("Camera door access and Arduino mode require localhost")
    model = Path(model_path) if model_path else ROOT / "yolo11n.pt"
    drone_model = (
        Path(drone_model_path)
        if drone_model_path
        else ROOT / "models" / "baseline" / "drone_yolo11n.pt"
    )
    extinguisher_model = (
        Path(extinguisher_model_path)
        if extinguisher_model_path
        else ROOT / "models" / "baseline" / "fire_extinguisher_yolov8.pt"
    )
    service = create_service(
        db_path, vision_mode, model, drone_model, extinguisher_model,
        specialized_confidence, serial_port, face_model_dir, extinguisher_confidence,
    )
    handler = type("PixelHomeHandler", (Handler,), {"service": service, "runtime_mode": vision_mode})
    return PixelHomeServer((host, port), handler, service)


def main():
    parser = argparse.ArgumentParser(description="Pixel Home server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--db")
    parser.add_argument("--vision", choices=("demo", "yolo", "specialized", "hybrid"), default="demo")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--serial-port", help="Arduino UNO USB serial port (for example COM5)")
    parser.add_argument("--face-model-dir", help="Directory containing YuNet and SFace ONNX models")
    parser.add_argument("--drone-model", default="models/baseline/drone_yolo11n.pt")
    parser.add_argument(
        "--extinguisher-model",
        default="models/baseline/fire_extinguisher_yolov8.pt",
    )
    parser.add_argument(
        "--specialized-confidence",
        type=float,
        default=0.8,
        help="Confidence threshold for specialised drone/extinguisher models (hybrid mode)",
    )
    parser.add_argument("--extinguisher-confidence", type=float,
                        help="Override the extinguisher confidence threshold in hybrid mode")
    args = parser.parse_args()
    if args.extinguisher_confidence is not None and args.vision != "hybrid":
        parser.error("--extinguisher-confidence requires --vision hybrid")
    if not 0 <= args.specialized_confidence <= 1 or (
        args.extinguisher_confidence is not None and not 0 <= args.extinguisher_confidence <= 1
    ):
        parser.error("YOLO confidence thresholds must be between 0 and 1")
    server = build_server(
        args.host,
        args.port,
        args.db,
        args.vision,
        args.model,
        args.drone_model,
        args.extinguisher_model,
        args.specialized_confidence,
        args.serial_port,
        args.face_model_dir or (ROOT / "models" / "face" if args.serial_port else None),
        args.extinguisher_confidence,
    )
    print(f"Pixel Home is running at http://{args.host}:{args.port}")
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
