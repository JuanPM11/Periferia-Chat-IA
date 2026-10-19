import React, { useEffect, useRef, useState } from "react";

type ToolCall = {
  nombre: string;
  argumentos: Record<string, unknown>;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  needsConfirmation?: boolean;
};

const EJEMPLOS = [
  "Procesa el caso sol-001 de principio a fin.",
  'Procesa "sol-004". Muéstrame la OC como quedaría en SAP y no la crees hasta que yo confirme.',
  "Procesa sol-002 y dime por qué no se puede crear la OC.",
  "Procesa sol-005; si es retroactiva, avísame antes de crear.",
];

/**
 * Tarjeta plegable que muestra una llamada a herramienta (nombre, argumentos y
 * resultado). Resalta en ámbar cuando la herramienta pide confirmación humana.
 */
function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [abierto, setAbierto] = useState(false);
  const esConfirmacion = !tc.ok && /requiere confirmaci/i.test(tc.error ?? "");
  const clase = esConfirmacion ? "tool confirm" : tc.ok ? "tool ok" : "tool err";
  return (
    <div className={clase}>
      <button className="tool-head" onClick={() => setAbierto((v) => !v)}>
        <span className="tool-dot" />
        <code>{tc.nombre}</code>
        <span className="tool-status">
          {esConfirmacion ? "requiere confirmación" : tc.ok ? "ok" : "error"}
        </span>
        <span className="tool-toggle">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <div className="tool-body">
          <div className="tool-sub">argumentos</div>
          <pre>{JSON.stringify(tc.argumentos, null, 2)}</pre>
          <div className="tool-sub">{tc.ok ? "resultado" : "detalle"}</div>
          <pre>{tc.ok ? JSON.stringify(tc.data, null, 2) : tc.error}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * Chat del agente: historial, indicador de "pensando", tool calls visibles y
 * banner de confirmación. Mantiene un `sessionId` estable y consulta `/api/health`.
 */
export function App(): React.JSX.Element {
  const [mensajes, setMensajes] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pensando, setPensando] = useState(false);
  const [sessionId] = useState(() => `s-${Date.now()}`);
  const [health, setHealth] = useState<{ provider: string; model: string; keyConfigurada: boolean } | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setHealth(h))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, pensando]);

  /** Envía un mensaje al backend (/api/chat) y agrega la respuesta al historial. */
  async function enviar(texto: string) {
    const msg = texto.trim();
    if (!msg || pensando) return;
    setMensajes((m) => [...m, { role: "user", text: msg }]);
    setInput("");
    setPensando(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: msg }),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!data.ok) {
        setMensajes((m) => [...m, { role: "assistant", text: `⚠️ Error: ${data.error}` }]);
      } else {
        setMensajes((m) => [
          ...m,
          {
            role: "assistant",
            text: data.reply || "(sin texto)",
            toolCalls: data.toolCalls,
            needsConfirmation: data.needsConfirmation,
          },
        ]);
      }
    } catch (e) {
      // Cancelación del usuario: el fetch se abortó a propósito.
      if (e instanceof DOMException && e.name === "AbortError") {
        setMensajes((m) => [
          ...m,
          { role: "assistant", text: "⏹️ Procesamiento cancelado. No se consumieron más tokens." },
        ]);
      } else {
        setMensajes((m) => [
          ...m,
          { role: "assistant", text: `⚠️ No se pudo contactar el backend: ${String(e)}` },
        ]);
      }
    } finally {
      setPensando(false);
      abortRef.current = null;
    }
  }

  /** Aborta la petición en curso: corta el consumo en el backend. */
  function cancelar() {
    abortRef.current?.abort();
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Agente · Órdenes de Compra SAP</h1>
          <p className="sub">Periferia IT Group · reto 03</p>
        </div>
        <div className="health">
          {health ? (
            <>
              <span className={`badge ${health.keyConfigurada ? "on" : "off"}`}>
                {health.provider} · {health.model}
              </span>
              {!health.keyConfigurada && <span className="warn">sin API key</span>}
            </>
          ) : (
            <span className="badge off">backend?</span>
          )}
        </div>
      </header>

      <main>
        {mensajes.length === 0 && (
          <div className="vacio">
            <p>Pídeme procesar un caso. Por ejemplo:</p>
            <div className="ejemplos">
              {EJEMPLOS.map((e) => (
                <button key={e} onClick={() => enviar(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="burbuja">
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="tools">
                  {m.toolCalls.map((tc, j) => (
                    <ToolCallCard key={j} tc={tc} />
                  ))}
                </div>
              )}
              <div className="texto">{m.text}</div>
              {m.needsConfirmation && (
                <div className="confirm-banner">
                  ⚠️ El agente espera tu <strong>confirmación</strong> para continuar.
                  Responde "confirmo" (o indica qué ajustar).
                </div>
              )}
            </div>
          </div>
        ))}

        {pensando && (
          <div className="msg assistant">
            <div className="burbuja">
              <div className="pensando">
                <span></span>
                <span></span>
                <span></span> pensando…
                <button type="button" className="cancelar-inline" onClick={cancelar}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
        <div ref={finRef} />
      </main>

      <footer>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Ej.: procesa sol-004 y no la crees hasta que confirme'
            disabled={pensando}
          />
          {pensando ? (
            <button type="button" className="cancelar" onClick={cancelar}>
              Cancelar
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Enviar
            </button>
          )}
        </form>
      </footer>
    </div>
  );
}
