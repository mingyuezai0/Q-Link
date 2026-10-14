import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

/**
 * 数据目录默认是项目下的 data/。
 * 设置 QQBOT_DATA_DIR 可以指向别处，便于隔离测试或同时跑多套配置。
 */
export const DATA_DIR = process.env.QQBOT_DATA_DIR
  ? path.resolve(process.env.QQBOT_DATA_DIR)
  : path.join(ROOT, 'data');

/** 每个机器人一套独立配置放在这里：data/bots/<botId>/ */
export const BOTS_DIR = path.join(DATA_DIR, 'bots');

/** 上传的图片（头像、表情包）按 uid 命名，全局共享一份，避免切换机器人时路径失效 */
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
