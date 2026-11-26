# 投个好稿 · Dear Editor · まだ査読中

**1.0 · 浏览器本地版科研投稿管理工具**

## 在线体验

**[打开测试网页 → huaisong-yang.github.io/dear-editor/](https://huaisong-yang.github.io/dear-editor/)**

首次访问会加载公开演示资料：**用户名 `admin`，密码 `password`**。
演示修改仅保存在你自己的浏览器，不影响其他访问者。已有账号不会被演示数据覆盖。

## 功能

- 投稿流程、审稿轮次、返修和录用记录。
- 作者库、期刊库、机构地址与复制导出。
- 引用统计、个人学术主页。
- 本地多账号、作息进度、倒计时与待办事项。
- 昼夜模式、备份恢复及15秒操作撤回。

## 使用

推荐 **[下载本地版 ZIP](https://github.com/Huaisong-Yang/dear-editor/archive/refs/heads/main.zip)**，解压后打开 `index.html`。使用同一浏览器和固定文件路径，即可持续读取本机数据。

通过 GitHub Pages 的 HTTPS 地址访问，或下载完整文件夹后打开 `index.html`。
**每次保存自动写入本地浏览器，关闭页面后仍然保留，无需每天导出。**

在“备份与设置 → 本地自动保存”中，可以选择一个本地 JSON 文件。之后保存操作会自动同步到该文件。此功能适用于支持 File System Access API 的 Chrome / Edge；浏览器重启后可能需要点击“继续自动备份”重新授权。

账号、稿件不会自动上传或跨设备同步。更换浏览器或访问地址时，可用本地备份恢复。

普通 HTTP 局域网地址不保证密码加密 API 可用，应使用 HTTPS。

## 文件

- `app.js` / `app.css`：当前版本的应用脚本与样式，保留旧数据迁移兼容逻辑。
- `accounts.js`：本地账号存储隔离。
- `languages.js`：语言与方言文案。
- `vendor/`：OpenCC 及其许可证。
- `manifest.json` / `elsevier-autofill.user.js`：可选 Elsevier 表单预填扩展及用户脚本；不安装扩展也可使用网站。

图片作者识别使用外部 Tesseract 资源，首次使用需联网；识别结果须人工核对。
引用指标手动维护，不代表自动抓取的实时平台数据。

## 反馈

yanghuaisong@hrbeu.edu.cn
