# 模型发布规则

`baseline/` 保存组员克隆仓库后可直接使用的正式基线模型。当前两份模型均小于GitHub单文件100 MB限制，因此使用普通Git提交，不要求组员额外安装Git LFS。

后续自训模型按以下流程发布：

1. 训练产生的 `last.pt`、每轮checkpoint和实验目录保留在本机或共享存储，不直接提交。
2. 候选 `best.pt` 必须在未参与训练的测试集上验证无人机、灭火器、弱光和复杂背景。
3. 记录数据集版本、类别映射、训练参数、mAP、误检漏检案例、许可证和SHA256。
4. 通过小组确认后，将权重改为有含义的版本名并更新程序默认路径与 `MODEL_EVALUATION.md`。
5. 单文件接近或超过100 MB时改用Git LFS或GitHub Release，不在普通Git历史中反复替换大文件。

当前基线SHA256：

| 文件 | SHA256 |
|---|---|
| `drone_yolo11n.pt` | `311b8bea0a5a9f2b2dd407ade666a91831bbcb4dcd9d4b6580dbe33aac3123be` |
| `fire_extinguisher_yolov8.pt` | `9f03f76db1b14a974d5b7f5db36a6a20f5ab77536ea90e5f3eb3927aef6fe50f` |

## 第二阶段外部模型和依赖

- 人脸检测使用 [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)，人脸特征使用 [OpenCV Zoo SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface)。下载并验证 SHA-256 见 `fetch_face_models.py`；模型许可证保存在 `models/face/`。本组实现的是采集、录入、身份匹配与硬件联动，并非重新训练模型。
- 通用检测使用 [Ultralytics YOLO11n](https://docs.ultralytics.com/models/yolo11/)。灭火器权重来源及下载地址以 `download_specialized_models.py` 为准，不对外宣称其权重已有明确再分发许可。
- 3D 使用 [Three.js r160](https://github.com/mrdoob/three.js/tree/r160) 及同版 OrbitControls，许可证在 `web/vendor/three/LICENSE`。
- UNO 固件使用 [Arduino Servo](https://github.com/arduino-libraries/Servo) 和 [Adafruit DHT](https://github.com/adafruit/DHT-sensor-library)，库由 Arduino IDE 安装。
