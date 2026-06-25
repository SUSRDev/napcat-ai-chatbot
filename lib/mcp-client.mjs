/**
 * MCP (Model Context Protocol) 客户端 — stdio 传输
 * 连接外部 MCP Server，将 tools/list 暴露给 OpenAI 兼容 function calling。
 */
import { randomUUID } from 'crypto';
import { spawnProcess } from './process-run.mjs';

const MCP_PROTOCOL = '2024-11-05';
const DEFAULT_TOOL_TIMEOUT_MS = 60000;

/**
 * @param {Buffer} buffer
 * @param {(msg: object) => void} onMessage
 * @returns {Buffer}
 */
function drainMcpBuffer(buffer, onMessage) {
  let buf = buffer;
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString('utf-8');
    const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lenMatch) {
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = parseInt(lenMatch[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) break;
    const body = buf.slice(bodyStart, bodyStart + len).toString('utf-8');
    buf = buf.slice(bodyStart + len);
    try {
      onMessage(JSON.parse(body));
    } catch {
      /* ignore malformed */
    }
  }
  return buf;
}

function encodeMcpMessage(obj) {
  const json = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
}

/**
 * @typedef {object} McpServerConfig
 * @property {string} id
 * @property {string} [name]
 * @property {boolean} [enabled]
 * @property {string} command
 * @property {string[]} [args]
 * @property {Record<string, string>} [env]
 * @property {string} [cwd]
 * @property {number} [timeoutMs]
 */

export class McpStdioClient {
  /**
   * @param {McpServerConfig} config
   * @param {{ log?: (level: string, msg: string, data?: unknown) => void }} [opts]
   */
  constructor(config, opts = {}) {
    this.config = config;
    this.log = opts.log || (() => {});
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
    this.tools = [];
    this.lastError = '';
  }

  get id() {
    return String(this.config.id || this.config.name || 'mcp');
  }

  get displayName() {
    return String(this.config.name || this.id);
  }

  /**
   * @param {object} msg
   */
  _handleMessage(msg) {
    if (msg.method === 'notifications/message') {
      this.log('debug', `MCP ${this.id} notification`, msg.params);
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {number} [timeoutMs]
   */
  request(method, params = {}, timeoutMs = 30000) {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(new Error('MCP 进程未连接'));
    }
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(encodeMcpMessage(payload));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async connect() {
    if (this.connected && this.proc) return this.tools;
    await this.close();
    const cmd = String(this.config.command || '').trim();
    if (!cmd) throw new Error('MCP command 未配置');

    const args = Array.isArray(this.config.args) ? this.config.args.map(String) : [];
    const env = { ...process.env, ...(this.config.env || {}) };
    const cwd = this.config.cwd || process.cwd();

    this.proc = spawnProcess(cmd, args, {
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (chunk) => {
      this.buffer = drainMcpBuffer(Buffer.concat([this.buffer, chunk]), (msg) => this._handleMessage(msg));
    });
    this.proc.stderr.on('data', (chunk) => {
      const t = chunk.toString('utf-8').trim();
      if (t) this.log('debug', `MCP ${this.id} stderr`, t.slice(0, 500));
    });
    this.proc.on('error', (err) => {
      this.lastError = err.message;
      this.connected = false;
    });
    this.proc.on('exit', (code) => {
      this.connected = false;
      this.lastError = `进程退出 code=${code}`;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(this.lastError));
      }
      this.pending.clear();
    });

    await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'napcat-plugin-chat-bot', version: '2.5.5' }
    }, 45000);

    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(encodeMcpMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      }));
    }

    const toolsResult = await this.request('tools/list', {}, 30000);
    this.tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
    this.connected = true;
    this.lastError = '';
    this.log('info', `MCP ${this.displayName} 已连接`, { tools: this.tools.length });
    return this.tools;
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} args
   */
  async callTool(name, args = {}) {
    if (!this.connected) await this.connect();
    const timeout = Math.max(5000, Number(this.config.timeoutMs) || DEFAULT_TOOL_TIMEOUT_MS);
    const result = await this.request('tools/call', { name, arguments: args || {} }, timeout);
    return formatMcpToolResult(result);
  }

  async close() {
    this.connected = false;
    this.tools = [];
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('MCP 已关闭'));
    }
    this.pending.clear();
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * @param {unknown} result
 */
export function formatMcpToolResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const content = result.content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (c?.type === 'text') return String(c.text || '');
      if (c?.type === 'image') return '[image]';
      return JSON.stringify(c);
    }).filter(Boolean).join('\n');
  }
  if (result.structuredContent != null) {
    return typeof result.structuredContent === 'string'
      ? result.structuredContent
      : JSON.stringify(result.structuredContent, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

/**
 * @param {McpServerConfig[]} servers
 * @param {{ log?: (level: string, msg: string, data?: unknown) => void }} [opts]
 */
export class McpHub {
  constructor(servers = [], opts = {}) {
    this.log = opts.log || (() => {});
    this.clients = new Map();
    this.setServers(servers);
  }

  /**
   * @param {McpServerConfig[]} servers
   */
  setServers(servers) {
    this.serverConfigs = (Array.isArray(servers) ? servers : [])
      .filter((s) => s && s.enabled !== false && String(s.command || '').trim());
  }

  async reload() {
    await this.closeAll();
    for (const cfg of this.serverConfigs) {
      const id = String(cfg.id || cfg.name || randomUUID());
      const client = new McpStdioClient({ ...cfg, id }, { log: this.log });
      this.clients.set(id, client);
    }
  }

  async connectAll() {
    const status = [];
    for (const [id, client] of this.clients) {
      try {
        const tools = await client.connect();
        status.push({ id, name: client.displayName, ok: true, tools: tools.length, error: '' });
      } catch (e) {
        status.push({ id, name: client.displayName, ok: false, tools: 0, error: e.message });
      }
    }
    return status;
  }

  /** OpenAI tools 格式 */
  getOpenAiTools() {
    const out = [];
    for (const [serverId, client] of this.clients) {
      if (!client.tools?.length) continue;
      for (const tool of client.tools) {
        const tName = String(tool.name || '').trim();
        if (!tName) continue;
        const openName = `mcp__${serverId}__${tName}`.slice(0, 64);
        out.push({
          type: 'function',
          function: {
            name: openName,
            description: `[MCP:${client.displayName}] ${String(tool.description || tName).slice(0, 500)}`,
            parameters: tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', properties: {} }
          },
          _mcp: { serverId, toolName: tName }
        });
      }
    }
    return out;
  }

  /**
   * @param {string} openAiName
   * @param {Record<string, unknown>} args
   */
  async callByOpenAiName(openAiName, args) {
    const tools = this.getOpenAiTools();
    const def = tools.find((t) => t.function.name === openAiName);
    if (!def?._mcp) throw new Error(`未知 MCP 工具: ${openAiName}`);
    const client = this.clients.get(def._mcp.serverId);
    if (!client) throw new Error(`MCP 服务未连接: ${def._mcp.serverId}`);
    return client.callTool(def._mcp.toolName, args);
  }

  getStatus() {
    return [...this.clients.entries()].map(([id, client]) => ({
      id,
      name: client.displayName,
      connected: client.connected,
      tools: client.tools?.length || 0,
      lastError: client.lastError || ''
    }));
  }

  async closeAll() {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
