import base64
import io
from dataclasses import asdict, dataclass
from datetime import datetime
from random import uniform


@dataclass
class DeviceState:
    temperature: float = 24.6
    door: str = "closed"
    window: str = "closed"
    light: int = 45
    fan: bool = False
    online: bool = True


class SimulatedHomeAdapter:
    """Stage-one adapter. Replace this class with MQTT/serial in stage two."""

    def __init__(self):
        self.state = DeviceState()

    def snapshot(self):
        self.state.temperature = round(
            max(18, min(36, self.state.temperature + uniform(-0.15, 0.15))), 1
        )
        return {**asdict(self.state), "updated_at": datetime.now().isoformat(timespec="seconds")}

    def command(self, device, action=None, value=None):
        if device in {"door", "window"} and action in {"open", "close"}:
            setattr(self.state, device, "open" if action == "open" else "closed")
        elif device == "fan" and action in {"on", "off"}:
            self.state.fan = action == "on"
        elif device == "light" and isinstance(value, (int, float)):
            self.state.light = max(0, min(100, int(value)))
        else:
            raise ValueError("Unsupported device command")
        return self.snapshot()


class DemoVisionAdapter:
    """Deterministic stage-one AI demo with the same contract as a real model."""

    mode = "demo"

    def detect(self, source="demo-camera", image_data=None):
        display_source = "uploaded-image" if image_data else source
        return {"source": display_source, "labels": ["person", "potted plant"], "confidence": 0.91, "mode": self.mode}

    def recognize_face(self, face_key, people):
        person = next((item for item in people if item["face_key"] == face_key), None)
        return {
            "matched": bool(person),
            "authorized": bool(person and person["authorized"]),
            "person": person,
            "confidence": 0.96 if person else 0.18,
        }


class UltralyticsVisionAdapter(DemoVisionAdapter):
    """Real YOLO adapter. Import and model loading stay lazy for fast fallback."""

    mode = "yolo"

    def __init__(self, model_path="yolo11n.pt", model=None):
        if model is None:
            try:
                from ultralytics import YOLO
            except ImportError as error:
                raise RuntimeError("YOLO mode requires: pip install -r requirements-ai.txt") from error
            model = YOLO(model_path)
        self.model = model
        self.model_path = model_path

    @staticmethod
    def decode_image(image_data):
        from PIL import Image

        encoded = image_data.split(",", 1)[-1]
        return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")

    def detect(self, source="uploaded-image", image_data=None):
        if not image_data:
            raise ValueError("Real YOLO mode requires image_data")
        results = self.model.predict(self.decode_image(image_data), verbose=False)
        labels = []
        confidences = []
        for result in results:
            names = result.names
            for class_id, confidence in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist()):
                labels.append(str(names[int(class_id)]))
                confidences.append(float(confidence))
        unique_labels = list(dict.fromkeys(labels))
        return {
            "source": source,
            "labels": unique_labels,
            "confidence": round(max(confidences, default=0.0), 4),
            "count": len(labels),
            "mode": self.mode,
            "model": self.model_path,
        }
