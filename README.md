# 云端数据管理台

一个跑在**本地**的独立 Web 管理台，用于「查看 + 管理」一个或多个腾讯云 CloudBase（云开发）环境内的全部资源：

- **云数据库**：所有集合的文档（浏览 / 搜索 / 排序 / 新增 / 编辑 / 删除）
- **云存储**：根目录下的全部文件（目录浏览 / 图片预览 / 上传 / 删除 / 临时链接）
- **多环境切换**：顶栏下拉框切换不同云环境，默认环境由 `TCB_ENV_ID` 指定

> 这是一个与具体业务应用无关的通用运维工具：只要持有目标云环境的腾讯云 API 凭证，即可管理该环境内的数据库与云存储。

## 功能一览

| Tab | 能力 |
| --- | --- |
| 概览 | 各集合文档数统计、云存储顶层目录数 / 总文件数 / 总大小、子目录聚合视图 |
| 云数据库 | 集合列表 → 文档分页表格（支持字段搜索、排序）→ 文档详情抽屉（JSON 编辑 / 新增 / 删除） |
| 云存储 | 逐级目录浏览、图片在线预览、上传文件、删除文件（临时签名 URL 预览，2 小时有效） |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js（≥16）+ 原生 `http` 模块，无框架 |
| 数据库操作 | `@cloudbase/node-sdk`（与云函数 `wx-server-sdk` 同套 API） |
| 存储列举 / 临时 URL / 删除 | `@cloudbase/manager-node`（`listDirectoryFiles` / `getTemporaryUrl` / `deleteFile`） |
| 存储上传 | `@cloudbase/node-sdk`（`uploadFile`） |
| 前端 | 零依赖原生 JS + 单页 HTML（`public/index.html` + `public/app.js`） |

## 目录结构

```
.
├── server.js          # 本地管理服务器（全部 API + 静态资源服务）
├── public/
│   ├── index.html     # 管理台单页（概览 / 云数据库 / 云存储 三个 Tab）
│   └── app.js         # 前端逻辑（零依赖原生 JS）
├── .env.example       # 配置模板
├── .env               # 真实配置（已被 .gitignore 忽略，勿提交）
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置凭证

```bash
cp .env.example .env
```

编辑 `.env`，填入你的云环境 ID 与腾讯云 API 凭证（须为能访问目标云环境的账号）：

```ini
TCB_ENV_ID=<你的云环境 ID>
TCB_SECRET_ID=你的 SecretId
TCB_SECRET_KEY=你的 SecretKey
```

> - 云环境 ID 在 [云开发控制台](https://console.cloud.tencent.com/tcb) 获取
> - SecretId / SecretKey 在 [腾讯云控制台 → API 密钥管理](https://console.cloud.tencent.com/api/v3/secret-key) 获取
> - `TCB_ENV_ID` 为必填项，未配置时服务启动会直接报错退出
> - `.env` 已被 `.gitignore` 忽略，**切勿提交真实密钥**

### 3. 启动

```bash
npm start
```

打开浏览器访问 **http://127.0.0.1:8787/** 即可。

启动日志示例：

```
==========================================================
  云端数据管理台（多环境）
  本地访问: http://127.0.0.1:8787/
  云环境 : <你的环境 ID>（默认 <你的环境 ID>）
  凭证   : 已配置
==========================================================
```

## 配置项（`.env`）

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `TCB_ENV_ID` | **是** | — | 默认云环境 ID |
| `TCB_ENV_IDS` | 否 | 仅含 `TCB_ENV_ID` | 可切换环境列表（逗号分隔），前端顶栏下拉切换 |
| `TCB_SECRET_ID` | **是** | — | 腾讯云 SecretId（第 1 个环境） |
| `TCB_SECRET_KEY` | **是** | — | 腾讯云 SecretKey（第 1 个环境） |
| `TCB_SECRET_ID_N` / `TCB_SECRET_KEY_N` | 否 | 回落默认凭证 | 第 N 个环境的独立凭证（跨账号场景，N 为 `TCB_ENV_IDS` 中的位置序号，如第 2 个环境用 `_2`） |
| `KNOWN_COLLECTIONS` | 否 | 内置示例名单 | 兜底集合名单（逗号分隔），仅在 `listCollections` 接口失败时生效 |
| `ADMIN_PORT` | 否 | `8787` | 服务端口 |
| `ADMIN_HOST` | 否 | `127.0.0.1` | 绑定地址，**务必保持本机回环，不对外暴露** |
| `ADMIN_TOKEN` | 否 | — | 设置后所有 `/api` 请求须携带请求头 `x-admin-token: <值>` |
| `ADMIN_UPLOAD_LIMIT` | 否 | `20971520`（20MB） | 单文件上传上限（字节） |

**多环境示例**（两个环境分属不同账号）：

```ini
TCB_ENV_IDS=<环境A>,<环境B>
TCB_SECRET_ID=<环境A账号 SecretId>
TCB_SECRET_KEY=<环境A账号 SecretKey>
TCB_SECRET_ID_2=<环境B账号 SecretId>
TCB_SECRET_KEY_2=<环境B账号 SecretKey>
```

## API 一览

所有 API 均支持 `?env=<环境ID>` 参数指定目标云环境（缺省为默认环境）。设置 `ADMIN_TOKEN` 时请求须带 `x-admin-token` 头（或 `?token=` 查询参数）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 各环境凭证与 SDK 就绪状态 |
| GET | `/api/overview` | 概览：各集合文档数 + 云存储统计 |
| GET | `/api/collections` | 集合名列表 |
| GET | `/api/collection?name=&page=&size=&sort=&sortDir=&field=&q=` | 文档分页查询（`q` 对 `field` 做不区分大小写正则匹配） |
| GET | `/api/doc?name=&id=` | 读取单条文档 |
| POST | `/api/collection?name=` | 新增文档（JSON body，不允许指定 `_id`） |
| PUT | `/api/doc?name=&id=` | 更新文档（JSON body 部分更新） |
| DELETE | `/api/doc?name=&id=` | 删除文档 |
| GET | `/api/storage?prefix=&maxKeys=` | 列举某前缀下一级子目录与文件 |
| GET | `/api/storage/urls?fileIDs=a,b,c` | 批量获取临时访问 URL（2 小时有效） |
| POST | `/api/storage/delete` | 批量删除文件（body: `{ fileIDs: [...] }`） |
| POST | `/api/storage/upload?cloudPath=` | 上传文件（raw body，上限见 `ADMIN_UPLOAD_LIMIT`） |
| GET | `/api/storage/walk?prefix=&max=` | 递归扫描前缀下文件（概览 / 子目录聚合用） |

## 安全设计

- **仅本机回环**：服务默认绑定 `127.0.0.1`，不对外网暴露；如确需对外访问，请自行在反向代理层加鉴权，并务必设置 `ADMIN_TOKEN`。
- **密钥零下发**：腾讯云 SecretId / SecretKey 只存在于本进程环境变量中，永远不会发送到浏览器；浏览器 ↔ 本服务走同源 HTTP，本服务代为调用 CloudBase，前端零凭证。
- **路径白名单**：静态资源仅可访问 `public/` 目录（防目录穿越）。
- **输入校验**：集合名限制 `^[a-zA-Z0-9_-]+$`；分页、排序、上限均有边界钳制。

## 常见问题

**Q: 服务启动即退出，提示「未配置 TCB_ENV_ID」？**
在 `.env` 填入默认云环境 ID 后重启。

**Q: 页面显示「未配置凭证」？**
在 `.env` 填入 `TCB_SECRET_ID` / `TCB_SECRET_KEY` 后重启服务。

**Q: 集合列表只看到几个内置示例集合？**
这是 `listCollections` 接口失败时的兜底名单（`KNOWN_COLLECTIONS`）。请检查凭证账号是否有权限访问目标环境，或在 `.env` 中用 `KNOWN_COLLECTIONS` 配置你自己的集合名单。

**Q: 图片预览失效？**
临时 URL 有效期 2 小时，刷新页面重新获取即可。

## 许可

内部运维工具，请勿外泄 `.env` 中的腾讯云密钥。
