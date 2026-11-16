import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from smart_home.adapters import DemoVisionAdapter, HybridVisionAdapter, SimulatedHomeAdapter
from smart_home.arduino import ArduinoHomeAdapter
from smart_home.database import Database
from smart_home.face import FaceFrameError
from smart_home.service import SmartHomeService


class FirmwareDouble:
    def __init__(self):
        self.temperature, self.fan, self.door, self.light = 23, False, "closed", 0
        self.commands = []
        self.available = True
        self.reply = b""

    def reset_input_buffer(self):
        self.reply = b""

    def write(self, data):
        if not self.available:
            raise OSError("disconnected")
        command = data.decode().strip()
        self.commands.append(command)
        if command.startswith("FAN"):
            self.fan = command.endswith("1")
        if command.startswith("DOOR"):
            self.door = "open" if command.endswith("1") else "closed"
        if command.startswith("LIGHT"):
            self.light = int(command.split()[1])
        self.reply = json.dumps({
            "protocol": "pixelhome-1", "command": command,
            "temperature": self.temperature, "humidity": 45,
            "fan": self.fan, "door": self.door, "light": self.light,
        }).encode() + b"\n"

    def read_until(self, terminator, size):
        return self.reply[:size]

    def close(self):
        pass


class MatcherDouble:
    def encode(self, frame):
        pixel = frame.getpixel((0, 0))
        if pixel == (0, 0, 0):
            raise FaceFrameError("no_face")
        if pixel == (255, 255, 255):
            raise FaceFrameError("invalid_face")
        return list(pixel)

    def match(self, feature, templates):
        match = next((person_id for person_id, value in templates if feature == value), None)
        return match, float(match is not None)


def frame(color):
    output = io.BytesIO()
    Image.new("RGB", (100, 100), color).save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


class Stage2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Database(Path(self.tmp.name) / "test.db")

    def service(self, home=None):
        service = SmartHomeService(self.db, home or SimulatedHomeAdapter(), DemoVisionAdapter(), MatcherDouble())
        service.seed()
        return service

    def test_camera_two_authorized_one_denied_with_jpeg_evidence(self):
        service = self.service()
        alice, bob, _ = service.people()
        for person, color in ((alice, "red"), (bob, "blue")):
            self.assertEqual(service.enroll_face(person["id"], frame(color))["face_samples"], 1)
            result = service.recognize_frame(frame(color))
            self.assertTrue(result["authorized"])
            self.assertTrue(result["door_confirmed"])
            self.assertEqual(result["person"]["id"], person["id"])
            with Image.open(result["snapshot_path"]) as photo:
                self.assertEqual(photo.format, "JPEG")
        for _ in range(3):
            result = service.recognize_frame(frame("green"))
            self.assertFalse(result["authorized"])
            self.assertTrue(result["door_confirmed"])
        self.assertTrue(result["suspicious"])
        self.assertEqual(service.suspects()[0]["latest_snapshot_path"], result["snapshot_path"])
        self.assertEqual(len(list(service.captures.glob("*.jpg"))), 5)
        with self.assertRaisesRegex(ValueError, "disabled"):
            service.recognize(alice["face_key"])

    def test_revoked_and_deleted_faces_do_not_authorize(self):
        service = self.service()
        person = service.people()[0]
        service.enroll_face(person["id"], frame("red"))
        service.update_person(person["id"], {"authorized": False})
        self.assertFalse(service.recognize_frame(frame("red"))["authorized"])
        service.delete_person(person["id"])
        self.assertFalse(service.recognize_frame(frame("red"))["matched"])
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM face_templates"), 0)

    def test_automatic_door_requires_two_empty_frames_between_visitors(self):
        board = FirmwareDouble()
        adapter = ArduinoHomeAdapter("TEST", lambda *a, **kw: board, boot_delay=0)
        self.addCleanup(adapter.close)
        service = self.service(adapter)
        check = lambda color: service.recognize_frame(frame(color), automatic=True)
        self.assertEqual(check("red"), {"status": "no_templates"})
        self.assertEqual(check("black"), {"status": "no_face"})
        self.assertEqual(check("white"), {"status": "invalid_face"})
        self.assertFalse(service.captures.exists())
        for person, color in zip(service.people(), ("red", "blue")):
            service.enroll_face(person["id"], frame(color))
        self.assertTrue(check("red")["authorized"])
        self.assertEqual(check("red"), {"status": "waiting_for_clear"})
        check("black")
        check("white")
        check("black")
        self.assertEqual(check("blue"), {"status": "waiting_for_clear"})
        check("black")
        check("black")
        self.assertTrue(check("blue")["authorized"])
        for attempt in range(3):
            check("black")
            check("black")
            result = check("green")
            self.assertFalse(result["authorized"])
            self.assertEqual(result["suspicious"], attempt == 2)
            self.assertEqual(check("green"), {"status": "waiting_for_clear"})
        self.assertEqual(board.commands, ["DOOR 1"] * 2 + ["DOOR 0"] * 3)
        self.assertEqual(len(list(service.captures.glob("*.jpg"))), 5)

    def test_capture_rejects_invalid_input(self):
        service = self.service()
        with self.assertRaises(ValueError):
            service.capture("data:image/png;base64,invalid!")
        self.assertFalse(service.captures.exists())
        self.assertTrue(Path(service.capture(frame("red"))["path"]).is_file())

    def test_arduino_hysteresis_disconnect_reconnect_and_sensor_failure(self):
        board = FirmwareDouble()
        adapter = ArduinoHomeAdapter("TEST", lambda *a, **kw: board, boot_delay=0)
        self.addCleanup(adapter.close)
        service = self.service(adapter)
        self.assertIsNone(service.dashboard()["home"]["temperature"])
        board.temperature = 27
        service.tick_hardware()
        self.assertTrue(service.dashboard()["home"]["fan"])
        board.temperature = 25
        service.tick_hardware()
        self.assertTrue(service.dashboard()["home"]["fan"])
        board.temperature = None
        service.tick_hardware()
        self.assertFalse(service.dashboard()["home"]["fan"])
        board.temperature = 27
        service.tick_hardware()
        board.temperature = 23
        service.tick_hardware()
        self.assertFalse(service.dashboard()["home"]["fan"])
        board.available = False
        service.tick_hardware()
        self.assertFalse(service.dashboard()["home"]["online"])
        self.assertIsNone(service.dashboard()["home"]["temperature"])
        board.available = True
        service.tick_hardware()
        self.assertTrue(service.dashboard()["home"]["online"])
        self.assertEqual([row["value"] for row in service.history(metric="temperature")], ["27", "25", "27", "23"])
        with self.assertRaisesRegex(ValueError, "camera face check"):
            service.send_command({"device": "door", "action": "open"})
        person = service.people()[0]
        service.enroll_face(person["id"], frame("red"))
        self.assertTrue(service.recognize_frame(frame("red"))["door_confirmed"])
        self.assertIn("DOOR 1", board.commands)
        board.available = False
        result = service.recognize_frame(frame("red"))
        self.assertTrue(result["authorized"])
        self.assertFalse(result["door_confirmed"])

    def test_history_filters_metric_and_timezone(self):
        service = self.service()
        self.db.execute_many(
            "INSERT INTO telemetry(device, metric, value, recorded_at) VALUES('home',?,?,?)",
            [("temperature", "23", "2026-11-13 10:10:00"),
             ("door", "open", "2026-11-13 10:10:00"),
             ("temperature", "24", "2026-11-13 10:20:00")],
        )
        result = service.history(metric="temperature", start="2026-11-13T18:00:00+08:00", end="2026-11-13T18:15:00+08:00")
        self.assertEqual([row["value"] for row in result], ["23"])
        with self.assertRaisesRegex(ValueError, "timezone"):
            service.history(start="2026-11-13T10:00")

    def test_hybrid_keeps_target_over_higher_scored_generic_label(self):
        def model(label, score):
            prediction = SimpleNamespace(names={0: label}, boxes=SimpleNamespace(
                cls=SimpleNamespace(tolist=lambda: [0]),
                conf=SimpleNamespace(tolist=lambda: [score]),
            ))
            return SimpleNamespace(predict=lambda *args, **kwargs: [prediction])
        for score, expected in ((0.89, "drone"), (0.79, "airplane")):
            vision = HybridVisionAdapter(
                general_model=model("airplane", 0.91),
                drone_model=model("drone", score),
                extinguisher_model=model("extinguisher", 0.40),
            )
            self.assertEqual(vision.detect(image_data=frame("red"))["labels"], [expected])

    def test_hybrid_extinguisher_override_does_not_lower_drone_threshold(self):
        def model(label, score):
            prediction = SimpleNamespace(names={0: label}, boxes=SimpleNamespace(
                cls=SimpleNamespace(tolist=lambda: [0]), conf=SimpleNamespace(tolist=lambda: [score]),
            ))
            return SimpleNamespace(predict=lambda *args, **kwargs: [prediction])
        inputs = {
            "general_model": model("person", 0.91),
            "drone_model": model("drone", 0.79),
            "extinguisher_model": model("extinguisher", 0.76),
        }
        baseline = HybridVisionAdapter(**inputs)
        calibrated = HybridVisionAdapter(**inputs, extinguisher_confidence=0.75)
        self.assertEqual(baseline.detect(image_data=frame("red"))["labels"], ["person"])
        self.assertEqual(calibrated.detect(image_data=frame("red"))["labels"], ["fire_extinguisher"])
        self.assertEqual(calibrated.class_thresholds, {"drone": 0.8, "fire_extinguisher": 0.75})
