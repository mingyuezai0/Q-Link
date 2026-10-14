/* 极简 DOM 助手 —— 无构建步骤，因此不引入任何框架。 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * 这些标签必须用 createElementNS 创建。
 * 用 document.createElement('svg') 得到的是 HTMLUnknownElement，
 * 里面的 rect/path/text 全成了普通未知元素，图标会退化成一行文字。
 */
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient',
  'stop', 'mask', 'clipPath', 'pattern', 'filter',
]);

export function el(tag, props = {}, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (isSvg) {
      // SVG 元素没有 className/textContent 这类 HTML 专有属性，统一走 setAttribute
      node.setAttribute(key === 'className' ? 'class' : key, String(value));
    } else if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list' && typeof value !== 'object') node[key] = value;
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/* ------------------------------------------------------------------ 图标 */

const ICONS = {
  home: 'M2.5 7.2 8 2.8l5.5 4.4V13a.9.9 0 0 1-.9.9h-3v-3.6H6.4v3.6h-3A.9.9 0 0 1 2.5 13Z',
  plug: 'M6 2v3M10 2v3M4 5h8v2.2A4.8 4.8 0 0 1 7.2 12h-1.4A4.8 4.8 0 0 1 4 7.2ZM8 12v2',
  user: 'M8 8.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3.2 13.6c.5-2.2 2.5-3.6 4.8-3.6s4.3 1.4 4.8 3.6',
  brain: 'M8 3.2a2.3 2.3 0 0 0-2.3 2.3A2 2 0 0 0 4 7.4a2 2 0 0 0 .6 1.5A2.1 2.1 0 0 0 5 12a2 2 0 0 0 3 1.7 2 2 0 0 0 3-1.7 2.1 2.1 0 0 0 .4-3.1A2 2 0 0 0 12 7.4a2 2 0 0 0-1.7-1.9A2.3 2.3 0 0 0 8 3.2Z',
  key: 'M9.4 3.2a3.4 3.4 0 1 1-1.2 6.6L7 11H5.6l-.5 1.6H3.4l-.3 1.2H1.6V11.4L6 7.1a3.4 3.4 0 0 1 3.4-3.9Zm1.4 2.2h.6',
  shield: 'M8 2.2 12.6 4v4c0 3-1.9 5.1-4.6 5.8C5.3 13.1 3.4 11 3.4 8V4Z',
  ban: 'M8 14.4A6.4 6.4 0 1 0 8 1.6a6.4 6.4 0 0 0 0 12.8ZM3.9 3.9l8.2 8.2',
  image: 'M2.6 3.6h10.8v8.8H2.6Zm0 6.2 3-2.8 2.6 2.4 1.8-1.6 3.4 3',
  spark: 'M8 2.2 9.4 6l3.8 1.4L9.4 8.8 8 12.6 6.6 8.8 2.8 7.4 6.6 6ZM12.6 2v2M13.6 3h-2',
  cpu: 'M5.4 5.4h5.2v5.2H5.4Zm-2 2h2m-2 1.2h2M2 10.6h2M12.6 7.4h2m-2 1.2h2m-2 1.2h2M7.4 3.4V2m1.2 2V2m1.2 2V2M2.6 2.6h10.8v10.8H2.6Z',
  list: 'M5.6 4.4h8M5.6 8h8M5.6 11.6h8M2.6 4.4h.01M2.6 8h.01M2.6 11.6h.01',
  send: 'M14 2 7 9M14 2l-4.4 12-2.6-5L2 6.4Z',
  plus: 'M8 3.4v9.2M3.4 8h9.2',
  save: 'M3 3h7.6L13 5.4V13H3Zm2.4 0v3.4h4.2V3M5.4 13V9.6h5.2V13',
  trash: 'M3 4.4h10M6.4 4.4V2.8h3.2v1.6M4.4 4.4 5 13h6l.6-8.6M6.6 6.8v4M9.4 6.8v4',
  play: 'M4.6 2.8 12.4 8l-7.8 5.2Z',
  stop: 'M4.4 4.4h7.2v7.2H4.4Z',
  refresh: 'M13.5 8A5.5 5.5 0 1 1 11.8 4M13.6 2.4v3.4h-3.4',
  search: 'M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6ZM10.8 10.8 14 14',
  check: 'M3 8.4 6.4 11.8 13 5.2',
  alert: 'M8 2.6 14.6 13.4H1.4ZM8 6.4v3.2M8 11.4h.01',
  info: 'M8 14.4A6.4 6.4 0 1 0 8 1.6a6.4 6.4 0 0 0 0 12.8ZM8 7.2v4M8 4.8h.01',
  x: 'M4 4l8 8M12 4l-8 8',
  upload: 'M8 11V3M4.6 6.4 8 3l3.4 3.4M2.8 12.4h10.4',
  chevron: 'M6 4l4 4-4 4',
  qr: 'M2.6 2.6h4.2v4.2H2.6Zm6.6 0h4.2v4.2H9.2ZM2.6 9.2h4.2v4.2H2.6Zm6.6 1.4h1.6v1.6H9.2Zm2.6 0h1.6v1.6h-1.6Zm-2.6 2.6h1.6v1.6H9.2Zm2.6 0h1.6v1.6h-1.6Z',
  book: 'M3 2.6h6.4a2.4 2.4 0 0 1 2.4 2.4v8.4H5.4A2.4 2.4 0 0 1 3 11V2.6ZM11.8 13.4V5M5.4 5.6h3.6M5.4 8h3.6',
  moon: 'M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z',
  sun: 'M8 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM8 1.6v1.6M8 12.8v1.6M2.4 8H1M15 8h-1.4M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9 11 5M5 11l-1.1 1.1',
  link: 'M6.6 9.4a2.4 2.4 0 0 0 3.4 0l2-2a2.4 2.4 0 1 0-3.4-3.4l-.6.6M9.4 6.6a2.4 2.4 0 0 0-3.4 0l-2 2a2.4 2.4 0 0 0 3.4 3.4l.6-.6',
};

export function icon(name, size = 15) {
  const path = ICONS[name] || ICONS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

/* ---------------------------------------------------------------- Toast */

export function toast(message, kind = 'info', ms = 2600) {
  const stack = document.getElementById('toastStack');
  const names = { ok: 'check', error: 'alert', info: 'info', warn: 'alert' };
  const node = el(
    'div',
    { class: `toast ${kind === 'ok' ? 'ok' : kind}`, role: 'status' },
    el('span', { class: 'ico' }, icon(names[kind] || 'info', 14)),
    el('span', { class: 'flex-1' }, message),
  );
  stack.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, ms);
  return node;
}

/* ---------------------------------------------------------------- Modal */

export function openModal({ title, body, footer, wide = false, onClose }) {
  const layer = document.getElementById('modalLayer');
  const close = () => {
    layer.hidden = true;
    clear(layer);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  const modal = el(
    'div',
    { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    el(
      'div',
      { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '关闭', onclick: close }, icon('x', 14)),
    ),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, footer) : null,
  );

  mount(layer, modal);
  layer.hidden = false;
  layer.onclick = (event) => {
    if (event.target === layer) close();
  };
  document.addEventListener('keydown', onKey);
  const focusable = modal.querySelector('input, textarea, select, button.btn-primary');
  focusable?.focus();
  return { close, modal };
}

export function confirmDialog({ title, message, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      handle.close();
    };
    const handle = openModal({
      title,
      body: el('p', { class: 'mb-0 prewrap' }, message),
      footer: [
        el('button', { class: 'btn', type: 'button', onclick: () => done(false) }, '取消'),
        el(
          'button',
          { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => done(true) },
          confirmText,
        ),
      ],
      onClose: () => done(false),
    });
  });
}

/**
 * 带倒计时的确认弹窗：前 seconds 秒内确认按钮不可点，
 * 用来避免"手快了点掉"的误删。
 */
export function countdownConfirm({ title, message, confirmText = '删除', seconds = 5, danger = true }) {
  return new Promise((resolve) => {
    let remaining = seconds;
    let settled = false;
    let timer = null;

    const confirmBtn = el(
      'button',
      { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', disabled: true },
      `${confirmText}（${remaining} 秒）`,
    );
    const hint = el('span', { class: 'small muted' }, `为防止误操作，${seconds} 秒后才能确认`);

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(value);
      handle.close();
    };

    const handle = openModal({
      title,
      body: el(
        'div',
        {},
        el('p', { class: 'prewrap', style: 'margin:0 0 10px' }, message),
        el('div', { class: 'countdown-bar' }, el('i', { style: `animation-duration:${seconds}s` })),
      ),
      footer: [
        hint,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, '取消'),
        confirmBtn,
      ],
      onClose: () => {
        if (!settled) {
          settled = true;
          clearInterval(timer);
          resolve(false);
        }
      },
    });

    confirmBtn.addEventListener('click', () => finish(true));

    timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmText;
        hint.textContent = '现在可以确认了';
        hint.className = 'small';
        return;
      }
      confirmBtn.textContent = `${confirmText}（${remaining} 秒）`;
    }, 1000);
  });
}

/* --------------------------------------------------------------- 格式化 */

export function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function clockTime(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fullTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function shortId(id) {
  return id ? String(id).slice(0, 10) : '—';
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 表单字段工厂 */
export function field(label, control, desc) {
  return el(
    'div',
    { class: 'field' },
    el('label', {}, label),
    control,
    desc ? el('div', { class: 'desc' }, desc) : null,
  );
}

export function switchField(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', { class: 'switch-label' }, label));
}

/**
 * 滑杆（范围）字段。
 *
 * 左端写"低值"的含义、右端写"高值"的含义，中间实时显示当前数值与对应的描述，
 * 这样不用记"2 代表自然"这种映射。
 *
 * @param {object} opts
 *   label    字段名
 *   value    当前值
 *   left/right  两端含义
 *   describe 可选，(value) => 中文描述
 *   onChange 改变时回调
 */
export function sliderField({
  label,
  value = 50,
  min = 0,
  max = 100,
  step = 5,
  left = '',
  right = '',
  describe = null,
  onChange,
}) {
  const numeric = Number(value);
  const initial = Number.isFinite(numeric) ? numeric : 50;

  const valueBadge = el('span', { class: 'slider-value' });
  const range = el('input', {
    type: 'range',
    class: 'slider',
    min,
    max,
    step,
    value: initial,
  });

  const paint = (v) => {
    const pct = ((v - min) / (max - min)) * 100;
    range.style.setProperty('--fill', `${pct}%`);
    valueBadge.textContent = describe ? `${v} · ${describe(v)}` : String(v);
  };

  range.addEventListener('input', () => {
    const v = Number(range.value);
    paint(v);
    onChange?.(v);
  });

  paint(initial);

  return el(
    'div',
    { class: 'slider-field' },
    el('div', { class: 'slider-head' }, el('span', { class: 'slider-label' }, label), valueBadge),
    range,
    el('div', { class: 'slider-ends' }, el('span', {}, left), el('span', {}, right)),
  );
}

/**
 * 把 0~100 的滑杆值落到"第几档"。
 * bands 形如 [{ max: 39, ... }, { max: 100, ... }]，按 max 升序排列，取第一个 v <= max 的档。
 * 注意与服务端 attitudeToMode 的分界保持一致（都是闭区间）。
 */
export function sliderBand(value, bands) {
  const v = Number(value);
  if (!Number.isFinite(v) || !bands.length) return bands[bands.length - 1];
  for (const band of bands) {
    if (v <= band.max) return band;
  }
  return bands[bands.length - 1];
}
