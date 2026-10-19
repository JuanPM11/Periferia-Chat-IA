import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearAdaptador } from "./llm/index.js";
import { ejecutarTurno } from "./agent/loop.js";
import { LlmMessage } from "./llm/adapter.js";
import { ToolCtx } from "./tools/oc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 8787);
const ACCESS_KEY = process.env.ACCESS_KEY ?? "";

/**
 * Arma el system prompt combinando comportamiento (agent/prompt.md) y
 * conocimiento del proceso (src/knowledge/ordenes-compra.md).
 */
function cargarSystem(): string {
  const prompt = fs.readFileSync(path.join(PROJECT_ROOT, "agent", "prompt.md"), "utf8");
  const knowledge = fs.readFileSync(
    path.join(PROJECT_ROOT, "src", "knowledge", "ordenes-compra.md"),
    "utf8",
  );
  return `${prompt}\n\n---\n\n# Conocimiento del proceso (referencia)\n\n${knowledge}`;
}

type Sesion = { mensajes: LlmMessage[]; tokens: number };
const sesiones = new Map<string, Sesion>();

/** Responde JSON con cabeceras CORS. @param code Código HTTP. @param body Cuerpo a serializar. */
function enviarJson(res: http.ServerResponse, code: number, body: unknown): void {
  const txt = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-access-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(txt);
}

/** Acumula y devuelve el cuerpo crudo de una petición HTTP. */
function leerBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Transforma una llamada a herramienta al formato que consume el front:
 * separa `data` (éxito) de `error` para pintarla en el chat.
 */
function resumirToolCall(tc: {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado: string;
  ok: boolean;
}) {
  let data: unknown = undefined;
  let error: string | undefined;
  try {
    const parsed = JSON.parse(tc.resultado);
    if (parsed.ok) data = parsed.data;
    else error = parsed.error;
  } catch {
    error = tc.resultado;
  }
  return { nombre: tc.nombre, argumentos: tc.argumentos, ok: tc.ok, data, error };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Sirve el front construido (web/dist) con fallback SPA a index.html.
 * @returns  true si sirvió un archivo; false si no hay build (modo dev con Vite aparte).
 */
function servirEstatico(res: http.ServerResponse, urlPath: string): boolean {
  const distDir = path.join(PROJECT_ROOT, "web", "dist");
  if (!fs.existsSync(distDir)) return false;
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  let file = path.join(distDir, rel);
  if (!file.startsWith(distDir)) return false; // evita path traversal
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, "index.html"); // SPA fallback
  }
  if (!fs.existsSync(file)) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    enviarJson(res, 204, {});
    return;
  }

  // Health: nunca expone la clave.
  if (req.method === "GET" && pathname === "/api/health") {
    const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
    const model =
      provider === "anthropic"
        ? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"
        : "desconocido";
    enviarJson(res, 200, { ok: true, provider, model, keyConfigurada: Boolean(process.env.ANTHROPIC_API_KEY) });
    return;
  }

  // Protección opcional por clave de acceso.
  if (pathname.startsWith("/api/") && ACCESS_KEY) {
    const provided = req.headers["x-access-key"];
    if (provided !== ACCESS_KEY) {
      enviarJson(res, 401, { ok: false, error: "clave de acceso inválida" });
      return;
    }
  }

  if (req.method === "GET" && pathname.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(pathname.slice("/api/sessions/".length));
    const s = sesiones.get(id);
    if (!s) {
      enviarJson(res, 404, { ok: false, error: "sesión no encontrada" });
      return;
    }
    enviarJson(res, 200, { ok: true, sessionId: id, mensajes: s.mensajes });
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    try {
      const body = JSON.parse((await leerBody(req)) || "{}") as {
        sessionId?: string;
        message?: string;
      };
      const sessionId = body.sessionId?.trim() || `s-${Date.now()}`;
      const message = (body.message ?? "").trim();
      if (!message) {
        enviarJson(res, 400, { ok: false, error: "falta 'message'" });
        return;
      }

      const adapter = crearAdaptador();
      const system = cargarSystem();
      const sesion = sesiones.get(sessionId) ?? { mensajes: [], tokens: 0 };
      const ctx: ToolCtx = { directory: PROJECT_ROOT, sessionId };

      // Cancelación: si el cliente cierra la conexión (pulsó "Cancelar"), se aborta
      // el ciclo del agente y la llamada en curso al proveedor LLM → corta el consumo.
      const abort = new AbortController();
      let cancelado = false;
      const onClose = () => {
        if (!res.writableEnded) {
          cancelado = true;
          abort.abort();
        }
      };
      req.on("close", onClose);

      let turno;
      try {
        turno = await ejecutarTurno({
          adapter,
          system,
          ctx,
          historial: sesion.mensajes,
          userMessage: message,
          tokensPreviosSesion: sesion.tokens,
          signal: abort.signal,
        });
      } finally {
        req.off("close", onClose);
      }

      // Si el cliente ya se fue, no intentamos responder.
      if (cancelado || res.writableEnded) return;

      sesiones.set(sessionId, {
        mensajes: turno.mensajes,
        tokens: sesion.tokens + turno.usage.input + turno.usage.output,
      });

      enviarJson(res, 200, {
        ok: true,
        sessionId,
        reply: turno.reply,
        toolCalls: turno.toolCalls.map(resumirToolCall),
        needsConfirmation: turno.needsConfirmation,
        usage: turno.usage,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      enviarJson(res, 500, { ok: false, error: msg });
    }
    return;
  }

  // Front estático (si está construido).
  if (req.method === "GET" && servirEstatico(res, pathname)) return;

  enviarJson(res, 404, { ok: false, error: "no encontrado" });
});

server.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
  console.log(`Proveedor: ${process.env.LLM_PROVIDER ?? "anthropic"}`);
});
