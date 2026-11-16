# 云端数据管理台

一个跑在**本地**的独立 Web 管理台，用于「查看 + 管理」一个或多个腾讯云 CloudBase（云开发）环境内的全部资源：

- **云数据库**：所有集合的文档（浏览 / 搜索 / 排序 / 新增 / 编辑 / 删除）
- **云存储**：根目录下的全部文件（目录浏览 / 图片预览 / 上传 / 删除 / 临时链接）
- **多环境切换**：顶栏下拉框切换不同云环境，默认环境可随时变更
- **环境配置页**：在页面内直接新增 / 编辑 / 删除云环境及其腾讯云凭证，保存即时生效、重启不丢失（持久化到 `config/environments.json`），并支持一键测试凭证连通性

> 这是一个与具体业务应用无关的通用运维工具：只要持有目标云环境的腾讯云 API 凭证，即可管理该环境内的数据库与云存储。

## 功能一览

| Tab | 能力 |
| --- | --- |
| 概览 | 各集合文档数统计、云存储顶层目录数 / 总文件数 / 总大小、子目录聚合视图 |
| 云数据库 | 集合列表 → 文档分页表格（支持字段搜索、排序）→ 文档详情抽屉（JSON 编辑 / 新增 / 删除） |
| 云存储 | 逐级目录浏览、图片在线预览、上传文件、删除文件（临时签名 URL 预览，2 小时有效） |
| 环境配置 | 新增 / 编辑 / 删除云环境与凭证、设默认、测试凭证连通性；列表仅显示脱敏 SecretId |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js（≥16）+ 原生 `http` 模块，无框架 |
| 数据库操作 | `@cloudbase/node-sdk`（与云函数 `wx-server-sdk` 同套 API） |
| 存储列举 / 临时 URL / 删除 | `@cloudbase/manager-node`（`listDirectoryFiles` / `getTemporaryUrl` / `deleteFile`） |
| 存储上传 | `@cloudbase/node-sdk`（`uploadFile`） |
| 前端 | 零依赖原生 JS + 单页 HTML（`public/index.html` + `public/styles.css` + `public/js/*.js`，ES Modules，无构建） |

## 目录结构

```
.
├── server.js          # 本地管理服务器（全部 API + 静态资源服务）
├── config/
│   └── environments.json  # 环境+凭证持久化（页面「环境配置」自动写入，已被 .gitignore 忽略）
├── public/
│   ├── index.html     # 管理台单页（概览 / 云数据库 / 云存储 / 环境配置 四个 Tab）
│   ├── styles.css     # 全局样式
│   └── js/            # 前端逻辑（零依赖原生 JS，无构建）
│       ├── common.js      # 工具 + 统一 API 请求 + 全局状态
│       ├── overview.js    # 概览 Tab
│       ├── db.js          # 云数据库 Tab + 文档模态框
│       ├── storage.js     # 云存储 Tab
│       ├── settings.js    # 环境配置 Tab
│       └── main.js        # Tab 切换 / 环境切换 / 事件绑定 / 启动（ES Module 入口）
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置凭证

打开左侧「环境配置」页 → 点「新增环境」→ 填环境 ID + SecretId + SecretKey → 保存，即时生效并持久化到 `config/environments.json`（无需重启）。
> - 环境 ID 在 [云开发控制台](https://console.cloud.tencent.com/tcb) 获取
> - SecretId / SecretKey 在 [腾讯云控制台 → API 密钥管理](https://console.cloud.tencent.com/api/v3/secret-key) 获取
> - `config/` 已被 `.gitignore` 忽略，**切勿提交真实密钥**

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

### 4. 开发校验（可选）

```bash
npm run check   # 语法检查：7 个 JS 文件（server + 前端 6 模块）逐一 node --check
npm run smoke   # 隔离冒烟测试：临时配置目录 + 假凭证 + 独立端口启动服务，16 项断言（不触碰真实 config/）
npm test        # check + smoke 一起跑
```

## 配置项

环境（环境 ID + 凭证）由**页面「环境配置」页**管理，持久化在 `config/environments.json`。服务自身的运行选项通过**启动时注入的环境变量**设置（如 `ADMIN_PORT=8787 npm start`）。

| 变量 | 说明 |
| --- | --- |
| `KNOWN_COLLECTIONS` | 兜底集合名单（`listCollections` 失败时生效，逗号分隔；默认置空，由你按需配置） |
| `ADMIN_PORT` | 服务端口（默认 `8787`） |
| `ADMIN_HOST` | 绑定地址（默认 `127.0.0.1`，**务必保持本机回环**） |
| `ADMIN_TOKEN` | 设置后所有 `/api` 请求须带 `x-admin-token: <值>` 请求头 |
| `ADMIN_UPLOAD_LIMIT` | 单文件上传上限（字节，默认 `20MB`） |

## API 一览

所有 API 均支持 `?env=<环境ID>` 参数指定目标云环境（缺省为默认环境）。设置 `ADMIN_TOKEN` 时请求须带 `x-admin-token` 头（或 `?token=` 查询参数）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 各环境凭证与 SDK 就绪状态 |
| GET | `/api/environments` | 环境列表（仅脱敏 SecretId + 是否已配置凭证，不下发明文密钥） |
| POST | `/api/environments` | 新增环境（body: `{ envId, secretId, secretKey, makeDefault? }`） |
| PUT | `/api/environments` | 编辑环境（body: `{ curEnvId, envId?, secretId?, secretKey?, makeDefault? }`，密钥留空 = 不变） |
| DELETE | `/api/environments?env=` | 删除环境（删除默认环境时自动改选其余第一个） |
| PUT | `/api/environments/default` | 设置默认环境（body: `{ envId }`） |
| POST | `/api/environments/test` | 测试凭证连通性（body: `{ envId, secretId?, secretKey? }`，密钥缺省时用已保存凭证） |
| GET | `/api/overview` | 概览：各集合文档数 + 云存储统计（60s 服务端 TTL 缓存；响应含 `at`/`cached`，`?fresh=1` 强制重算） |
| GET | `/api/collections` | 集合名列表 |
| GET | `/api/collection?name=&page=&size=&sort=&sortDir=&field=&q=` | 文档分页查询（`q` 对 `field` 做不区分大小写正则匹配；`q` 须配合 `field` 使用，`field` 为空时返回 400） |
| GET | `/api/doc?name=&id=` | 读取单条文档 |
| POST | `/api/collection?name=` | 新增文档（JSON body，不允许指定 `_id`） |
| PUT | `/api/doc?name=&id=` | 更新文档（JSON body 整包替换） |
| DELETE | `/api/doc?name=&id=` | 删除文档 |
| GET | `/api/storage?prefix=&maxKeys=` | 列举某前缀下一级子目录与文件 |
| POST | `/api/storage/urls` | 批量获取临时访问 URL（body: `{ fileIDs: [...] }`，2 小时有效） |
| POST | `/api/storage/delete` | 批量删除文件（body: `{ fileIDs: [...] }`） |
| POST | `/api/storage/upload?cloudPath=` | 上传文件（raw body，上限见 `ADMIN_UPLOAD_LIMIT`） |
| GET | `/api/storage/walk?prefix=&max=` | 递归扫描前缀下文件（概览 / 子目录聚合用） |

## 安全设计

- **仅本机回环**：服务默认绑定 `127.0.0.1`，不对外网暴露；如确需对外访问，请自行在反向代理层加鉴权，并务必设置 `ADMIN_TOKEN`。
- **密钥零下发**：腾讯云 SecretId / SecretKey 只存在于本进程环境变量中，永远不会发送到浏览器；浏览器 ↔ 本服务走同源 HTTP，本服务代为调用 CloudBase，前端零凭证。
- **路径白名单**：静态资源仅可访问 `public/` 目录（防目录穿越）。
- **输入校验**：集合名限制 `^[a-zA-Z0-9_-]+$`；分页、排序、上限均有边界钳制。

## 常见问题

**Q: 顶栏环境下拉里没有我想要的云环境？**
打开左侧「环境配置」页 →「新增环境」，填入环境 ID 与该环境的腾讯云凭证即可，保存即时生效，无需重启。

**Q: 页面显示「未配置凭证」？**
到「环境配置」页点该环境行的「编辑」，补全 SecretId / SecretKey 后保存（也可在模态框里先点「测试连通性」验证）。

**Q: 换机器 / 想重置环境列表？**
删除 `config/environments.json` 后重启服务，再在「环境配置」页逐个新增即可。

**Q: 集合列表只看到几个内置示例集合？**
这是 `listCollections` 接口失败时的兜底名单（`KNOWN_COLLECTIONS`）。请到「环境配置」页点「测试」确认凭证能否访问该环境，或启动时用 `KNOWN_COLLECTIONS` 环境变量配置你自己的集合名单。

**Q: 图片预览失效？**
临时 URL 有效期 2 小时，刷新页面重新获取即可。

## 许可

内部运维工具，请勿外泄 `config/environments.json` 中的腾讯云密钥。
