/* 内存版 CloudBase Mock：MOCK_CLOUDBASE=1 时由 server.js 注入，替代 node-sdk / manager-node。
   零网络、零凭证，用于 smoke / e2e 冒烟测试。状态按 envId 隔离（_states）。
   仅实现 server.js 用到的 API 面：
     tcb = { database(), uploadFile() }
     manager = { database: { listCollections }, storage: { listCurrentDirectory,
               listDirectoryFiles, getTemporaryUrl, deleteFile } } */
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
      storage: new Map()
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
      })
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
      }
    }
  };
}

module.exports = { client, manager };
