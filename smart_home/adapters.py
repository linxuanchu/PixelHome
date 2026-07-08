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
        return {
            "source": display_source,
            "labels": ["person", "potted plant"],
            "label_confidences": {"person": 0.91, "potted plant": 0.91},
            "confidence": 0.91,
            "mode": self.mode,
        }

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
        self.model_path = str(model_path)

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
        label_confs = {}
        for label, conf in zip(labels, confidences):
            label_confs[label] = max(label_confs.get(label, 0), conf)
        label_confs = {k: round(v, 4) for k, v in label_confs.items()}
        return {
            "source": source,
            "labels": unique_labels,
            "label_confidences": label_confs,
            "confidence": round(max(confidences, default=0.0), 4),
            "count": len(labels),
            "mode": self.mode,
            "model": self.model_path,
        }


class SpecializedVisionAdapter(DemoVisionAdapter):
    """Two-model detector for the required drone and fire-extinguisher classes."""

    mode = "specialized"

    def __init__(
        self,
        drone_model_path="drone_yolo11n.pt",
        extinguisher_model_path="fire_extinguisher_yolov8.pt",
        drone_model=None,
        extinguisher_model=None,
        confidence=0.5,
    ):
        if drone_model is None or extinguisher_model is None:
            try:
                from ultralytics import YOLO
            except ImportError as error:
                raise RuntimeError("Specialized vision requires: pip install -r requirements-ai.txt") from error
            drone_model = drone_model or YOLO(drone_model_path)
            extinguisher_model = extinguisher_model or YOLO(extinguisher_model_path)
        self.models = (
            ("drone", drone_model, {"drone"}),
            ("fire_extinguisher", extinguisher_model, {"fire extinguisher", "fire_extinguisher"}),
        )
        self.model_paths = {
            "drone": str(drone_model_path),
            "fire_extinguisher": str(extinguisher_model_path),
        }
        self.confidence = confidence

    def detect(self, source="uploaded-image", image_data=None):
        if not image_data:
            raise ValueError("Specialized vision mode requires image_data")
        image = UltralyticsVisionAdapter.decode_image(image_data)
        labels = []
        confidences = []
        for canonical_label, model, accepted_names in self.models:
            results = model.predict(image, verbose=False, conf=self.confidence)
            for result in results:
                for class_id, confidence in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist()):
                    detected_name = str(result.names[int(class_id)]).strip().lower()
                    passed = detected_name in accepted_names
                    print(
                        f"[specialized] {canonical_label:>18s} model "
                        f"detected class={int(class_id):>2d} "
                        f"name=\"{result.names[int(class_id)]}\" "
                        f"conf={confidence:.4f} "
                        f"-> {'ACCEPT' if passed else 'REJECT'}"
                    )
                    if passed:
                        labels.append(canonical_label)
                        confidences.append(float(confidence))
        unique_labels = list(dict.fromkeys(labels))
        label_confs = {}
        for label, conf in zip(labels, confidences):
            label_confs[label] = max(label_confs.get(label, 0), conf)
        label_confs = {k: round(v, 4) for k, v in label_confs.items()}
        result = {
            "source": source,
            "labels": unique_labels,
            "label_confidences": label_confs,
            "confidence": round(max(confidences, default=0.0), 4),
            "count": len(labels),
            "mode": self.mode,
            "model": "specialized-ensemble",
            "models": self.model_paths,
        }
        print(f"[specialized] final result: labels={unique_labels} confidences={label_confs}")
        return result
