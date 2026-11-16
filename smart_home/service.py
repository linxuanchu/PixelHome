import json
from datetime import datetime, timedelta, timezone
from threading import Lock

from .climate import ClimatePolicy, FanClimateAdapter
from .face import FaceFrameError, read_frame, save_frame
from .integrations import DisabledLLMProvider, EnergyPolicy, NetworkCapability
from .signals import signal_bus


class SmartHomeService:
    def __init__(self, database, home, vision, face=None):
        self.db = database
        self.home = home
        self.vision = vision
        self.face = face
        self.captures = self.db.path.parent / "captures"
        self.mode = getattr(home, "mode", "simulation")
        if self.mode == "arduino":
            self.captures = self.captures / "hardware"
        self._face_lock = Lock()
        self._auto_latched = False
        self._auto_empty_frames = 0
        self.climate = FanClimateAdapter(home)
        self._last_telemetry = None
        self.llm = DisabledLLMProvider()
        self.energy = EnergyPolicy()

    def seed(self):
        if not self.db.rows("SELECT id FROM people LIMIT 1"):
            for name, role, authorized, face_key in [
                ("林小满", "resident", 1, "resident-lin"),
                ("周星野", "resident", 1, "resident-zhou"),
                ("陌生访客", "visitor", 0, "visitor-unknown"),
            ]:
                self.db.execute(
                    "INSERT INTO people(name, role, authorized, face_key) VALUES(?,?,?,?)",
                    (name, role, authorized, face_key),
                )
            self.log("system", "PixelHome 已初始化")

    def people(self):
        return self.db.rows(
            "SELECT p.*, (SELECT COUNT(*) FROM face_templates f WHERE f.person_id=p.id) "
            "AS face_samples FROM people p ORDER BY p.id"
        )

    def add_person(self, data):
        person_id = self.db.execute(
            "INSERT INTO people(name, role, authorized, face_key) VALUES(?,?,?,?)",
            (data["name"], data.get("role", "resident"), int(data.get("authorized", True)), data["face_key"]),
        )
        self.log("access", f"新增人员：{data['name']}")
        return self.db.rows("SELECT * FROM people WHERE id=?", (person_id,))[0]

    def update_person(self, person_id, data):
        with self._face_lock:
            return self._update_person(person_id, data)

    def _update_person(self, person_id, data):
        existing = self.db.rows("SELECT * FROM people WHERE id=?", (person_id,))
        if not existing:
            raise ValueError("Person not found")
        current = existing[0]
        values = (
            data.get("name", current["name"]),
            data.get("role", current["role"]),
            int(data.get("authorized", bool(current["authorized"]))),
            data.get("face_key", current["face_key"]),
            person_id,
        )
        self.db.execute("UPDATE people SET name=?, role=?, authorized=?, face_key=? WHERE id=?", values)
        self.log("admin", f"更新人员：{values[0]}")
        return self.db.rows("SELECT * FROM people WHERE id=?", (person_id,))[0]

    def delete_person(self, person_id):
        person = self.db.rows("SELECT * FROM people WHERE id=?", (person_id,))
        if not person:
            raise ValueError("Person not found")
        with self._face_lock, self.db.connect() as connection:
            connection.execute("DELETE FROM face_templates WHERE person_id=?", (person_id,))
            connection.execute("DELETE FROM people WHERE id=?", (person_id,))
        self.log("admin", f"删除人员：{person[0]['name']}", "warning")
        return {"deleted": person_id}

    def dashboard(self):
        state = self.home.snapshot()
        if self.mode == "simulation":
            state = self.apply_climate(state)
            self.record_telemetry(state)
        return {
            "home": state,
            "home_score": self.home_score(state),
            "people_count": len(self.people()),
            "events": self.events(8),
            "detections": self.db.rows("SELECT * FROM detections ORDER BY id DESC LIMIT 4"),
            "climate": self.climate_status(state),
            "suspicious_count": self.db.scalar("SELECT COUNT(*) FROM suspicious_people WHERE status='open'", default=0),
            "mode": self.mode,
            "face_mode": "camera" if self.face is not None else "simulation",
            "alerts": self.get_alerts(),
        }

    def tick_hardware(self):
        state = self.home.poll()
        if state["online"]:
            try:
                state = self.apply_climate(state)
            except OSError:
                return
            self.record_telemetry(state)

    def record_telemetry(self, state):
        signature = (state["temperature"], state["light"], state["door"], state["window"])
        if signature != self._last_telemetry:
            self.db.execute_many(
                "INSERT INTO telemetry(device, metric, value, unit) VALUES(?,?,?,?)",
                [("home-01", metric, str(state[metric]), unit) for metric, unit in
                 (("temperature", "°C"), ("light", "%"), ("door", ""), ("window", "")) if state[metric] is not None],
            )
            self._last_telemetry = signature

    @staticmethod
    def home_score(state):
        """Explainable comfort/security score suitable for small displays."""
        score = 100
        reasons = []
        if state["temperature"] is None:
            return {"score": None, "label": "未收到温度", "reasons": []}
        if state["temperature"] > 28:
            score -= min(25, round((state["temperature"] - 28) * 5))
            reasons.append("室温偏高")
        elif state["temperature"] < 18:
            score -= 15
            reasons.append("室温偏低")
        if state["door"] == "open":
            score -= 12
            reasons.append("大门未关闭")
        if state["window"] == "open":
            score -= 5
            reasons.append("窗户开启")
        if state["light"] > 85:
            score -= 4
            reasons.append("灯光能耗较高")
        return {"score": max(0, score), "label": "安心" if score >= 85 else "请留意", "reasons": reasons or ["环境舒适，门窗安全"]}

    def send_command(self, data):
        if self.mode == "arduino" and data["device"] == "door" and data.get("action") == "open":
            raise ValueError("Arduino door opening requires a camera face check")
        if self.mode == "arduino" and data["device"] == "fan" and self.settings()["climate.mode"] == "auto":
            raise ValueError("Switch climate mode to manual before controlling the fan")
        state = self.home.command(data["device"], data.get("action"), data.get("value"))
        self.log("control", f"{data['device']} 控制命令已执行", details=data)
        return state

    def recognize(self, face_key):
        if self.face is not None or self.mode == "arduino":
            raise ValueError("Simulated face keys are disabled")
        result = self.vision.recognize_face(face_key, self.people())
        return self.apply_access(face_key or "unknown", result)

    def enroll_face(self, person_id, image_data):
        if self.face is None:
            raise ValueError("Camera face recognition is not enabled")
        with self._face_lock, self.db.connect() as connection:
            if not connection.execute("SELECT id FROM people WHERE id=?", (person_id,)).fetchone():
                raise ValueError("Person not found")
            count = connection.execute("SELECT COUNT(*) FROM face_templates WHERE person_id=?", (person_id,)).fetchone()[0]
            if count >= 5:
                raise ValueError("At most five face samples per person; clear old samples first")
            feature = self.face.encode(read_frame(image_data))
            connection.execute("INSERT INTO face_templates(person_id, feature) VALUES(?,?)", (person_id, json.dumps(feature)))
        return {"person_id": person_id, "face_samples": count + 1}

    def clear_faces(self, person_id):
        with self._face_lock:
            self.db.execute("DELETE FROM face_templates WHERE person_id=?", (person_id,))
        return {"person_id": person_id, "face_samples": 0}

    def capture(self, image_data):
        path = save_frame(self.captures, read_frame(image_data))
        self.log("vision", f"监控照片已保存：{path.name}")
        return {"filename": path.name, "path": str(path.resolve())}

    def recognize_frame(self, image_data, automatic=False):
        if self.face is None:
            raise ValueError("Camera face recognition is not enabled")
        frame = read_frame(image_data)
        reason = None
        with self._face_lock:
            try:
                feature = self.face.encode(frame.copy())
            except FaceFrameError as error:
                if automatic:
                    if error.reason == "no_face":
                        self._auto_empty_frames = min(self._auto_empty_frames + 1, 2)
                        if self._auto_empty_frames == 2:
                            self._auto_latched = False
                    else:
                        self._auto_empty_frames = 0
                    return {"status": error.reason}
                person_id, score, reason = None, 0.0, "invalid_face"
            except ValueError:
                if automatic:
                    self._auto_empty_frames = 0
                    return {"status": "invalid_face"}
                person_id, score, reason = None, 0.0, "invalid_face"
            else:
                if automatic:
                    self._auto_empty_frames = 0
                    if self._auto_latched:
                        return {"status": "waiting_for_clear"}
                templates = [(row["person_id"], json.loads(row["feature"]))
                             for row in self.db.rows("SELECT person_id, feature FROM face_templates")]
                if automatic and not templates:
                    return {"status": "no_templates"}
                person_id, score = self.face.match(feature, templates)
            path = save_frame(self.captures, frame)
            person = next((p for p in self.people() if p["id"] == person_id), None)
            result = {
                "status": "checked",
                "matched": person is not None, "authorized": bool(person and person["authorized"]),
                "person": person, "confidence": score, "reason": reason,
                "snapshot": path.name, "snapshot_path": str(path.resolve()),
            }
            result = self.apply_access(f"person:{person_id}" if person else "camera-unknown", result, str(path.resolve()))
            if automatic:
                self._auto_latched = True
            return result

    def apply_access(self, subject_key, result, snapshot_path=None):
        result["door_confirmed"] = False
        try:
            state = self.home.command("door", "open" if result["authorized"] else "close")
            result["door_confirmed"] = state["door"] == ("open" if result["authorized"] else "closed")
        except OSError as error:
            result["door_error"] = str(error)
        if result["authorized"]:
            message, level = f"门禁通过：{result['person']['name']}", "success"
        else:
            message, level = "门禁拒绝：未授权人员", "warning"
        if not result["door_confirmed"]:
            message, level = f"{message} · 门控未确认", "warning"
        result["suspicious"] = self.record_access_attempt(subject_key, result, snapshot_path)
        self.log("access", message, level, result)
        return result

    def record_access_attempt(self, subject_key, result, snapshot_path=None):
        person = result.get("person")
        self.db.execute(
            "INSERT INTO access_attempts(subject_key, person_id, authorized, confidence, snapshot_path) VALUES(?,?,?,?,?)",
            (subject_key, person["id"] if person else None, int(result["authorized"]), result.get("confidence", 0), snapshot_path),
        )
        if result["authorized"]:
            return False
        settings = self.settings()
        threshold = int(settings["access.failure_threshold"])
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        cutoff = (now_utc - timedelta(minutes=int(settings["access.failure_window_minutes"]))).strftime("%Y-%m-%d %H:%M:%S")
        failures = self.db.scalar(
            "SELECT COUNT(*) FROM access_attempts WHERE subject_key=? AND authorized=0 AND occurred_at>=?",
            (subject_key, cutoff), 0,
        )
        if failures >= threshold:
            now = now_utc.strftime("%Y-%m-%d %H:%M:%S")
            self.db.execute(
                "INSERT INTO suspicious_people(subject_key,failure_count,first_seen_at,last_seen_at,latest_snapshot_path) VALUES(?,?,?,?,?) "
                "ON CONFLICT(subject_key) DO UPDATE SET failure_count=excluded.failure_count,last_seen_at=excluded.last_seen_at,latest_snapshot_path=COALESCE(excluded.latest_snapshot_path,suspicious_people.latest_snapshot_path),status='open'",
                (subject_key, failures, now, now, snapshot_path),
            )
            self.log("security", f"可疑人员告警：{failures} 次门禁失败", "warning", {"subject_key": subject_key})
            return True
        return False

    def detect(self, source, image_data=None):
        result = self.vision.detect(source, image_data)
        self.db.execute(
            "INSERT INTO detections(source, labels, confidence) VALUES(?,?,?)",
            (result["source"], json.dumps(result["labels"], ensure_ascii=False), result["confidence"]),
        )
        self.log("vision", f"识别到：{'、'.join(result['labels'])}", details=result)

        # Emit detection signals for high-priority classes so external
        # adapters (MQTT / serial / GPIO – stage 2) and the web UI can react.
        alert_classes = {"drone": "🚁 无人机", "fire_extinguisher": "🧯 灭火器"}
        for label in result.get("labels", []):
            if label in alert_classes:
                signal_bus.emit(
                    f"detection:{label}",
                    {
                        "label": label,
                        "display_name": alert_classes[label],
                        "confidence": result.get("confidence", 0),
                        "source": result.get("source", source),
                        "mode": result.get("mode", "unknown"),
                    },
                )

        return result

    def get_alerts(self):
        """Return current detection alerts (drone / fire_extinguisher)."""
        return signal_bus.get_alerts()

    def acknowledge_alert(self, event_type):
        """Dismiss a detection alert."""
        signal_bus.acknowledge(event_type)
        self.log("vision", f"告警已确认：{event_type}", "info")

    def history(self, limit=30, metric=None, start=None, end=None):
        conditions, params = [], []
        if metric:
            if metric not in {"temperature", "light", "door", "window"}:
                raise ValueError("Unsupported history metric")
            conditions.append("metric=?")
            params.append(metric)
        for bound, operator in ((start, ">="), (end, "<=")):
            if bound:
                stamp = datetime.fromisoformat(bound)
                if stamp.tzinfo is None:
                    raise ValueError("History time must include a timezone")
                conditions.append(f"recorded_at {operator} ?")
                params.append(stamp.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
        if start and end and params[-2] > params[-1]:
            raise ValueError("Start time must be before end time")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = self.db.rows(
            f"SELECT metric, value, unit, recorded_at FROM telemetry{where} ORDER BY id DESC LIMIT ?",
            (*params, max(1, min(1000, limit))),
        )
        return list(reversed(rows))

    def events(self, limit=20):
        return self.db.rows("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))

    def suspects(self):
        return self.db.rows("SELECT * FROM suspicious_people ORDER BY last_seen_at DESC")

    def resolve_suspect(self, subject_key):
        self.db.execute("UPDATE suspicious_people SET status='resolved' WHERE subject_key=?", (subject_key,))
        self.log("security", f"可疑记录已处理：{subject_key}", "success")
        return {"subject_key": subject_key, "status": "resolved"}

    def settings(self):
        return {row["key"]: row["value"] for row in self.db.rows("SELECT key,value FROM settings")}

    def update_settings(self, data):
        allowed = {"access.failure_threshold", "access.failure_window_minutes", "storage.retention_days", "climate.mode", "climate.target_temperature", "climate.hysteresis", "climate.actuator", "network.mode", "network.primary", "network.internet_available", "features.llm_enabled", "features.energy_enabled", "features.occupancy_enabled", "features.auto_lighting_enabled", "features.custom_yolo_model"}
        values = [(key, str(value)) for key, value in data.items() if key in allowed]
        if not values:
            raise ValueError("No supported settings")
        numeric_ranges = {
            "access.failure_threshold": (1, 20), "access.failure_window_minutes": (1, 1440),
            "storage.retention_days": (1, 3650), "climate.target_temperature": (10, 35),
            "climate.hysteresis": (0.1, 10),
        }
        for key, value in values:
            if key in numeric_ranges:
                low, high = numeric_ranges[key]
                if not low <= float(value) <= high:
                    raise ValueError(f"Invalid setting: {key}")
                if key.startswith(("access.", "storage.")) and not value.isdecimal():
                    raise ValueError(f"Invalid integer setting: {key}")
            if key == "climate.mode" and value not in {"auto", "manual"}:
                raise ValueError(f"Invalid setting: {key}")
        self.db.execute_many(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
            values,
        )
        self.log("admin", "系统设置已更新")
        return self.settings()

    def climate_status(self, state=None):
        state = state or self.home.snapshot()
        settings = self.settings()
        return {"mode": settings["climate.mode"], "target": float(settings["climate.target_temperature"]), "hysteresis": float(settings["climate.hysteresis"]), "actuator": self.climate.capability, "running": state["fan"]}

    def apply_climate(self, state):
        status = self.climate_status(state)
        if status["mode"] != "auto" or not state["online"]:
            return state
        if state["temperature"] is None:
            return self.climate.apply("off") if state["fan"] else state
        action = ClimatePolicy.decide(state["temperature"], status["target"], status["hysteresis"], state["fan"])
        return self.climate.apply(action) if action != "hold" else state

    def storage_stats(self):
        return {
            "telemetry_rows": self.db.scalar("SELECT COUNT(*) FROM telemetry", default=0),
            "event_rows": self.db.scalar("SELECT COUNT(*) FROM events", default=0),
            "detection_rows": self.db.scalar("SELECT COUNT(*) FROM detections", default=0),
            "access_rows": self.db.scalar("SELECT COUNT(*) FROM access_attempts", default=0),
            "database_bytes": self.db.path.stat().st_size if self.db.path.exists() else 0,
            "retention_days": int(self.settings()["storage.retention_days"]),
        }

    def cleanup_storage(self):
        cutoff = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=int(self.settings()["storage.retention_days"]))).strftime("%Y-%m-%d %H:%M:%S")
        before = self.storage_stats()
        for table, column in (("telemetry", "recorded_at"), ("events", "created_at"), ("detections", "created_at"), ("access_attempts", "occurred_at")):
            self.db.execute(f"DELETE FROM {table} WHERE {column} < ?", (cutoff,))
        cutoff_ts = datetime.fromisoformat(cutoff).replace(tzinfo=timezone.utc).timestamp()
        deleted_captures = 0
        for photo in self.captures.glob("*.jpg"):
            if photo.stat().st_mtime < cutoff_ts:
                photo.unlink(missing_ok=True)
                self.db.execute("UPDATE suspicious_people SET latest_snapshot_path=NULL WHERE latest_snapshot_path=?", (str(photo.resolve()),))
                deleted_captures += 1
        after = self.storage_stats()
        self.log("admin", "历史数据保留策略已执行")
        return {"cutoff": cutoff, "deleted": {**{key: before[key] - after[key] for key in ("telemetry_rows", "event_rows", "detection_rows", "access_rows")}, "captures": deleted_captures}}

    def capabilities(self):
        settings = self.settings()
        network = NetworkCapability(
            mode=settings["network.mode"],
            primary=settings["network.primary"],
            internet_available=settings["network.internet_available"].lower() == "true",
        )
        return {
            "network": network.as_dict(),
            "llm": {"enabled": settings["features.llm_enabled"].lower() == "true", "provider": self.llm.name, "requires_internet": True},
            "energy": {
                "enabled": settings["features.energy_enabled"].lower() == "true",
                "occupancy_enabled": settings["features.occupancy_enabled"].lower() == "true",
                "auto_lighting_enabled": settings["features.auto_lighting_enabled"].lower() == "true",
            },
            "vision": {"custom_model": settings["features.custom_yolo_model"]},
            "offline_core_ready": True,
        }

    def log(self, category, message, level="info", details=None):
        self.db.execute(
            "INSERT INTO events(category, level, message, details) VALUES(?,?,?,?)",
            (category, level, message, json.dumps(details or {}, ensure_ascii=False, default=str)),
        )
