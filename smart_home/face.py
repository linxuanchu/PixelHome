import base64
import binascii
import io
import math
from pathlib import Path
from uuid import uuid4


class FaceFrameError(ValueError):
    def __init__(self, reason):
        super().__init__("Frame must contain one clear face (at least 60 pixels wide and tall)")
        self.reason = reason


def read_frame(image_data):
    from PIL import Image, UnidentifiedImageError

    if not isinstance(image_data, str) or not image_data.startswith(
        ("data:image/jpeg;base64,", "data:image/png;base64,")
    ):
        raise ValueError("A JPEG or PNG camera frame is required")
    try:
        raw = base64.b64decode(image_data.split(",", 1)[1], validate=True)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Camera frame exceeds 4 MB")
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"JPEG", "PNG"} or image.width * image.height > 4000000:
                raise ValueError("Unsupported camera frame")
            return image.convert("RGB")
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Invalid camera frame") from error


def save_frame(folder, frame):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid4().hex}.jpg"
    with path.open("xb") as output:
        frame.save(output, format="JPEG", quality=88)
    return path


class FaceMatcher:
    DETECTOR = "face_detection_yunet_2023mar.onnx"
    RECOGNIZER = "face_recognition_sface_2021dec.onnx"

    def __init__(self, model_dir, threshold=0.45, margin=0.07):
        import cv2

        model_dir = Path(model_dir)
        paths = [model_dir / name for name in (self.DETECTOR, self.RECOGNIZER)]
        if not all(path.is_file() for path in paths):
            raise RuntimeError("Missing YuNet/SFace models; run setup_stage2.ps1")
        self.cv = cv2
        self.detector = cv2.FaceDetectorYN.create(str(paths[0]), "", (320, 320), 0.85, 0.3, 1000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(paths[1]), "")
        self.threshold = threshold
        self.margin = margin

    def encode(self, frame):
        import numpy as np

        frame.thumbnail((800, 800))
        pixels = self.cv.cvtColor(np.asarray(frame), self.cv.COLOR_RGB2BGR)
        height, width = pixels.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(pixels)
        if faces is None or not len(faces):
            raise FaceFrameError("no_face")
        if len(faces) != 1 or min(faces[0][2:4]) < 60:
            raise FaceFrameError("invalid_face")
        crop = self.recognizer.alignCrop(pixels, faces[0])
        feature = self.recognizer.feature(crop).reshape(-1)
        norm = float(np.linalg.norm(feature))
        if not math.isfinite(norm) or norm == 0:
            raise ValueError("Cannot extract a usable face feature")
        return (feature / norm).tolist()

    def match(self, feature, templates):
        scores = {}
        for person_id, template in templates:
            score = sum(a * b for a, b in zip(feature, template, strict=True))
            scores[person_id] = max(score, scores.get(person_id, -1))
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        if not ranked:
            return None, 0.0
        person_id, score = ranked[0]
        runner_up = ranked[1][1] if len(ranked) > 1 else -1
        accepted = score >= self.threshold and score - runner_up >= self.margin
        return person_id if accepted else None, round(max(0, min(score, 1)), 4)
