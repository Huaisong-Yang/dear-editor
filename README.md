# 投个好稿 · Dear Editor · まだ査読中

**1.0 · 科研投稿管理工具**

**日常使用（Windows）：[下载 ZIP](https://github.com/Huaisong-Yang/dear-editor/archive/refs/heads/main.zip)，解压后双击 `DearEditor.cmd`。**

## 在线体验

**[打开测试网页 → huaisong-yang.github.io/dear-editor/](https://huaisong-yang.github.io/dear-editor/)**

这是静态演示版。全新浏览器环境可用 **`admin` / `password`** 体验。改动只保存在当前浏览器，清除网站数据后可能丢失；它不会连接你的本地数据库，也不会影响其他访问者。

## 功能

- 投稿流程、审稿轮次、返修和录用记录。
- 作者库、期刊库、机构地址与复制导出。
- 引用统计、个人学术主页。
- 本地多账号、作息进度、倒计时与待办事项。
- 昼夜模式、备份恢复及15秒操作撤回。

## Windows 本地使用

1. 安装 Python 3，确保 `py` 或 `python` 命令可用。不需要安装额外的 Python 包。
2. 下载并解压完整 ZIP，双击 **`DearEditor.cmd`**，不要直接打开 `index.html`。
3. 在自动打开的 `http://127.0.0.1:8765` 注册或登录，使用期间保持启动窗口打开。本地版不预置演示账号。

每次成功保存都写入 `%LOCALAPPDATA%\DearEditor\workspace.sqlite3`。清除 Cookie 或网站数据后，重新登录原账号即可找回记录，不必每天导出。服务仅在本机监听；数据库中的稿件内容未加密，也不会自动上传。换电脑或防范磁盘故障时，仍建议导出备份。

旧网页或直接打开 HTML 时保存的资料，可以从「备份与设置」导入现有 JSON 一次。导入不会替换当前本地账号的用户名和密码。

## 文件

- `app.js` / `app.css`：当前版本的应用脚本与样式，保留旧数据迁移兼容逻辑。
- `DearEditor.cmd`、`local_server.py`、`local-mode.js`、`local-memory.js`：Windows 启动和本地数据库功能。
- `accounts.js`：本地账号存储隔离。
- `languages.js`：语言与方言文案。
- `vendor/`：OpenCC 及其许可证。
- `manifest.json` / `elsevier-autofill.user.js`：可选 Elsevier 表单预填扩展及用户脚本；不安装扩展也可使用网站。

图片作者识别使用外部 Tesseract 资源，首次使用需联网；识别结果须人工核对。
引用指标手动维护，不代表自动抓取的实时平台数据。

## 反馈

yanghuaisong@hrbeu.edu.cn
