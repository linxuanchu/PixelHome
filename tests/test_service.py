import tempfile
import unittest
from pathlib import Path

from smart_home.adapters import DemoVisionAdapter, SimulatedHomeAdapter, UltralyticsVisionAdapter
from smart_home.database import Database
from smart_home.service import SmartHomeService
from smart_home.climate import ClimatePolicy


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.service = SmartHomeService(
            Database(Path(self.tempdir.name) / "test.db"),
            SimulatedHomeAdapter(),
            DemoVisionAdapter(),
        )
        self.service.seed()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_seed_provides_two_authorized_and_one_denied_identity(self):
        people = self.service.people()
        self.assertEqual(3, len(people))
        self.assertEqual(2, sum(person["authorized"] for person in people))

    def test_authorized_face_opens_door(self):
        result = self.service.recognize("resident-lin")
        self.assertTrue(result["authorized"])
        self.assertEqual("open", self.service.home.state.door)

    def test_unknown_face_is_denied(self):
        result = self.service.recognize("not-enrolled")
        self.assertFalse(result["authorized"])

    def test_three_failures_create_suspicious_record(self):
        for _ in range(3):
            result = self.service.recognize("repeat-stranger")
        self.assertTrue(result["suspicious"])
        suspects = self.service.suspects()
        self.assertEqual("repeat-stranger", suspects[0]["subject_key"])
        self.assertEqual(3, suspects[0]["failure_count"])

    def test_person_crud(self):
        person = self.service.add_person({"name": "测试用户", "face_key": "test-user"})
        updated = self.service.update_person(person["id"], {"authorized": False})
        self.assertFalse(updated["authorized"])
        self.service.delete_person(person["id"])
        self.assertFalse(any(item["id"] == person["id"] for item in self.service.people()))

    def test_remote_control_updates_light_and_fan(self):
        self.service.send_command({"device": "light", "value": 73})
        self.service.send_command({"device": "fan", "action": "on"})
        self.assertEqual(73, self.service.home.state.light)
        self.assertTrue(self.service.home.state.fan)

    def test_detection_is_persisted(self):
        result = self.service.detect("test-camera")
        self.assertIn("person", result["labels"])
        self.assertEqual(1, len(self.service.db.rows("SELECT * FROM detections")))

    def test_home_score_is_explainable(self):
        score = self.service.home_score({"temperature": 31, "door": "open", "window": "closed", "light": 50})
        self.assertLess(score["score"], 100)
        self.assertIn("室温偏高", score["reasons"])

    def test_climate_policy_uses_hysteresis(self):
        self.assertEqual("on", ClimatePolicy.decide(26, 25, 1, False))
        self.assertEqual("hold", ClimatePolicy.decide(25, 25, 1, False))
        self.assertEqual("off", ClimatePolicy.decide(24, 25, 1, True))

    def test_invalid_settings_are_rejected(self):
        with self.assertRaises(ValueError):
            self.service.update_settings({"climate.hysteresis": 0})

    def test_optional_features_are_offline_safe_by_default(self):
        capabilities = self.service.capabilities()
        self.assertTrue(capabilities["offline_core_ready"])
        self.assertEqual("ethernet", capabilities["network"]["primary"])
        self.assertFalse(capabilities["network"]["internet_available"])
        self.assertFalse(capabilities["llm"]["enabled"])
        self.assertFalse(capabilities["energy"]["enabled"])

    def test_real_yolo_adapter_contract_with_injected_model(self):
        import base64
        import io
        from types import SimpleNamespace
        from PIL import Image

        image = Image.new("RGB", (8, 8), "white")
        buffer = io.BytesIO(); image.save(buffer, format="PNG")
        image_data = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()

        class Values:
            def __init__(self, values): self.values = values
            def tolist(self): return self.values

        class Model:
            def predict(self, image, verbose=False):
                self.received_size = image.size
                return [SimpleNamespace(names={0: "person"}, boxes=SimpleNamespace(cls=Values([0]), conf=Values([0.88])))]

        model = Model()
        result = UltralyticsVisionAdapter("test.pt", model=model).detect("upload", image_data)
        self.assertEqual(["person"], result["labels"])
        self.assertEqual("yolo", result["mode"])
        self.assertEqual((8, 8), model.received_size)


if __name__ == "__main__":
    unittest.main()
