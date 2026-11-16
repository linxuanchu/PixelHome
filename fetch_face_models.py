import hashlib
import shutil
from pathlib import Path
from urllib.request import urlopen


MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "face_detection_yunet",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "face_recognition_sface",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def main():
    folder = Path(__file__).resolve().parent / "models" / "face"
    folder.mkdir(parents=True, exist_ok=True)
    for name, (directory, expected) in MODELS.items():
        path = folder / name
        if not path.is_file() or digest(path) != expected:
            partial = path.with_suffix(".part")
            url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{directory}/{name}"
            try:
                with urlopen(url, timeout=60) as source, partial.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if digest(partial) != expected:
                    raise RuntimeError(f"Unexpected SHA-256 for {name}")
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        print(f"Verified {name}")


if __name__ == "__main__":
    main()
