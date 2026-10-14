import { config } from '../data.js';
import { hub } from '../hub.js';

/**
 * OpenAI 兼容的对话补全客户端。
 * DeepSeek / 通义 / 智谱 / OpenAI / 本地 Ollama、vLLM 等都遵循同一套 /chat/completions 协议，
 * 因此这里只暴露 baseUrl + apiKey + model 三项配置。
 */
export async function chat(messages, options = {}) {
  const ai = config.get().ai;
  const baseUrl = (options.baseUrl || ai.baseUrl || '').replace(/\/+$/, '');
  const apiKey = options.apiKey ?? ai.apiKey;
  const model = options.model || ai.model;

  if (!baseUrl) throw new Error('尚未配置模型接口地址（设置 → AI 模型）');
  if (!model) throw new Error('尚未配置模型名称（设置 → AI 模型）');

  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages,
    temperature: options.temperature ?? ai.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? ai.maxTokens ?? 1024,
    stream: false,
  };
  if (options.json) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ai.timeoutMs ?? 60000);

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...(options.headers || {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      const brief = text.slice(0, 300);
      hub.log('error', 'ai', `模型返回 ${res.status}`, { detail: brief });
      throw new Error(`模型接口错误 ${res.status}：${brief}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('模型返回的不是合法 JSON');
    }

    const content = json?.choices?.[0]?.message?.content ?? '';
    const usage = json?.usage || {};
    hub.broadcast('ai:usage', {
      ms: Date.now() - started,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      model: json?.model || model,
    });

    return { content: String(content), raw: json, latency: Date.now() - started };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('模型响应超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 轻量连通性测试：设置页的「测试连接」按钮 */
export async function testConnection(override = {}) {
  const started = Date.now();
  const { content } = await chat(
    [
      { role: 'system', content: '你是连通性测试助手，只回复两个字。' },
      { role: 'user', content: '请只回复：正常' },
    ],
    { ...override, maxTokens: 16, temperature: 0 },
  );
  return { ok: true, ms: Date.now() - started, reply: content.trim().slice(0, 40) };
}
