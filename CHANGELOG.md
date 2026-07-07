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
