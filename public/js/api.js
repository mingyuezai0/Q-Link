async function parse(res) {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const message = data?.error || data?.message || `请求失败（${res.status}）`;
    const error = new Error(message);
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  return data;
}

const send = (method) => (path, body) =>
  fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(parse);

export const api = {
  get: (path) => fetch(path).then(parse),
  post: send('POST'),
  put: send('PUT'),
  patch: send('PATCH'),
  del: send('DELETE'),
};
