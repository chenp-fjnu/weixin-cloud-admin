/**
 * admin 云函数 —— 微信云环境管理（服务端）
 *
 * 设计要点：
 *  - 密钥零下发：所有腾讯云 SecretId / SecretKey 只存在于「云函数环境变量」，
 *    小程序端永远拿不到；小程序只调 wx.cloud.callFunction({ name: 'admin' })。
 *  - 多环境凭证：从环境变量播种（与本地 server.js 的 .env 命名一致，可直接照抄）：
 *      TCB_ENV_IDS          逗号分隔的云环境列表；为空则回落 TCB_ENV_ID
 *      TCB_ENV_ID           默认环境 ID（也是列表首个缺省项）
 *      TCB_SECRET_ID / TCB_SECRET_KEY          第 1 个环境的凭证
 *      TCB_SECRET_ID_N / TCB_SECRET_KEY_N      第 N 个环境的独立凭证（跨账号，N 为位置序号）
 *  - 集合名 / 分页 / 排序 / 正则 / 上传大小 全部做边界钳制，防注入与慢查。
 *  - 能力对齐本地 server.js：
 *      数据库：collections / collection(分页) / docGet / docAdd / docSet / docRemove
 *      存储：  storage / storageUrls / storageDelete / storageUpload / walk
 *      其它：  environments（脱敏列表） / overview / status
 */
'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ============ 多环境注册表（环境变量播种） ============
const ENV_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const COLLECTION_RE = /^[a-zA-Z0-9_-]+$/;

function seedEnvs() {
    let ids = (process.env.TCB_ENV_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const defId = (process.env.TCB_ENV_ID || '').trim();
    if (defId && !ids.includes(defId)) ids.unshift(defId);
    const baseId = process.env.TCB_SECRET_ID || '';
    const baseKey = process.env.TCB_SECRET_KEY || '';
    const list = ids.map((id, idx) => ({
        envId: id,
        secretId: (idx > 0 && process.env['TCB_SECRET_ID_' + (idx + 1)]) || baseId,
        secretKey: (idx > 0 && process.env['TCB_SECRET_KEY_' + (idx + 1)]) || baseKey
    }));
    const defaultId = defId || (list.length ? list[0].envId : '');
    return { list, defaultId };
}

const ENVIRONMENTS = seedEnvs();
const envIndex = id => ENVIRONMENTS.list.findIndex(e => e.envId === id);
const envById = id => (envIndex(id) >= 0 ? ENVIRONMENTS.list[envIndex(id)] : null);
const defaultEnvId = () => ENVIRONMENTS.defaultId || (ENVIRONMENTS.list.length ? ENVIRONMENTS.list[0].envId : '');
const secretsFor = id => (envById(id) ? { id: envById(id).secretId, key: envById(id).secretKey } : { id: '', key: '' });

// 兜底集合名单（listCollections 失败时用）
const KNOWN_COLLECTIONS = (process.env.KNOWN_COLLECTIONS ||
    'wardrobe_items,wardrobe_user_profiles,wardrobe_app_config,wardrobe_circles,' +
    'wardrobe_circle_items,wardrobe_circle_outfits,wardrobe_reports'
).split(',').map(s => s.trim()).filter(Boolean);

function AppError(msg, code) {
    const e = new Error(msg);
    e.name = 'AppError';
    e.code = code || 'APP';
    return e;
}

// ============ 客户端（按 envId 惰性构造并缓存） ============
const _clients = new Map();
function requireSdk(mod) {
    try { return require(mod); }
    catch (e) { throw new AppError('云函数未安装依赖 ' + mod + '：请先在 IDE 中「上传并部署」admin 云函数', 'SDK_MISSING'); }
}
function assertSecrets(envId) {
    const s = secretsFor(envId);
    if (!s.id || !s.key) {
        throw new AppError('环境 ' + envId + ' 未配置凭证：请为该环境配置腾讯云 SecretId / SecretKey（云函数环境变量）', 'NO_SECRETS');
    }
    return s;
}
function getClient(envId) {
    assertSecrets(envId);
    let c = _clients.get(envId);
    if (!c) {
        const tcb = requireSdk('@cloudbase/node-sdk');
        c = { tcb: tcb.init({ secretId: secretsFor(envId).id, secretKey: secretsFor(envId).key, env: envId }), manager: null };
        _clients.set(envId, c);
    }
    return c;
}
function getManager(envId) {
    const c = getClient(envId);
    if (!c.manager) {
        const s = secretsFor(envId);
        const M = requireSdk('@cloudbase/manager-node');
        const Ctor = M.default || M;
        c.manager = new Ctor({ secretId: s.id, secretKey: s.key, envId });
    }
    return c.manager;
}
function db(envId) { return getClient(envId).tcb.database(); }

// 解析目标环境（缺省=默认环境；未知环境报错）
function resolveEnv(params) {
    const id = ((params && params.env) || '').trim() || defaultEnvId();
    if (!id || !envById(id)) {
        throw new AppError(
            ENVIRONMENTS.list.length
                ? ('未知云环境：' + id + '（可选：' + ENVIRONMENTS.list.map(e => e.envId).join(' / ') + '）')
                : '云函数尚未配置任何云环境：请设置环境变量 TCB_ENV_ID + TCB_SECRET_ID / TCB_SECRET_KEY 后重新部署',
            'BAD_ENV'
        );
    }
    return id;
}

// ============ 脱敏 ============
function maskSecret(s) {
    s = s || '';
    if (!s) return '';
    if (s.length <= 10) return s.slice(0, 2) + '…';
    return s.slice(0, 6) + '…' + s.slice(-4);
}

// ============ 数据库操作 ============
async function collectionCount(envId, name, filter) {
    let c = db(envId).collection(name);
    if (filter) c = c.where(filter);
    const r = await c.count();
    return r.total != null ? r.total : 0;
}
async function collectionQuery(envId, name, { skip, limit, sort, sortDir, filter }) {
    let c = db(envId).collection(name);
    if (filter) c = c.where(filter);
    if (sort) c = c.orderBy(sort, sortDir === 'desc' ? 'desc' : 'asc');
    const r = await c.skip(skip || 0).limit(limit || 20).get();
    return (r && r.data) || [];
}
function buildFilter(envId, { field, q }) {
    field = (field || '').trim();
    q = (q || '').trim();
    if (!field || !q) return null;
    if (q.length > 200) throw new AppError('筛选正则过长（上限 200 字符）', 'BADREGEX');
    if (!/^[a-zA-Z0-9_.]+$/.test(field)) throw new AppError('筛选字段名非法：' + field, 'BADREGEX');
    try { return { [field]: db(envId).RegExp({ regexp: q, options: 'i' }) }; }
    catch (e) { throw new AppError('筛选正则非法：' + (e.message || e), 'BADREGEX'); }
}
async function listCollectionNames(envId) {
    try {
        const m = getManager(envId);
        const res = await m.database.listCollections({ MgoLimit: 100 });
        const arr = (res && res.Collections) || [];
        const names = arr.map(x => x.CollectionName || x.TableName || x.Name).filter(Boolean);
        if (names.length) return names;
    } catch (e) { /* 兜底 */ }
    return KNOWN_COLLECTIONS;
}

// ============ 存储操作 ============
function normFile(f) {
    if (!f) return null;
    const name = f.Key || f.key || f.name || f.cloudPath || '';
    return {
        name,
        size: f.Size != null ? Number(f.Size) : (f.size != null ? Number(f.size) : 0),
        lastModified: f.LastModified || f.lastModified || f.time || '',
        etag: f.ETag || f.etag || ''
    };
}
async function storageListOneLevel(prefix, envId) {
    const m = getManager(envId);
    let res;
    try { res = await m.storage.listCurrentDirectory(prefix); }
    catch (e) { throw new AppError('云存储列举失败：' + (e.message || e), 'STORAGE'); }
    const files = (res && res.files || []).map(normFile).filter(Boolean).sort((a, b) => (a.name < b.name ? -1 : 1));
    const prefixes = (res && res.directories || [])
        .map(d => { let dp = d || ''; if (dp && !dp.endsWith('/')) dp += '/'; return dp; })
        .filter(Boolean).sort();
    return { files, prefixes };
}
async function storageWalk(prefix, maxFiles, envId) {
    const cap = Math.min(maxFiles || 2000, 5000);
    const m = getManager(envId);
    let raw;
    try { raw = await m.storage.listDirectoryFiles(prefix, cap); }
    catch (e) { throw new AppError('云存储扫描失败：' + (e.message || e), 'STORAGE'); }
    if (raw && raw.Files) raw = raw.Files;
    if (!Array.isArray(raw)) raw = raw || [];
    let p = prefix || '';
    if (p && !p.endsWith('/')) p += '/';
    const out = [];
    const seen = new Set();
    for (const f of raw) {
        const nf = normFile(f);
        if (nf && nf.name && nf.name !== p && !nf.name.endsWith('/') && !seen.has(nf.name)) {
            seen.add(nf.name); out.push(nf);
        }
    }
    return out.slice(0, cap);
}
async function storageTempUrls(cloudPaths, envId) {
    const m = getManager(envId);
    const list = cloudPaths.slice(0, 50).map(p => ({ cloudPath: p, maxAge: 7200 }));
    let res;
    try { res = await m.storage.getTemporaryUrl(list); }
    catch (e) { throw new AppError('获取临时链接失败：' + (e.message || e), 'STORAGE'); }
    const out = {};
    const arr = Array.isArray(res) ? res : (res && res.data) || [];
    arr.forEach(f => {
        const url = f && (f.url || f.URL);
        const rawId = f && (f.fileId || f.fileID || '');
        if (!url || !rawId) return;
        out[rawId] = url;
        const rel = rawId.replace(/^cloud:\/\/[^/]+\//i, '');
        if (rel) out[rel] = url;
    });
    return out;
}
async function storageDelete(cloudPaths, envId) {
    const m = getManager(envId);
    const list = Array.from(new Set(cloudPaths));
    if (!list.length) return { deleted: 0 };
    try { await m.storage.deleteFile(list); }
    catch (e) { throw new AppError('删除云文件失败：' + (e.message || e), 'STORAGE'); }
    return { deleted: list.length };
}
async function storageUpload(cloudPath, buffer, envId) {
    const app = getClient(envId);
    const r = await app.uploadFile({ cloudPath, fileContent: buffer });
    return { fileID: (r && r.fileID) || '' };
}

// ============ action 处理器 ============
const handlers = {
    // 环境列表（脱敏）
    async environments() {
        return {
            defaultEnvId: defaultEnvId(),
            envs: ENVIRONMENTS.list.map(e => ({
                envId: e.envId,
                isDefault: e.envId === defaultEnvId(),
                hasSecrets: !!(e.secretId && e.secretKey),
                secretIdMasked: maskSecret(e.secretId),
                secretKeySet: !!e.secretKey
            }))
        };
    },

    // 凭证就绪状态
    async status() {
        const envs = ENVIRONMENTS.list.map(envId => {
            const credsOk = !!(secretsFor(envId).id && secretsFor(envId).key);
            let ok = false, message = '';
            if (credsOk) { try { getClient(envId); ok = true; } catch (e) { message = e.message; } }
            return { envId, hasSecrets: credsOk, ok, message };
        });
        return { defaultEnvId: defaultEnvId(), envs, count: ENVIRONMENTS.list.length };
    },

    // 概览：各集合文档数 + 存储统计
    async overview(params) {
        const envId = resolveEnv(params);
        const allNames = await listCollectionNames(envId);
        const counts = {};
        const details = [];
        await Promise.all(allNames.map(async name => {
            try { counts[name] = await collectionCount(envId, name, null); }
            catch (e) { counts[name] = 'ERR'; details.push(name + ': ' + e.message); }
        }));
        let storage = { topDirs: 0, totalFiles: -1, totalSize: 0, truncated: false, error: '' };
        try {
            const walk = await storageWalk('', 5000, envId);
            const dirSet = new Set();
            let size = 0;
            for (const f of walk) {
                const first = f.name.split('/')[0];
                if (first) dirSet.add(first);
                size += f.size || 0;
            }
            storage = { topDirs: dirSet.size, totalFiles: walk.length, totalSize: size, truncated: walk.length >= 5000, error: '' };
        } catch (e) { storage.error = e.message; }
        return { envId, counts, details, storage };
    },

    // 集合名列表
    async collections(params) {
        const envId = resolveEnv(params);
        return { collections: await listCollectionNames(envId) };
    },

    // 集合文档分页查询
    async collection(params) {
        const envId = resolveEnv(params);
        const name = (params.name || '').trim();
        if (!COLLECTION_RE.test(name)) throw new AppError('集合名非法', 'BAD_NAME');
        const page = Math.max(1, parseInt(params.page || '1', 10));
        const size = Math.min(200, Math.max(1, parseInt(params.size || '20', 10)));
        const sort = (params.sort || '').trim();
        const sortDir = (params.sortDir || 'asc').trim();
        const filter = buildFilter(envId, params);
        const total = await collectionCount(envId, name, filter);
        const docs = await collectionQuery(envId, name, { skip: (page - 1) * size, limit: size, sort, sortDir, filter });
        return { name, total, page, size, docs, hasMore: page * size < total };
    },

    // 读取单条文档
    async docGet(params) {
        const envId = resolveEnv(params);
        const name = (params.name || '').trim();
        const id = (params.id || '').trim();
        if (!COLLECTION_RE.test(name)) throw new AppError('集合名非法', 'BAD_NAME');
        if (!id) throw new AppError('缺少文档 _id', 'BAD_ARG');
        const r = await db(envId).collection(name).doc(id).get();
        const doc = (r && (r.data || r.record)) || null;
        return { doc: Array.isArray(doc) ? (doc[0] || null) : doc };
    },

    // 新增文档
    async docAdd(params) {
        const envId = resolveEnv(params);
        const name = (params.name || '').trim();
        if (!COLLECTION_RE.test(name)) throw new AppError('集合名非法', 'BAD_NAME');
        if (!params.doc || typeof params.doc !== 'object' || Array.isArray(params.doc)) throw new AppError('doc 须为 JSON 对象', 'BAD_ARG');
        const doc = Object.assign({}, params.doc);
        delete doc._id;
        const r = await db(envId).collection(name).add(doc);
        return { id: (r && (r._id || r.id)) || '' };
    },

    // 更新文档（整包替换 set）
    async docSet(params) {
        const envId = resolveEnv(params);
        const name = (params.name || '').trim();
        const id = (params.id || '').trim();
        if (!COLLECTION_RE.test(name)) throw new AppError('集合名非法', 'BAD_NAME');
        if (!id) throw new AppError('缺少文档 _id', 'BAD_ARG');
        if (!params.doc || typeof params.doc !== 'object' || Array.isArray(params.doc)) throw new AppError('doc 须为 JSON 对象', 'BAD_ARG');
        const doc = Object.assign({}, params.doc);
        delete doc._id;
        await db(envId).collection(name).doc(id).set(doc);
        return { ok: true };
    },

    // 删除文档
    async docRemove(params) {
        const envId = resolveEnv(params);
        const name = (params.name || '').trim();
        const id = (params.id || '').trim();
        if (!COLLECTION_RE.test(name)) throw new AppError('集合名非法', 'BAD_NAME');
        if (!id) throw new AppError('缺少文档 _id', 'BAD_ARG');
        await db(envId).collection(name).doc(id).remove();
        return { ok: true };
    },

    // 存储：列举某前缀下一级（子目录 + 文件）
    async storage(params) {
        const envId = resolveEnv(params);
        const prefix = (params.prefix || '').trim();
        return Object.assign({ prefix }, await storageListOneLevel(prefix, envId));
    },

    // 批量临时 URL
    async storageUrls(params) {
        const envId = resolveEnv(params);
        const fileIDs = Array.isArray(params.fileIDs) ? params.fileIDs : String(params.fileIDs || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!fileIDs.length) throw new AppError('缺少 fileIDs', 'BAD_ARG');
        return { urls: await storageTempUrls(fileIDs, envId) };
    },

    // 批量删除文件
    async storageDelete(params) {
        const envId = resolveEnv(params);
        const fileIDs = Array.isArray(params.fileIDs) ? params.fileIDs : [];
        if (!fileIDs.length) throw new AppError('缺少 fileIDs', 'BAD_ARG');
        return await storageDelete(fileIDs, envId);
    },

    // 上传文件（base64 内容，受云函数请求体大小限制）
    async storageUpload(params) {
        const envId = resolveEnv(params);
        const cloudPath = (params.cloudPath || '').trim();
        if (!cloudPath) throw new AppError('缺少 cloudPath', 'BAD_ARG');
        const content = params.content || '';
        if (!content) throw new AppError('文件内容为空', 'BAD_ARG');
        const limit = parseInt(process.env.ADMIN_UPLOAD_LIMIT || String(20 * 1024 * 1024), 10);
        const buf = Buffer.from(content, 'base64');
        if (buf.length > limit) throw new AppError('文件超过上传上限（' + (limit / 1024 / 1024) + 'MB）。云函数走 base64 有大小限制，大文件请走本地 server.js', 'TOO_LARGE');
        return await storageUpload(cloudPath, buf, envId);
    },

    // 递归扫描（概览 / 子目录聚合用）
    async walk(params) {
        const envId = resolveEnv(params);
        const prefix = (params.prefix || '').trim();
        const maxFiles = Math.min(5000, Math.max(1, parseInt(params.max || '2000', 10)));
        const files = await storageWalk(prefix, maxFiles, envId);
        return { prefix, count: files.length, files };
    }
};

// ============ 入口 ============
exports.main = async (event) => {
    const action = (event && event.action) || '';
    const handler = handlers[action];
    if (!handler) return { ok: false, code: 'NO_HANDLER', error: '未知 action：' + action + '（可用：' + Object.keys(handlers).join(', ') + '）' };
    try {
        const data = await handler(event || {});
        return { ok: true, data };
    } catch (e) {
        return {
            ok: false,
            code: (e && e.code) || (e && e.name === 'AppError' ? 'APP' : 'ERROR'),
            error: (e && e.message) || 'internal error'
        };
    }
};
