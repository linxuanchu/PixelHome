# PixelHome 更新日志

本文件用于记录项目每次重要修改。每位组员修改功能、接口、模型、数据集、3D预览或硬件适配后，都需要同步追加更新记录，方便其他人拉取代码后快速了解变化。

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
