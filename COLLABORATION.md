# 协作说明

## 日常流程

1. 开始修改前先拉取最新代码：`git pull`。
2. 每项任务使用独立分支，例如 `iot/serial`、`vision/dataset`、`gui/dashboard`。
3. 完成功能后运行测试：`python -m unittest discover -s tests -v`。
4. 提交前同步更新 `CHANGELOG.md`，写清楚修改人、日期、修改内容、涉及文件、运行或测试方式、后续注意事项。
5. 提交并推送分支，在 GitHub 创建 Pull Request，由另一名组员检查后合并。

## 分工建议

- `iot/serial`：Arduino传感器、执行器和串口协议。
- `orange-pi`：Orange Pi部署、网络和YOLO推理。
- `vision/dataset`：数据收集、标注和自训练模型。
- `gui`：管理界面、历史记录和展示流程。
- `docs`：日志、报告、PPT和验收材料。

不要提交数据库、训练缓存、临时模型权重、构建目录或打包后的EXE。当前 `models/baseline/` 下的两个基线权重是为了组员离线协作而保留的例外；后续数据集和大型模型优先使用共享网盘、GitHub Releases或Git LFS管理。
