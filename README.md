# Reto 03 — Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de una compra (correo + solicitud + cotización +
aprobación), lo valida contra los maestros (RC1–RC10), construye el payload de la
OC, genera la evidencia de aprobación y crea la OC en un **SAP simulado**. Nunca
crea nada con bloqueos ni con confirmaciones pendientes sin que el humano confirme.

La interfaz incluye, además del chat con las llamadas a herramientas visibles:
un **panel de solicitudes** con el estado de cada caso (sin procesar / OC creada /
bloqueada / esperando confirmación) y el avance; el **payload en tabla** con un
badge de fuente por valor (`maestro` / `solicitud` / `derivado`); una **tarjeta de
OC creada** con el número; un **botón de confirmación** explícito; y un **contador
de tokens** de la sesión.

## Requisitos

- **Node 20+** (probado con Node 24). También corre con **Bun** (`bun install`,
  `bun run demo.ts`).
- Una clave del proveedor LLM (Anthropic por defecto). La clave va **solo** en el
  entorno del backend, nunca en el repo, el front ni los logs.

## Puesta en marcha (un comando)

```bash
npm install
cp .env.example .env     # y completa ANTHROPIC_API_KEY
npm run dev              # levanta backend (8787) + front (5173) con proxy
```

Abre http://localhost:5173 y escribe, por ejemplo:
`procesa sol-004 y no la crees hasta que confirme`.

### Modo producción / link único

```bash
npm run build:web        # genera web/dist
npm run server           # el backend sirve el front en http://localhost:8787
```

## Variables de entorno (`.env.example`)

| Variable | Para qué |
|---|---|
| `LLM_PROVIDER` | Proveedor del adaptador (`anthropic`). |
| `ANTHROPIC_API_KEY` | **Tu** clave. Solo backend. |
| `ANTHROPIC_MODEL` | Modelo (por defecto `claude-sonnet-5-5`). |
| `AGENT_MAX_ITERS` | Tope de iteraciones herramienta→modelo por turno (25). |
| `AGENT_MAX_TOKENS_SESSION` | Tope de tokens por sesión (control de costo). |
| `PORT` | Puerto del backend (8787). |
| `ACCESS_KEY` | Opcional: si se define, el backend exige `x-access-key`. |

## Verificación sin modelo (`demo.ts`)

Procesa los 6 casos llamando **directamente a las herramientas**, sin ninguna clave:

```bash
npm run demo
```

Muestra por caso `apta`, bloqueos, confirmaciones, `retroactiva` y número de OC o
motivo. Incluye la **idempotencia** (reprocesa `sol-001`) y una **confirmación
explícita** (`sol-004` con `confirmado=true`). Los resultados quedan en:

- `out/control.csv` — una fila por intento.
- `out/sap/ordenes.jsonl` — OC creadas en el SAP simulado.
- `out/<caso>/` — `aprobacion.txt` (+ `.pdf`), `trazabilidad.json`.
- `out/log.jsonl` — traza de llamadas a herramientas.

## Estructura

```
agent/prompt.md              comportamiento del agente (system prompt)
src/knowledge/               conocimiento del proceso (RC1–RC10)
src/tools/oc.ts              herramientas tipadas (zod) — única fuente de valores
src/core/                    núcleo determinista (fixtures, validación, payload, evidencia)
src/sap/                     adaptador SAP (interfaz + mock sobre archivos)
src/llm/                     adaptador LLM (interfaz + Anthropic + fábrica)
src/agent/loop.ts            ciclo del agente (iteraciones, confirmación, costo)
src/server.ts                API HTTP + sirve el front
web/                         front de chat (React + Vite)
demo.ts                      verificación sin modelo
fixtures/                    entregados por Periferia (no modificar)
modulo/                      BONUS: agente empaquetado reutilizable
```

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, usage, sessionTokens }` |
| `GET` | `/api/casos` | Lista de casos con su estado de procesamiento (alimenta el panel) |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, keyConfigurada }` (sin exponer la clave) |

## Link de prueba

**App en vivo:** https://periferia-chat-ia.onrender.com

Desplegada en Render (Docker) a partir de este repo. No requiere clave de acceso.

> Nota: el plan gratuito de Render "duerme" tras ~15 min de inactividad; el primer
> request tras la inactividad puede tardar ~50 s en despertar. Si está dormida,
> recarga y espera unos segundos.
