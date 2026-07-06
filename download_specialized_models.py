import hashlib
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


DRONE_URL = "https://huggingface.co/marie-kjelberg/drone-detector/resolve/main/yolo11n_drone.pt?download=true"
FSE_URL = "https://zenodo.org/records/13358169/files/1_FSE%20Detection.zip?download=1"
FSE_MD5 = "c4765acd9b7c6e8eb0f72113af766d75"


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "PixelHome/1.0"})
    with urllib.request.urlopen(request) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def file_md5(path):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    root = Path(__file__).resolve().parent
    drone_path = root / "drone_yolo11n.pt"
    extinguisher_path = root / "fire_extinguisher_yolov8.pt"
    if not drone_path.exists():
        print("Downloading drone detector...")
        download(DRONE_URL, drone_path)
    if not extinguisher_path.exists():
        print("Downloading FireSafetyNet detector...")
        with tempfile.TemporaryDirectory() as tempdir:
            archive = Path(tempdir) / "fse.zip"
            download(FSE_URL, archive)
            digest = file_md5(archive)
            if digest != FSE_MD5:
                raise RuntimeError(f"FireSafetyNet checksum mismatch: {digest}")
            with zipfile.ZipFile(archive) as source:
                with source.open("1_FSE Detection/best.pt") as model, extinguisher_path.open("wb") as output:
                    shutil.copyfileobj(model, output)
    print(f"Ready: {drone_path.name}, {extinguisher_path.name}")


if __name__ == "__main__":
    main()
