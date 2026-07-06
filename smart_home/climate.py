class FanClimateAdapter:
    """Current actuator implementation; replace with HVAC without changing policy."""

    capability = "fan"

    def __init__(self, home):
        self.home = home

    def apply(self, action):
        if action in {"on", "off"}:
            return self.home.command("fan", action)
        return self.home.snapshot()


class ClimatePolicy:
    @staticmethod
    def decide(temperature, target, hysteresis, running):
        if temperature >= target + hysteresis and not running:
            return "on"
        if temperature <= target - hysteresis and running:
            return "off"
        return "hold"

