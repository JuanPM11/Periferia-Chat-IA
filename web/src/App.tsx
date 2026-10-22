import React, { useCallback, useEffect, useRef, useState } from "react";

type ToolCall = {
  nombre: string;
  argumentos: Record<string, unknown>;
  ok: boolean;
  data?: any;
  error?: string;
};

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  needsConfirmation?: boolean;
};

type CasoEstado =
  | "sin_procesar"
  | "creada"
  | "idempotente"
  | "bloqueada"
  | "pendiente";

type Caso = {
  caso: string;
  solicitud_id: string;
  descripcion: string;
  valor_total: number;
  moneda: string;
  estado: CasoEstado;
  numero_oc: string | null;
  retroactiva: boolean;
};

const EJEMPLOS = [
  "Procesa el caso sol-001 de principio a fin.",
  'Procesa "sol-004". Muéstrame la OC como quedaría en SAP y no la crees hasta que yo confirme.',
  "Procesa sol-002 y dime por qué no se puede crear la OC.",
  "Procesa sol-005; si es retroactiva, avísame antes de crear.",
];

/** Etiqueta y color de cada estado de caso para el panel lateral. */
const ESTADO_META: Record<CasoEstado, { label: string; clase: string }> = {
  sin_procesar: { label: "Sin procesar", clase: "pend" },
  creada: { label: "OC creada", clase: "ok" },
  idempotente: { label: "OC creada", clase: "ok" },
  bloqueada: { label: "Bloqueada", clase: "err" },
  pendiente: { label: "Esperando confirmación", clase: "confirm" },
};

/** Formatea un monto con separadores de miles. */
function fmtMonto(n: number, moneda: string): string {
  return `${moneda} ${n.toLocaleString("es-CO")}`;
}

/** Deriva la fuente (solicitud / maestro / derivado / cotización) de una clave de trazabilidad. */
function fuenteChip(traza: Record<string, { fuente?: string }> | undefined, clave: string) {
  const f = traza?.[clave]?.fuente;
  if (!f) return null;
  const corta = f.startsWith("maestro") ? "maestro" : f;
  return <span className={`src src-${corta}`}>{corta}</span>;
}

/**
 * Tabla legible del payload de la OC (HU-3), con un chip por valor que indica
 * su FUENTE (maestro / solicitud / derivado). Hace visible la garantía de que
 * el agente no inventa valores: cada dato es trazable.
 */
function PayloadTabla({ payload, traza }: { payload: any; traza: any }) {
  const pos = payload?.posiciones?.[0] ?? {};
  const filas: Array<[string, React.ReactNode, string]> = [
    ["Proveedor", `${payload?.proveedor?.nombre} (${payload?.proveedor?.codigo_sap})`, "proveedor.codigo_sap"],
    ["NIT", payload?.proveedor?.nit, "proveedor.nit"],
    ["Descripción", pos.descripcion, "posicion.descripcion"],
    ["Cantidad × precio", `${pos.cantidad} ${pos.unidad} × ${fmtMonto(pos.precio_unitario ?? 0, payload?.moneda ?? "COP")}`, "posicion.precio_unitario"],
    ["Centro de costo", pos.centro_costo, "posicion.centro_costo"],
    ["Subárea", pos.subarea, "posicion.subarea"],
    ["Indicador IVA", pos.indicador_iva, "indicador_iva"],
    ["Condiciones de pago", payload?.condiciones_pago, "condiciones_pago"],
    ["Aprobador", payload?.aprobador?.email, "aprobador.email"],
  ];
  return (
    <div className="payload">
      <div className="payload-cab">
        <strong>OC — vista previa</strong>
        <span className="payload-ref">
          {payload?.referencia?.solicitud_id} · sociedad {payload?.sociedad} · org. {payload?.organizacion_compras}
        </span>
      </div>
      <table className="payload-tabla">
        <tbody>
          {filas.map(([k, v, clave]) => (
            <tr key={k}>
              <td className="pk">{k}</td>
              <td className="pv">
                {v} {fuenteChip(traza, clave)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Array.isArray(payload?.excepciones) && payload.excepciones.length > 0 && (
        <div className="payload-exc">
          {payload.excepciones.map((e: any, i: number) => (
            <span key={i} className="exc-chip">
              {e.codigo}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tarjeta destacada cuando la OC se crea con éxito (resultado inconfundible). */
function OcCreadaCard({ data }: { data: any }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    navigator.clipboard?.writeText(String(data.numero_oc)).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  };
  return (
    <div className="oc-card">
      <div className="oc-head">
        <span className="oc-check">✓</span>
        <span>Orden de compra {data.idempotente ? "ya existente" : "creada"} en SAP</span>
      </div>
      <div className="oc-num">
        <code>{data.numero_oc}</code>
        <button className="oc-copy" onClick={copiar}>
          {copiado ? "copiado ✓" : "copiar"}
        </button>
      </div>
      <div className="oc-meta">
        {data.idempotente && <span className="oc-tag">idempotente</span>}
        {data.retroactiva && <span className="oc-tag retro">retroactiva</span>}
      </div>
    </div>
  );
}

/**
 * Tarjeta plegable de una llamada a herramienta. Para `oc_construir_payload`
 * exitosa muestra además el payload como tabla con fuentes.
 */
function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [abierto, setAbierto] = useState(false);
  const esConfirmacion = !tc.ok && /requiere confirmaci/i.test(tc.error ?? "");
  const clase = esConfirmacion ? "tool confirm" : tc.ok ? "tool ok" : "tool err";
  const esPayload = tc.nombre === "oc_construir_payload" && tc.ok && tc.data?.payload;
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
      {esPayload && <PayloadTabla payload={tc.data.payload} traza={tc.data.trazabilidad} />}
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

/** Panel lateral con los casos y su estado de procesamiento. */
function PanelCasos({
  casos,
  onElegir,
  disabled,
}: {
  casos: Caso[];
  onElegir: (caso: string) => void;
  disabled: boolean;
}) {
  const hechos = casos.filter((c) => c.estado === "creada" || c.estado === "idempotente").length;
  return (
    <aside className="panel">
      <div className="panel-cab">
        <h2>Solicitudes</h2>
        <span className="panel-contador">
          {hechos}/{casos.length} con OC
        </span>
      </div>
      <div className="panel-lista">
        {casos.map((c) => {
          const meta = ESTADO_META[c.estado];
          return (
            <button
              key={c.caso}
              className={`caso caso-${meta.clase}`}
              onClick={() => onElegir(c.caso)}
              disabled={disabled}
              title={c.descripcion}
            >
              <div className="caso-top">
                <code>{c.caso}</code>
                <span className={`caso-estado ${meta.clase}`}>{meta.label}</span>
              </div>
              <div className="caso-desc">{c.descripcion}</div>
              <div className="caso-foot">
                <span>{fmtMonto(c.valor_total, c.moneda)}</span>
                {c.numero_oc && <span className="caso-oc">OC {c.numero_oc}</span>}
                {c.retroactiva && <span className="caso-retro">retroactiva</span>}
              </div>
            </button>
          );
        })}
        {casos.length === 0 && <p className="panel-vacio">Cargando casos…</p>}
      </div>
    </aside>
  );
}

/**
 * Chat del agente: panel de casos, historial, tool calls visibles, payload en
 * tabla, tarjeta de OC creada, botones de confirmación y contador de tokens.
 */
export function App(): React.JSX.Element {
  const [mensajes, setMensajes] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pensando, setPensando] = useState(false);
  const [sessionId, setSessionId] = useState(() => `s-${Date.now()}`);
  const [tokens, setTokens] = useState(0);
  const [casos, setCasos] = useState<Caso[]>([]);
  const [health, setHealth] = useState<{ provider: string; model: string; keyConfigurada: boolean } | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cargarCasos = useCallback(() => {
    fetch("/api/casos")
      .then((r) => r.json())
      .then((d) => d.ok && setCasos(d.casos))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setHealth(h))
      .catch(() => setHealth(null));
    cargarCasos();
  }, [cargarCasos]);

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
        if (typeof data.sessionTokens === "number") setTokens(data.sessionTokens);
        cargarCasos(); // el panel refleja lo que acabe de pasar (OC creada, etc.)
      }
    } catch (e) {
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

  /** Reinicia la conversación (nueva sesión), sin tocar el estado de los casos. */
  function nuevaConversacion() {
    if (pensando) return;
    setMensajes([]);
    setTokens(0);
    setSessionId(`s-${Date.now()}`);
  }

  const ultimoIdx = mensajes.length - 1;

  return (
    <div className="layout">
      <PanelCasos casos={casos} onElegir={(c) => enviar(`Procesa el caso ${c} de principio a fin.`)} disabled={pensando} />

      <div className="app">
        <header>
          <div>
            <h1>Agente · Órdenes de Compra SAP</h1>
            <p className="sub">Periferia IT Group · reto 03</p>
          </div>
          <div className="header-acc">
            <span className="tokens" title="Tokens consumidos en esta sesión (control de costo)">
              {tokens.toLocaleString("es-CO")} tok
            </span>
            <button className="nueva" onClick={nuevaConversacion} disabled={pensando}>
              Nueva conversación
            </button>
            {health ? (
              <span className={`badge ${health.keyConfigurada ? "on" : "off"}`}>
                {health.provider} · {health.model}
              </span>
            ) : (
              <span className="badge off">backend?</span>
            )}
          </div>
        </header>

        <main>
          {mensajes.length === 0 && (
            <div className="vacio">
              <p>Elige una solicitud del panel o pídeme procesar un caso. Por ejemplo:</p>
              <div className="ejemplos">
                {EJEMPLOS.map((e) => (
                  <button key={e} onClick={() => enviar(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensajes.map((m, i) => {
            const ocCreada = m.toolCalls?.find((t) => t.nombre === "oc_crear" && t.ok)?.data;
            const esUltimo = i === ultimoIdx;
            return (
              <div key={i} className={`msg ${m.role}`}>
                <div className="burbuja">
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="tools">
                      {m.toolCalls.map((tc, j) => (
                        <ToolCallCard key={j} tc={tc} />
                      ))}
                    </div>
                  )}
                  {ocCreada && <OcCreadaCard data={ocCreada} />}
                  <div className="texto">{m.text}</div>
                  {m.needsConfirmation && (
                    <div className="confirm-banner">
                      <span>
                        ⚠️ El agente espera tu <strong>confirmación</strong> para continuar.
                      </span>
                      {esUltimo && !pensando && (
                        <div className="confirm-acc">
                          <button className="btn-confirmar" onClick={() => enviar("Confirmo, crea la OC.")}>
                            Confirmar y crear OC
                          </button>
                          <button className="btn-ajustar" onClick={() => setInput("")}>
                            Prefiero ajustar algo
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

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
    </div>
  );
}
