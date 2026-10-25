# 六级研习室 · CET6 Practice

Windows 本地六级练习工具。下载便携版后，无需安装 Python 或 Node.js；题目、答案、解析、音频和练习记录均在本机使用。
感谢 Linux Do 社区：https://linux.do/

## 普通用户下载

进入 [Releases](https://github.com/o-Sakurajimamai-o/cet6-practice/releases)，下载 `CET6-Practice-v1.0.0-Windows-x64.zip`，完整解压到自己可写入的文件夹，再双击 `CET6-Practice.exe`。不要在压缩包内直接运行，不要只复制 EXE。

程序会自动打开浏览器。保留服务窗口；停止时双击 `Stop.bat`，或在服务窗口按 Ctrl+C。端口被其他软件使用时会选择空闲端口，不会结束其他软件。重复启动同一份程序会打开已有实例。

标准包包含 76 套、3467 题，其中 3315 道客观题，以及现有的 49 套听力音频。其余套次的源材料本身不带听力，页面会提示。作文和翻译供练习、参考，不自动评分。

## 可选原 PDF

题干、答案和解析已存入数据库，标准包正常使用不依赖原 PDF。需要对照原卷时，再下载 `CET6-Practice-v1.0.0-Optional-PDF.zip`，将其中 `CET6-Practice/resources` 合并到程序目录的 `resources`。未安装时，原 PDF 链接会显示安装说明。

开发环境：Windows x64、Python 3.12、Node.js 18+（本次使用 Node 24）。

```powershell
python -m venv backend/venv
backend/venv/Scripts/python.exe -m pip install -r backend/requirements-runtime.txt
cd frontend
npm ci
npm run build
cd ..
backend/venv/Scripts/python.exe packaging/launcher.py
```

构建便携版：安装 `packaging/requirements-build.txt`，准备好 `seed` 和 `resources`，运行 `python packaging/build_windows.py`。构建输出为 `dist/CET6-Practice`。

第三方许可见 `THIRD_PARTY_NOTICES.md` 与 `third_party_licenses/`。源码、第三方依赖和考试材料各自的权利范围分别适用，公开仓库不为所有材料额外授予统一许可证。

