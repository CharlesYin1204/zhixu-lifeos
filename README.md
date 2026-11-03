# 知序 LifeOS

知序 LifeOS 是一套个人学习与生活多 Agent AI 管理平台，将学习计划、知识库、AI 对话、多 Agent 协作、媒体解题、语音交互、会员与插件能力集中到个人工作台中。

## 核心能力

- 规划师、领域专家和审阅顾问组成的多 Agent 工作流。
- 文本、图片、录音、实时语音和数学公式内容处理。
- 学习计划、任务、个人知识库和 AI 对话。
- 会员、额度、插件和支付管理。
- 独立管理后台、任务 Worker、语音服务和 Android 客户端。

## 产品界面

![知序 LifeOS 个人工作台](docs/screenshots/desktop-overview.png)

![知序 LifeOS 图片学习](docs/screenshots/media-desktop-image.png)

![知序 LifeOS 管理后台](docs/screenshots/desktop-admin.png)

## 技术架构

- React 19、Next.js 16、Node.js 22
- MySQL 5.7/8.0
- 独立任务 Worker 与实时语音 WebSocket 服务
- Android WebView、Nginx、systemd

## 本地运行

1. 安装 Node.js 22 和 MySQL。
2. 执行 `npm ci`。
3. 复制 `.env.example` 为 `.env.local`，配置数据库、会话、加密主密钥、AI 和支付参数。
4. 执行 `npm run db:init` 初始化空数据库。
5. 分别运行 `npm run dev`、`npm run worker` 和语音服务。

## 生产部署

使用 `bash scripts/deploy.sh` 创建独立发布目录、执行候选健康检查并切换服务；使用 `bash scripts/deploy.sh --rollback` 回退到上一成功版本。生产环境包含 Web、Worker 和语音服务，Nginx 负责 HTTPS 与 WebSocket 转发。更新前必须备份 MySQL、环境配置、加密主密钥和 Android 签名材料。

接口测试使用 `npm run test:api`，浏览器验证使用 `npm run test:browser`。

## 项目结构

- `app/`：公开页面、用户中心、后台和 API
- `components/`：产品界面组件
- `lib/`：业务、数据库、AI、支付和权限服务
- `scripts/`：部署、任务、测试和备份工具
- `docs/`：产品和技术文档
- `android/`：Android 客户端
- `project-docs/`：项目维护记录

## 联系方式

微信：`charlesyin6015`
