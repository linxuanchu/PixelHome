from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class NetworkCapability:
    mode: str = "offline"
    primary: str = "ethernet"
    internet_available: bool = False

    def as_dict(self):
        return asdict(self)


class DisabledLLMProvider:
    """Offline-safe placeholder for a future cloud or local LLM provider."""

    enabled = False
    name = "disabled"

    def summarize(self, events):
        raise RuntimeError("LLM integration is disabled")


class EnergyPolicy:
    """Stage-two contract for occupancy, lighting and energy estimation."""

    enabled = False

    def evaluate(self, state, occupancy, ambient_light=None):
        return {"actions": [], "estimated_watts": None, "reason": "energy feature disabled"}

