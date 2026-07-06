import json
from datetime import datetime, timedelta, timezone

from .climate import ClimatePolicy, FanClimateAdapter
from .integrations import DisabledLLMProvider, EnergyPolicy, NetworkCapability


class SmartHomeService:
    def __init__(self, database, home, vision):
        self.db = database
        self.home = home
        self.vision = vision
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
            self.log("system", "阶段 1 演示空间已初始化")

    def people(self):
        return self.db.rows("SELECT * FROM people ORDER BY id")

    def add_person(self, data):
        person_id = self.db.execute(
            "INSERT INTO people(name, role, authorized, face_key) VALUES(?,?,?,?)",
            (data["name"], data.get("role", "resident"), int(data.get("authorized", True)), data["face_key"]),
        )
        self.log("access", f"新增人员：{data['name']}")
        return self.db.rows("SELECT * FROM people WHERE id=?", (person_id,))[0]

    def update_person(self, person_id, data):
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
        self.db.execute("DELETE FROM people WHERE id=?", (person_id,))
        self.log("admin", f"删除人员：{person[0]['name']}", "warning")
        return {"deleted": person_id}

    def dashboard(self):
        state = self.home.snapshot()
        state = self.apply_climate(state)
        signature = (state["temperature"], state["light"], state["door"], state["window"])
        if signature != self._last_telemetry:
            self.db.execute_many(
                "INSERT INTO telemetry(device, metric, value, unit) VALUES(?,?,?,?)",
                [("home-01", metric, str(state[metric]), unit) for metric, unit in
                 (("temperature", "°C"), ("light", "%"), ("door", ""), ("window", ""))],
            )
            self._last_telemetry = signature
        return {
            "home": state,
            "home_score": self.home_score(state),
            "people_count": len(self.people()),
            "events": self.events(8),
            "detections": self.db.rows("SELECT * FROM detections ORDER BY id DESC LIMIT 4"),
            "climate": self.climate_status(state),
            "suspicious_count": self.db.scalar("SELECT COUNT(*) FROM suspicious_people WHERE status='open'", default=0),
            "mode": "simulation",
        }

    @staticmethod
    def home_score(state):
        """Explainable comfort/security score suitable for small displays."""
        score = 100
        reasons = []
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
        state = self.home.command(data["device"], data.get("action"), data.get("value"))
        self.log("control", f"{data['device']} 控制命令已执行", details=data)
        return state

    def recognize(self, face_key):
        result = self.vision.recognize_face(face_key, self.people())
        if result["authorized"]:
            self.home.command("door", "open")
            message, level = f"门禁通过：{result['person']['name']}", "success"
        else:
            message, level = "门禁拒绝：未授权人员", "warning"
        result["suspicious"] = self.record_access_attempt(face_key or "unknown", result)
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
        return result

    def history(self, limit=30):
        rows = self.db.rows(
            "SELECT metric, value, unit, recorded_at FROM telemetry ORDER BY id DESC LIMIT ?", (limit,)
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
        if status["mode"] != "auto":
            return state
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
        after = self.storage_stats()
        self.log("admin", "历史数据保留策略已执行")
        return {"cutoff": cutoff, "deleted": {key: before[key] - after[key] for key in ("telemetry_rows", "event_rows", "detection_rows", "access_rows")}}

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
