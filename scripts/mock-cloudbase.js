/* 内存版 CloudBase Mock：MOCK_CLOUDBASE=1 时由 server.js 注入，替代 node-sdk / manager-node。
   零网络、零凭证，用于 smoke / e2e 冒烟测试。状态按 envId 隔离（_states）。
   仅实现 server.js 用到的 API 面：
     client = { database(), uploadFile() }
     manager = {
       database: { listCollections, describeCollection, updateCollection },
       storage:  { listCurrentDirectory, listDirectoryFiles, getTemporaryUrl,
                  deleteFile, getStorageAcl, setStorageAcl },
       functions:{ getFunctionList, getFunctionDetail, updateFunctionConfig,
                   invokeFunction, deleteFunction, createFunctionTriggers, deleteFunctionTrigger },
       commonService(service, version) -> { call({ Action, Param }) }
         // DescribeSafeRule / ModifySafeRule / ListTriggers（裸 OpenAPI 透传）
     } */
'use strict';

const _states = new Map(); // envId -> { collections: { name: [docs] }, storage: Map<cloudPath, {buffer, size}> }

function state(envId) {
  let s = _states.get(envId);
  if (!s) {
    s = {
      collections: {
        demo: [
          { _id: 'demo1', name: 'Alice', createdAt: '2024-01-01T00:00:00Z', n: 1 },
          { _id: 'demo2', name: 'Bob', createdAt: '2024-02-01T00:00:00Z', n: 2 },
          { _id: 'demo3', name: 'Charlie', createdAt: '2024-03-01T00:00:00Z', n: 3 }
        ]
      },
      storage: new Map(),
      indexes: {}, // colName -> [{ name, unique, keys:[{Name,Direction}], accesses }]
      safeRule: {}, // colName -> { acl, rule }
      storageAcl: { acl: 'READONLY', rule: null },
      functions: {
        hello: {
          info: {
            FunctionName: 'hello', Runtime: 'Nodejs16.13', Handler: 'index.main',
            Timeout: 3, MemorySize: 256, Role: 'cos-roles/cos-full-access',
            Description: 'mock hello', Namespace: '', Status: 'Active',
            AddTime: '2024-01-01T00:00:00Z', ModTime: '2024-01-02T00:00:00Z',
            EnvironmentVariables: { FOO: 'bar' }
          },
          triggers: [{ name: 'timer-hello', type: 'timer', config: '0 0 * * * *' }]
        }
      }
    };
    s.storage.set('avatars/a.png', { buf: Buffer.from('a'), size: 1 });
    s.storage.set('docs/readme.txt', { buf: Buffer.from('readme'), size: 6 });
    _states.set(envId, s);
  }
  return s;
}

function buildQuery(docs) {
  const q = {
    _docs: docs.slice(),
    where(f) {
      q._docs = q._docs.filter((d) => Object.keys(f).every((k) => {
        const v = f[k];
        const val = d[k];
        if (v instanceof RegExp) {
          if (val == null) return false;
          return v.test(val === '' ? '' : String(val));
        }
        return val == v || val === v;
      }));
      return q;
    },
    orderBy(k, dir) {
      q._docs.sort((a, b) => {
        const x = a[k], y = b[k];
        if (x === y) return 0;
        const r = x < y ? -1 : 1;
        return dir === 'desc' ? -r : r;
      });
      return q;
    },
    skip(n) { q._docs = q._docs.slice(n || 0); return q; },
    limit(n) { q._docs = q._docs.slice(0, n || 20); return q; },
    count: async () => ({ total: q._docs.length }),
    get: async () => ({ data: q._docs.slice() })
  };
  return q;
}

function client(envId) {
  const s = state(envId);
  const dbApi = {
    collection(name) {
      const arr = () => (s.collections[name] = s.collections[name] || []);
      const q = buildQuery(arr());
      // 链式末端还须支持 add / doc(id)（server 的 POST /api/collection、GET/PUT/DELETE /api/doc 依赖）
      q.add = async (d) => {
        const doc = Object.assign({ _id: 'id' + Math.random().toString(36).slice(2, 10) }, d);
        arr().push(doc);
        return { _id: doc._id };
      };
      q.doc = (id) => ({
        get: async () => {
          const d = arr().find((x) => x._id === id);
          return { record: d || null };
        },
        set: async (d) => {
          const i = arr().findIndex((x) => x._id === id);
          const doc = Object.assign({ _id: id }, d);
          if (i >= 0) arr()[i] = doc; else arr().push(doc);
          return { _id: id };
        },
        remove: async () => {
          const a = arr();
          const i = a.findIndex((x) => x._id === id);
          if (i >= 0) a.splice(i, 1);
          return { deleted: 1 };
        }
      });
      return q;
    },
    RegExp(o) { return new RegExp(o.regexp, o.options || ''); }
  };
  return {
    database: () => dbApi,
    uploadFile: async ({ cloudPath, fileContent }) => {
      s.storage.set(cloudPath, { buf: Buffer.from(fileContent || ''), size: Buffer.byteLength(fileContent || '') });
      return { fileID: 'cloud://mock.' + envId + '/' + cloudPath };
    }
  };
}

function listLevel(prefix, s) {
  const p = prefix && !prefix.endsWith('/') ? prefix + '/' : prefix;
  const dirs = new Set();
  const files = [];
  for (const key of s.storage.keys()) {
    if (!key.startsWith(p)) continue;
    const rest = key.slice(p.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) dirs.add(p + rest.slice(0, slash + 1));
    else files.push({ Key: key, Size: s.storage.get(key).size, LastModified: '' });
  }
  return {
    directories: Array.from(dirs).sort(),
    files: files.sort((a, b) => (a.Key < b.Key ? -1 : 1))
  };
}

function manager(envId) {
  const s = state(envId);
  return {
    database: {
      listCollections: async () => ({
        Collections: Object.keys(s.collections).map((n) => ({ CollectionName: n }))
      }),
      describeCollection: async (name) => {
        const stored = s.indexes[name] || [];
        const all = [
          { Name: '_id_', Unique: true, Keys: [{ Name: '_id', Direction: '1' }], Accesses: { Ops: 0, Since: '' } }
        ].concat(stored);
        return { Indexes: all, IndexNum: all.length };
      },
      updateCollection: async (name, arg) => {
        const list = (s.indexes[name] = s.indexes[name] || []);
        if (arg && arg.CreateIndexes) {
          for (const c of arg.CreateIndexes) {
            const keys = ((c.MgoKeySchema && c.MgoKeySchema.MgoIndexKeys) || []).map((k) => ({
              Name: k.Name, Direction: String(k.Direction)
            }));
            list.push({
              Name: c.IndexName,
              Unique: !!(c.MgoKeySchema && c.MgoKeySchema.MgoIsUnique),
              Keys: keys,
              Accesses: { Ops: 0, Since: '' }
            });
          }
        }
        if (arg && arg.DropIndexes) {
          s.indexes[name] = list.filter((x) => x.Name !== arg.DropIndexes[0].IndexName);
        }
        return { ok: true };
      }
    },
    storage: {
      listCurrentDirectory: async (prefix) => listLevel(prefix, s),
      listDirectoryFiles: async (prefix, cap) => {
        const p = prefix && !prefix.endsWith('/') ? prefix + '/' : prefix;
        const out = [];
        for (const [key, v] of s.storage) {
          if (key.startsWith(p)) out.push({ Key: key, Size: v.size, LastModified: '' });
          if (out.length >= (cap || 2000)) break;
        }
        return { Files: out };
      },
      getTemporaryUrl: async (list) => list.map((it) => ({
        fileId: 'cloud://mock.' + envId + '/' + it.cloudPath,
        url: 'https://mock.local/' + it.cloudPath
      })),
      deleteFile: async (list) => {
        for (const it of list) s.storage.delete(typeof it === 'string' ? it : it && it.cloudPath);
        return { ok: true };
      },
      getStorageAcl: async (opt) =>
        opt && opt.withRule ? { acl: s.storageAcl.acl, rule: s.storageAcl.rule } : s.storageAcl.acl,
      setStorageAcl: async (acl, rule) => {
        s.storageAcl = { acl, rule };
        return { RequestId: 'mock' };
      }
    },
    functions: {
      getFunctionList: async () => ({
        Functions: Object.keys(s.functions).map((n) => ({ FunctionName: n })),
        TotalCount: Object.keys(s.functions).length
      }),
      getFunctionDetail: async (name) => {
        const f = s.functions[name];
        if (!f) throw new Error('function not found: ' + name);
        return Object.assign({}, f.info);
      },
      updateFunctionConfig: async (cfg) => {
        const f = s.functions[cfg.name];
        if (!f) throw new Error('function not found: ' + cfg.name);
        if (cfg.timeout != null) f.info.Timeout = cfg.timeout;
        if (cfg.memorySize != null) f.info.MemorySize = cfg.memorySize;
        if (cfg.envVariables) {
          const obj = {};
          if (Array.isArray(cfg.envVariables)) cfg.envVariables.forEach((v) => { obj[v.key] = v.value; });
          else Object.assign(obj, cfg.envVariables);
          f.info.EnvironmentVariables = obj;
        }
        f.info.ModTime = new Date().toISOString();
        return { ok: true };
      },
      invokeFunction: async (name, params) => {
        const f = s.functions[name];
        if (!f) throw new Error('function not found: ' + name);
        return {
          RequestId: 'mock', Log: '[mock] invoked ' + name, RetMsg: 'OK', ErrMsg: 'OK',
          Duration: 5, InvokeResult: JSON.stringify({ ok: true, echo: params || {} })
        };
      },
      deleteFunction: async (name) => { delete s.functions[name]; return { ok: true }; },
      createFunctionTriggers: async (name, triggers) => {
        const f = s.functions[name];
        if (!f) throw new Error('function not found: ' + name);
        for (const t of triggers) f.triggers.push({ name: t.name, type: t.type, config: t.config });
        return { ok: true };
      },
      deleteFunctionTrigger: async (name, tname) => {
        const f = s.functions[name];
        if (!f) throw new Error('function not found: ' + name);
        f.triggers = f.triggers.filter((t) => t.name !== tname);
        return { ok: true };
      }
    },
    commonService: () => ({
      call: async ({ Action, Param }) => {
        switch (Action) {
          case 'DescribeSafeRule': {
            const r = s.safeRule[Param.CollectionName];
            return { AclTag: (r && r.acl) || 'READONLY', Rule: (r && r.rule) || '' };
          }
          case 'ModifySafeRule': {
            s.safeRule[Param.CollectionName] = { acl: Param.AclTag, rule: Param.Rule || '' };
            return { RequestId: 'mock' };
          }
          case 'ListTriggers': {
            const f = s.functions[Param.Name];
            return { Triggers: f ? f.triggers : [] };
          }
          default:
            return { RequestId: 'mock' };
        }
      }
    })
  };
}

module.exports = { client, manager };
