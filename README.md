# 投个好稿 · Dear Editor · まだ査読中

**1.0 · 浏览器本地版科研投稿管理工具**

## 功能

- 投稿流程、审稿轮次、返修和录用记录。
- 作者库、期刊库、机构地址与复制导出。
- 引用统计、个人学术主页。
- 本地多账号、作息进度、倒计时与待办事项。
- 昼夜模式、备份恢复及15秒操作撤回。

## 使用

通过 GitHub Pages 的 HTTPS 地址访问，或下载完整文件夹后打开 `index.html`。
账号、稿件等资料保存在当前浏览器；不会自动上传或跨设备同步。更换浏览器或访问地址时，需要导出、恢复个人备份。

普通 HTTP 局域网地址不保证密码加密 API 可用，应使用 HTTPS。

## 部署 GitHub Pages

1. 上传本目录内容到仓库根目录，确保直接包含 `index.html`。
2. 仓库 Settings → Pages → Deploy from a branch。
3. 选择 `main` 和 `/ (root)`，保存并等待部署。
4. 网站地址通常为 `https://用户名.github.io/dear-editor/`。

无需安装依赖或执行构建。资源使用相对路径，支持项目子路径部署。

## 文件

- `app.js` / `app.css`：当前版本的应用脚本与样式，保留旧数据迁移兼容逻辑。
- `accounts.js`：本地账号存储隔离。
- `languages.js`：语言与方言文案。
- `vendor/`：OpenCC 及其许可证。
- `integrations/elsevier/`：可选 Elsevier 表单预填扩展及用户脚本。

图片作者识别使用外部 Tesseract 资源，首次使用需联网；识别结果须人工核对。
引用指标手动维护，不代表自动抓取的实时平台数据。

## 反馈

yanghuaisong@hrbeu.edu.cn
