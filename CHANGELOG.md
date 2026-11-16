# PixelHome 更新日志

本文件用于记录项目每次重要修改。每位组员修改功能、接口、模型、数据集、3D预览或硬件适配后，都需要同步追加更新记录，方便其他人拉取代码后快速了解变化。

## v2.0.0-preview.1（2026-11-16）

- 将阶段二联调版发布到 `main`，包含摄像头人脸识别、UNO R3 串口联动、照片保存、历史查询和 YOLO 优化。实体设备和现场摄像头仍待验收。
- 发布前的 `main` 由 `stage1-baseline` 保留；需要撤销整次更新时，按 [版本与回滚](STAGE2.md#版本与回滚) 操作。
- 用源码 ZIP 解压到新目录，建立不继承系统包的 Python 3.12 环境，重新安装依赖并通过模型校验与 22 项单测。
- 本地 YOLO 权重齐全时默认启用 YOLO 离线模式，跳过库的外网探测。显式设置 `YOLO_OFFLINE=false` 可保留默认联网行为。
- 使用公开测试照片和 Edge 模拟摄像头复测人脸门禁：两个录入身份的四张不同照片均正确匹配，三张未录入样图均未放行；空画面和双人画面均拒绝，自动模式不重复触发。此结果不代替现场摄像头测试。
- 录制本地软件界面的 28 秒宣传底稿，区分模拟设备和真实 YOLO 样图结果；视频不随源码提交，正式版本待实物补拍。

## 2026-11-13

### 阶段二本地联调

- 补充摄像头自动门禁和多摄像头选择：每次进场只验证一次，两帧空镜头后才接收下一位；空镜头和多人画面不留照片、不计失败。新增 UNO 状态诊断工具和实物验证、视频拍摄清单。
- 新增 UNO R3 固件和串口适配器：真实温湿度读取、回差温控、门舵机和可选灯光控制；掉线明确显示，实机与模拟遥测分库存储。
- 新增 YuNet/SFace 摄像头门禁、人员样本录入和清除、拍照写入 JPEG、按时段查询历史；照片和人脸特征留在本地。
- Hybrid 保持原有三份 YOLO 权重和 0.80 专项阈值，修正专项目标被高分通用标签覆盖的问题。3D 依赖改为本地加载。
- 增加仅覆盖灭火器阈值的启动参数，并在健康接口报告实际阈值；0.75 通过接口复测补回一张漏检样图，默认配置不变。
- 新增编译后固件的 AVR8js 测试：验证 DHT11 脉冲解码、舵机 PWM、超时行为，并将 Python 后端及真实人脸模型接到模拟执行的 UNO 固件上复测。实物验收仍待执行。
- 运行及验证：见 `STAGE2.md`；22 项单测通过，UNO 固件已编译，真实模型图片和浏览器测试通过，源码 ZIP 和 Windows EXE 均实测启动。实物未在手边，尚未烧录联调。

## 2026-07-09

### 林玄楚 / Codex

- 修改内容：在组员当前 Hybrid 三模型版本基础上，增强 Windows 启动器，双击 `dist\PixelHome\PixelHome.exe` 后默认自动启动 `python run.py --vision hybrid --port 8000` 并打开管理界面；同时将灭火器基线权重替换为测试表现更好的 Javay `best3.pt`，兼容模型输出标签 `extinguisher`。
- 涉及文件：`launcher.py`、`smart_home/adapters.py`、`download_specialized_models.py`、`models/baseline/fire_extinguisher_yolov8.pt`、`models/README.md`、`MODEL_EVALUATION.md`、`README.md`、`tests/test_service.py`、`CHANGELOG.md`。
- 运行方式：双击 `dist\PixelHome\PixelHome.exe`，或源码运行 `python run.py --vision hybrid`。
- 测试结果：已运行 `python -m unittest discover -s tests -v`，14个测试全部通过；已验证 `ultralytics 8.4.87`、`cv2 5.0.0`、`torch 2.12.1+cpu` 可导入；demo 服务、hybrid 服务烟测均通过，hybrid 返回 `{"status":"ok","stage":1,"mode":"hybrid"}`；灭火器新权重 SHA256 为 `9f03f76db1b14a974d5b7f5db36a6a20f5ab77536ea90e5f3eb3927aef6fe50f`；灭火器新权重在50轮专项链路测试中正样本 `50/50`、干扰项误报 `1/50`。
- 上传状态：已提交并推送到 GitHub `main`，提交号 `402c026 Improve hybrid launcher and extinguisher model`。
- 注意事项：`dist/` 不进入Git，拉取GitHub源码后需要重新运行 `build_windows.ps1` 才能更新本地打包程序；本地 `model_lab/` 仅用于模型测试，不作为正式更新内容上传。

## 2026-07-07

### 林玄楚 / Codex

- 修改内容：新增无人机与灭火器专项识别基线模型，并将可直接运行的权重放入仓库。
- 涉及文件：`models/baseline/drone_yolo11n.pt`、`models/baseline/fire_extinguisher_yolov8.pt`、`smart_home/server.py`、`download_specialized_models.py`、`README.md`、`MODEL_EVALUATION.md`。
- 运行方式：先安装AI依赖 `python -m pip install -r requirements-ai.txt`，再运行 `python run.py --vision specialized`。
- 测试结果：已运行 `python -m unittest discover -s tests -v`，13个测试全部通过。
- 注意事项：后续替换模型前先阅读 `models/README.md`；自建训练集整理规则见 `datasets/README.md`。

### 林玄楚 / Codex

- 修改内容：新增模型维护说明和数据集维护说明，明确后续模型、训练集、来源、许可、SHA256和大文件管理规则。
- 涉及文件：`models/README.md`、`datasets/README.md`。
- 运行方式：文档类更新，无需单独运行。
- 测试结果：同上，13个测试全部通过。
- 注意事项：大量原始图片、训练缓存、临时权重不建议直接提交到Git；稳定发布模型可放入 `models/`，超大文件优先使用Git LFS、GitHub Release或共享网盘。

### 姚宇鹏

- 修改内容：web前端支持3d模型预览
- 涉及文件：`web`文件夹
- 运行方式：python run.py打开本地服务器
- 测试结果：3d模型预览功能正常，可能与部分浏览器有按键冲突，建议在ide内打开
- 注意事项：web前端GUI目前已完成3d预览，后续完善开门开灯动画相关功能


### 姚宇鹏

- 修改内容：新增无人机与灭火器检测告警信号系统、前端3d预览优化模型动画
- 涉及文件： `smart_home/signals.py`、`smart_home/service.py`、`smart_home/server.py`、`web/index.html`、`web/app.js `、`web/styles.css `
- 运行方式：先安装AI依赖 `python -m pip install -r requirements-ai.txt`，再运行 `python run.py --vision specialized`。Demo 模式不受任何影响
- 测试结果： SignalBus emit/subscribe/acknowledge 单元验证通过。
- 注意事项：告警信号目前存在内存中（SignalBus 单例），服务重启后丢失。阶段 2 如需持久化可接入数据库或 MQTT。两条通路都已就位，后续接硬件不需要改 detect() 业务逻辑。demo

### 姚宇鹏

- 修改内容：前端GUI优化，之后有时间再管前端了，对yolo模型全面测试，修改大部分接口不同意引发的bug
- 涉及文件： `smart_home`、`web`两个文件夹
- 运行方式：不变，详情见README.md
- 测试结果：目前yolo模式下yolo测试正常但没有训练集不能识别灭火器和无人机，specialize模式下这两个模型能正确识别灭火器和无人机，但是大概率会将其他物品意外识别成灭火器和无人机
- 注意事项：目前这两个模型能正确识别灭火器和无人机，但是大概率会将其他物品意外识别成灭火器和无人机

### 姚宇鹏

- 修改内容：新增 Hybrid 三模型并行识别模式，合并通用 YOLO11n（COCO 80类）与两个专用模型（无人机+灭火器）同时推理；hybrid 模式下仅输出置信度最高的单个标签，无人机/灭火器检测阈值默认提升至 80% 以抑制误报。前端新增电脑摄像头实时预览与连续检测功能，支持每 0.8 秒自动拍帧并回传后端识别。
- 涉及文件： smart_home/adapters.py（新增 HybridVisionAdapter 类）、smart_home/server.py（新增 --vision hybrid 选项和 --specialized-confidence 参数）、web/index.html（新增 video/canvas 元素和摄像头/实时检测按钮）、web/app.js（新增 startWebcam/stopWebcam/captureFromWebcam/startContinuous/stopContinuous/continuousTick 函数，detect() 支持静默模式，updateDetectButtonState() 适配 hybrid 模式）、web/styles.css（新增摄像头视频、实时检测按钮及呼吸动画样式）。
- 运行方式：# 确保已安装 AI 依赖
python -m pip install -r requirements-ai.txt

# 确保基线模型已下载（若 models/baseline/ 下无权重文件）
python download_specialized_models.py

# 启动 hybrid 模式（默认阈值 0.8）
python run.py --vision hybrid

# 可选：手动指定专用模型置信度阈值
python run.py --vision hybrid --specialized-confidence 0.7

- 测试结果： 已运行 python -m unittest discover -s tests -v，13 个测试全部通过。hybrid 模式下通用物体（person、chair 等）能正常检出并显示最高置信度标签；无人机/灭火器在置信度 ≥ 80% 时正确触发前端告警灯，低置信度假阳性被有效过滤。摄像头实时流在 localhost 下稳定运行，连续检测请求堆积保护（continuousPending 锁）工作正常。

- 注意事项：摄像头依赖浏览器 getUserMedia API，必须通过 localhost / 127.0.0.1 访问（非 HTTPS 下浏览器限制）；如果电脑有多个摄像头，代码默认优先使用后置/环境摄像头（facingMode: "environment"），笔记本内置摄像头可能需要改为 "user"；
连续检测默认间隔 800ms，在 web/app.js 顶部 CONTINUOUS_INTERVAL_MS 常量处可调整；
hybrid 模式同时加载三个模型（约 33 MB），首次启动加载时间较长，CPU 推理每帧约 200-400ms，Orange Pi 部署前建议导出 ONNX；

```


### 协作规则

- 修改内容：新增更新日志规则，要求每位组员提交代码前同步更新本文件。
- 涉及文件：`CHANGELOG.md`、`README.md`、`COLLABORATION.md`。
- 运行方式：文档类更新，无需单独运行。
- 测试结果：已运行 `python -m unittest discover -s tests -v`，13个测试全部通过。
- 注意事项：后续每个功能修改都至少写清楚修改人、日期、修改内容、涉及文件、运行或测试方式、后续注意事项。

## 日志填写模板

```md
## YYYY-MM-DD

### 修改人

- 修改内容：
- 涉及文件：
- 运行方式：
- 测试结果：
- 注意事项：
```
