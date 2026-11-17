---
项目: weixin-cloud-admin
名称: 云端数据管理台
类型: 本地运维工具
状态: 生产中
技术栈: Node.js + CloudBase SDK
开始: 2026-11-16
最后更新: 2026-11-16
---

# 云端数据管理台

一个跑在**本地**的独立 Web 管理台，用于「查看 + 管理」一个或多个腾讯云 CloudBase（云开发）环境内的全部资源：

- **云数据库**：所有集合的文档（浏览 / 搜索 / 排序 / 新增 / 编辑 / 删除）
- **数据库索引 & 集合权限**：查看 / 创建 / 删除集合索引（多字段、升/降序、唯一），查看 / 修改集合安全规则（预设 + CUSTOM 规则表达式）
- **云存储**：根目录下的全部文件（目录浏览 / 图片预览 / 上传 / 删除 / 临时链接）
- **云存储权限（ACL）**：查看 / 修改环境级存储权限（五档预设 + CUSTOM 读写规则表达式）
- **云函数**：函数列表 / 详情 / 配置调整 / 调用测试 / 定时触发器管理 / 删除
- **多环境切换**：顶栏下拉框切换不同云环境，默认环境可随时变更
- **环境配置页**：在页面内直接新增 / 编辑 / 删除云环境及其腾讯云凭证，保存即时生效、重启不丢失（持久化到 `config/environments.json`），并支持一键测试凭证连通性

> 这是一个与具体业务应用无关的通用运维工具：只要持有目标云环境的腾讯云 API 凭证，即可管理该环境内的数据库与云存储。

## 功能一览

| Tab | 能力 |
| --- | --- |
| 概览 | 各集合文档数统计、云存储顶层目录数 / 总文件数 / 总大小、子目录聚合视图 |
| 云数据库 | 集合列表 → 文档分页表格（支持字段搜索、排序；有 OpenID / OwnerID 时优先显示，动态列挑选常用标量字段并保持稳定，复杂 / 内部字段留在完整 JSON 详情）→ 文档详情抽屉（JSON 编辑 / 新增 / 删除）；「索引 / 权限」面板：查看 / 创建 / 删除集合索引；按当前集合查看 / 修改安全规则预设，CUSTOM 分别设置 read 与 write 表达式 |
| 云存储 | 逐级目录浏览、图片在线预览、上传文件、删除文件（临时签名 URL 预览，2 小时有效）；顶部 ACL 卡片：环境级 ACL 预设作为默认权限；CUSTOM 可在 read / write 规则中使用 `resource.path` 限制目录，但它替代预设且仍是覆盖整个环境的完整规则，不是独立的目录 ACL |
| 云函数 | 函数列表 → 展开详情：基础信息 / 配置调整（内存 / 超时）/ 环境变量 / 触发器（增删）/ 在线调用测试（JSON 参数 → 结果 + 日志 + 耗时）/ 删除函数 |
| 环境配置 | 新增 / 编辑 / 删除云环境与凭证、设默认、测试凭证连通性；列表仅显示脱敏 SecretId |

侧栏与快捷键顺序：概览（1）→ 云数据库（2）→ 云存储（3）→ 云函数（4）→ 环境配置（5）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js（≥16）+ 原生 `http` 模块，无框架 |
| 数据库操作 | `@cloudbase/node-sdk`（与云函数 `wx-server-sdk` 同套 API） |
| 索引 / 集合权限 | `@cloudbase/manager-node`（`database.describeCollection` / `updateCollection`；安全规则走 `commonService('tcb','2018-06-08')` 的 `DescribeSafeRule` / `ModifySafeRule`） |
| 存储列举 / 临时 URL / 删除 | `@cloudbase/manager-node`（`listDirectoryFiles` / `getTemporaryUrl` / `deleteFile`） |
| 存储上传 | `@cloudbase/node-sdk`（`uploadFile`） |
| 存储权限（ACL） | `@cloudbase/manager-node`（`storage.getStorageAcl` / `setStorageAcl`） |
| 云函数 | `@cloudbase/manager-node`（`functions.*`）；触发器列举走 `commonService('scf','2018-04-16')` 的 `ListTriggers` |
| 前端 | 零依赖原生 JS + 单页 HTML（`public/index.html` + `public/styles.css` + `public/js/*.js`，ES Modules，无构建） |

## 目录结构

```
.
├── server.js          # 本地管理服务器（全部 API + 静态资源服务）
├── config/
│   ├── environments.json  # 环境+凭证持久化（页面「环境配置」自动写入，已被 .gitignore 忽略）
│   └── audit.jsonl        # 变更审计日志（append-only，记录文档/文件/环境增删改，已被 .gitignore 忽略）
├── public/
│   ├── index.html     # 管理台单页（概览 / 云数据库 / 云存储 / 云函数 / 环境配置 五个 Tab）
│   ├── styles.css     # 全局样式
│   └── js/            # 前端逻辑（零依赖原生 JS，无构建）
│       ├── common.js      # 工具 + 统一 API 请求 + 全局状态
│       ├── overview.js    # 概览 Tab
│       ├── db.js          # 云数据库 Tab + 文档模态框 + 索引/权限面板
│       ├── storage.js     # 云存储 Tab + ACL 卡片
│       ├── functions.js   # 云函数 Tab（列表 / 配置 / 调用 / 触发器）
│       ├── settings.js    # 环境配置 Tab
│       └── main.js        # Tab 切换 / 环境切换 / 事件绑定 / 启动（ES Module 入口）
├── scripts/
│   ├── check.js           # 语法检查（10 个 JS 逐一 node --check）
│   ├── smoke.js           # 隔离冒烟测试（Mock 模式：临时配置目录 + 内存假 SDK，66 项断言）
│   ├── e2e.js             # Playwright E2E（未安装 playwright 时自动 SKIPPED）
│   └── mock-cloudbase.js  # 内存版 CloudBase SDK（MOCK_CLOUDBASE=1 时替代真实 SDK；覆盖文档 / 存储 / 索引 / 集合权限 / 存储 ACL / 云函数 / 触发器）
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
npm run check   # 语法检查：10 个 JS 文件逐一 node --check
npm run smoke   # 隔离冒烟测试：临时配置目录 + 内存 Mock SDK（MOCK_CLOUDBASE=1），66 项断言（不触碰真实 config/，零网络零凭证）
npm run e2e     # Playwright 无头浏览器 E2E（需先 npm i -D playwright && npx playwright install chromium；未安装则 SKIPPED）
npm test        # check + smoke + e2e 一起跑
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
| `MOCK_CLOUDBASE` | `=1` 时以内置内存 Mock 替代 CloudBase SDK（smoke/E2E 测试用，零网络零凭证；**勿在生产使用**） |

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
| GET | `/api/doc?name=&id=` | 读取单条文档（响应含 `etag`：打开时的内容指纹，保存时回传） |
| POST | `/api/collection?name=` | 新增文档（JSON body，不允许指定 `_id`） |
| PUT | `/api/doc?name=&id=` | 更新文档（JSON body 整包替换；body 可带 `$etag` 回传打开时的指纹做**乐观锁**并发保护——与当前指纹不一致返回 409，防静默覆盖他人修改） |
| DELETE | `/api/doc?name=&id=` | 删除文档 |
| GET | `/api/storage?prefix=&maxKeys=` | 列举某前缀下一级子目录与文件 |
| POST | `/api/storage/urls` | 批量获取临时访问 URL（body: `{ fileIDs: [...] }`，2 小时有效） |
| POST | `/api/storage/delete` | 批量删除文件（body: `{ fileIDs: [...] }`） |
| POST | `/api/storage/upload?cloudPath=` | 上传文件（raw body，上限见 `ADMIN_UPLOAD_LIMIT`；**同名路径返回 409**，防误覆盖——需覆盖请先删除旧文件） |
| GET | `/api/storage/walk?prefix=&max=` | 递归扫描前缀下文件（概览 / 子目录聚合用，上限 5000） |
| GET | `/api/collection/indexes?name=` | 集合索引列表（`indexes: [{ name, unique, keys: ["field:1"/"field:-1"], accesses }]`，含默认 `_id_`） |
| POST | `/api/collection/indexes?name=` | 创建索引（body: `{ indexName, keys: [{ field, direction: "asc"|"desc" }], unique? }`，多字段复合索引） |
| DELETE | `/api/collection/indexes?name=&index=` | 删除指定索引 |
| GET | `/api/collection/permission?name=` | 集合安全规则（`acl`: READONLY/PRIVATE/ADMINWRITE/ADMINONLY/CUSTOM + `rule` 表达式） |
| PUT | `/api/collection/permission?name=` | 修改集合安全规则（body: `{ acl, rule? }`；CUSTOM 时 `rule: { read, write }` 两个非空表达式均必填，缺省 400） |
| GET | `/api/storage/acl` | 环境级存储权限（`acl` + CUSTOM 时 `rule: { read, write }`） |
| PUT | `/api/storage/acl` | 修改存储权限（body: `{ acl, rule? }`；CUSTOM 时 `rule.read` / `rule.write` 必填，boolean 或规则表达式，可通过 `resource.path` 编写路径条件；仍为环境级完整规则） |
| GET | `/api/functions` | 云函数列表（`functions: [{ name }]` + `total`） |
| GET | `/api/function?name=` | 函数详情（基础信息 + 环境变量 + 触发器列表；触发器列举失败不阻断） |
| POST | `/api/function/config?name=` | 更新函数配置（body: `{ timeout?, memorySize?, envVariables? }`，仅更新传入字段） |
| POST | `/api/function/invoke?name=` | 在线调用函数（body 为 JSON 参数对象；返回 `{ ok, err, log, duration, result }`） |
| POST | `/api/function/trigger?name=` | 创建触发器（body: `{ name, type: "timer"|"event", config }`，定时为 cron 表达式） |
| DELETE | `/api/function/trigger?name=&trigger=` | 删除触发器 |
| DELETE | `/api/function?name=` | 删除云函数 |

所有接口错误响应统一为 `{ "error": "可读原因" }`（含 HTTP 400/401/404/409/500/503）。

## 安全设计

- **仅本机回环**：服务默认绑定 `127.0.0.1`，不对外网暴露。启动前强校验：`ADMIN_HOST` 非回环地址（含 `0.0.0.0`）且未配置 `ADMIN_TOKEN` 时**直接拒绝启动**；对外暴露须先设置 `ADMIN_TOKEN` 并在反向代理层加鉴权。
- **密钥零下发**：腾讯云 SecretId / SecretKey 只存在于本进程与 `config/environments.json` 中，永远不会发送到浏览器；浏览器 ↔ 本服务走同源 HTTP，本服务代为调用 CloudBase，前端零凭证。
- **路径白名单**：静态资源仅可访问 `public/` 目录（`path.resolve` 归一化 + 前缀 + 分隔符校验，防目录穿越）。
- **输入校验**：集合名限制 `^[a-zA-Z0-9_-]+$`；筛选正则 ≤200 字符且字段名白名单；分页、排序、上限均有边界钳制；上传路径拒绝 `..` / 空段。
- **`ADMIN_TOKEN` 鉴权**：设置后所有 `/api` 请求须带 `x-admin-token` 请求头（或 `?token=` 查询参数），比较采用常量时间算法。
- **变更审计**：文档 / 存储文件 / 环境 / 索引 / 集合权限 / 存储 ACL / 云函数（配置 / 调用 / 触发器 / 删除）的增删改均追加到 `config/audit.jsonl`（单行 JSON：`at`/`action`/`envId`/`target`/`detail`），便于事后追溯「谁在何时改了什么」。

## 缓存与竞态防护

| 层 | 机制 | 说明 |
| --- | --- | --- |
| 服务端 | 概览 TTL 缓存（60s） | 各集合 count + 存储采样是重操作；`?fresh=1` 强制重算，响应含 `at`（统计时刻）/`cached` |
| 服务端 | 集合 count 二级缓存（5min） | 文档增删改后精确失效对应集合，读路径不受影响 |
| 服务端 | 文档 `etag` 乐观锁 | 打开文档时下发内容指纹，保存回传 `$etag` 比对；期间被改过 → 409 提示重载 |
| 服务端 | SDK 客户端按 envId 缓存 | 凭证 / 环境 ID 变更时 `invalidateClient` 失效重建，避免沿用旧密钥实例 |
| 前端 | 临时 URL 缓存（TTL 1.8h） | 链接 2h 有效，提前 10% 失效；切环境 `clearUrlCache` 全清 |
| 前端 | 请求序号（`dbSeq` / `stUrlSeq` / `ovSeq`） | 快速翻页 / 切环境 / 切目录时，在途旧响应按序号丢弃，不覆盖新数据 |
| 前端 | 删除批次语义 | 批量删除按 50/批串行；单批失败不整批回滚，失败文件保持选中可重试 |

## 常见问题

**Q: 顶栏环境下拉里没有我想要的云环境？**
打开左侧「环境配置」页 →「新增环境」，填入环境 ID 与该环境的腾讯云凭证即可，保存即时生效，无需重启。

**Q: 页面显示「未配置凭证」？**
到「环境配置」页点该环境行的「编辑」，补全 SecretId / SecretKey 后保存（也可在模态框里先点「测试连通性」验证）。

**Q: 换机器 / 想重置环境列表？**
删除 `config/environments.json` 后重启服务，再在「环境配置」页逐个新增即可。

**Q: 集合列表只看到几个内置示例集合？**
这是 `listCollections` 接口失败时的兜底名单（`KNOWN_COLLECTIONS`）。请到「环境配置」页点「测试」确认凭证能否访问该环境，或启动时用 `KNOWN_COLLECTIONS` 环境变量配置你自己的集合名单。

**Q: 概览数据是实时的吗？**
概览走服务端 60s TTL 缓存（各集合 count + 存储采样是较重操作），同一环境 60s 内重复进入直接复用（页面标注「缓存数据」）；点「刷新」按钮带 `fresh=1` 强制重算。

**Q: 图片预览失效？**临时 URL 有效期 2 小时，刷新页面重新获取即可。

**Q: 保存文档时提示「文档已被其他修改覆盖」？**
这是乐观锁并发保护（`etag`）：打开文档到保存之间，该文档被别处改过（指纹不一致）→ 返回 409。按提示重新打开文档、核对差异后再保存即可，避免静默覆盖他人修改。

## 许可

内部运维工具，请勿外泄 `config/environments.json` 中的腾讯云密钥。
