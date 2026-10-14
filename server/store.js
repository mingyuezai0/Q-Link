import fs from 'node:fs';
import path from 'node:path';

/**
 * 深合并：以 defaults 为骨架，把已存盘的值盖上去。
 *
 * 必须是深合并而不是浅合并 —— 否则给已有的嵌套对象（比如 config.reply）新增一个字段时，
 * 老用户磁盘上的 reply 对象会整个覆盖掉默认值，新字段就永远拿不到，
 * 表现为"新加的功能开关在已装好的实例上不存在"。
 */
function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base === null || typeof base !== 'object') {
    return override === undefined ? base : override;
  }
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = deepMerge(base[key], value);
  }
  return out;
}

/**
 * 极简 JSON 文档存储：内存缓存 + 原子落盘。
 * 单机控制台的读写量很小，同步写入足够可靠且便于保证一致性。
 */
class Doc {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = null;
    this.load();
  }

  load() {
    try {
      // 剥掉可能的 UTF-8 BOM，否则 JSON.parse 会失败并把用户数据当成空文件
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      this.data = Array.isArray(this.defaults)
        ? (Array.isArray(parsed) ? parsed : structuredClone(this.defaults))
        : deepMerge(structuredClone(this.defaults), parsed);
    } catch {
      this.data = structuredClone(this.defaults);
      this.persist();
    }
    return this.data;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get() {
    return this.data;
  }

  /** 浅合并写入（仅对象文档） */
  patch(patchObj) {
    this.data = { ...this.data, ...patchObj };
    this.persist();
    return this.data;
  }

  replace(next) {
    this.data = next;
    this.persist();
    return this.data;
  }
}

/** 数组型集合，元素均为带 id 的对象 */
class Collection extends Doc {
  constructor(file, defaults = []) {
    super(file, defaults);
    if (!Array.isArray(this.data)) this.data = [];
  }

  list() {
    return this.data;
  }

  find(id) {
    return this.data.find((item) => item.id === id) || null;
  }

  add(item) {
    this.data.unshift(item);
    this.persist();
    return item;
  }

  update(id, patchObj) {
    const idx = this.data.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    this.data[idx] = { ...this.data[idx], ...patchObj, id, updatedAt: Date.now() };
    this.persist();
    return this.data[idx];
  }

  remove(id) {
    const before = this.data.length;
    this.data = this.data.filter((item) => item.id !== id);
    if (this.data.length !== before) this.persist();
    return before !== this.data.length;
  }

  /** 用一个新数组整体替换（用于排序 / 批量导入） */
  replaceAll(items) {
    this.data = Array.isArray(items) ? items : [];
    this.persist();
    return this.data;
  }
}

export { Doc, Collection };
