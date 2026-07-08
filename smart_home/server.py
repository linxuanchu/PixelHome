import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .adapters import DemoVisionAdapter, SimulatedHomeAdapter, SpecializedVisionAdapter, UltralyticsVisionAdapter
from .database import Database
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
):
    if vision_mode == "specialized":
        vision = SpecializedVisionAdapter(drone_model_path, extinguisher_model_path)
    elif vision_mode == "yolo":
        vision = UltralyticsVisionAdapter(model_path)
    else:
        vision = DemoVisionAdapter()
    service = SmartHomeService(
        Database(Path(db_path) if db_path else data_root() / "pixel_home.db"),
        SimulatedHomeAdapter(),
        vision,
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
        length = int(self.headers.get("Content-Length", 0))
        if length > 12 * 1024 * 1024:
            raise ValueError("Request body exceeds 12 MB")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        routes = {
            "/api/dashboard": lambda: self.service.dashboard(),
            "/api/people": lambda: self.service.people(),
            "/api/events": lambda: self.service.events(),
            "/api/admin/suspects": lambda: self.service.suspects(),
            "/api/admin/settings": lambda: self.service.settings(),
            "/api/admin/storage": lambda: self.service.storage_stats(),
            "/api/capabilities": lambda: self.service.capabilities(),
            "/api/history": lambda: self.service.history(int(parse_qs(parsed.query).get("limit", [30])[0])),
            "/api/health": lambda: {"status": "ok", "stage": 1, "mode": self.runtime_mode},
            "/api/alerts": lambda: self.service.get_alerts(),
        }
        if parsed.path in routes:
            return self.json_response(routes[parsed.path]())
        self.serve_static(parsed.path)

    def do_POST(self):
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
            elif self.path == "/api/admin/storage/cleanup":
                result = self.service.cleanup_storage()
            elif self.path == "/api/alerts/ack":
                result = self.service.acknowledge_alert(data.get("event_type", ""))
            else:
                return self.json_response({"error": "Not found"}, 404)
            self.json_response(result)
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            self.json_response({"error": str(error)}, 400)
        except Exception as error:
            self.json_response({"error": f"服务器内部错误: {error}"}, 500)

    def do_PATCH(self):
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
        try:
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


def build_server(
    host="127.0.0.1",
    port=8000,
    db_path=None,
    vision_mode="demo",
    model_path=None,
    drone_model_path=None,
    extinguisher_model_path=None,
):
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
    Handler.service = create_service(db_path, vision_mode, model, drone_model, extinguisher_model)
    Handler.runtime_mode = vision_mode
    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser(description="Pixel Home stage-one server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--db")
    parser.add_argument("--vision", choices=("demo", "yolo", "specialized"), default="demo")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--drone-model", default="models/baseline/drone_yolo11n.pt")
    parser.add_argument(
        "--extinguisher-model",
        default="models/baseline/fire_extinguisher_yolov8.pt",
    )
    args = parser.parse_args()
    server = build_server(
        args.host,
        args.port,
        args.db,
        args.vision,
        args.model,
        args.drone_model,
        args.extinguisher_model,
    )
    print(f"Pixel Home is running at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
