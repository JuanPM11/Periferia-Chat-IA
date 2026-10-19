# SOLUCIÓN — Reto 03 · Agente de Órdenes de Compra SAP

> Perxia 2.0 · Periferia IT Group

---

## 1. Problema en una frase

La analista administrativa digita a mano, una por factura, cada orden de compra en
SAP —proveedor, centro de costo, IVA, aprobador, condiciones de pago— verificando
"de memoria" controles que deberían ser sistemáticos; le duele a ella (tiempo y
reprocesos en cierre contable) y a la dirección (no sabe qué % de OC son
retroactivas).

## 2. Arquitectura

```
┌───────────────────────┐   HTTP/JSON   ┌───────────────────────────────────────────┐
│  Front chat (React)   │ ────────────▶ │  Backend (Node http)                        │
│  web/                 │ ◀──────────── │  src/server.ts                              │
│  - historial          │               │   └─ ciclo del agente  src/agent/loop.ts    │
│  - tool calls visibles│               │        prompt → modelo → herramientas → …   │
│  - resalta confirmar  │               │   └─ adaptador LLM     src/llm/*            │
└───────────────────────┘               │   └─ herramientas zod  src/tools/oc.ts      │
                                         │   └─ núcleo determinista src/core/*         │
                                         │   └─ SAP simulado      src/sap/mock.ts      │
                                         └───────┬──────────────────────┬──────────────┘
                                          fixtures/ (solo lectura)   out/ (escritura)
```

**Separación por responsabilidad (lo que se evalúa):**

| Capa | Dónde | Contenido |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Cómo actúa el agente, cuándo confirma, qué nunca hace. |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | El proceso y los controles, en prosa. |
| **Ejecución** | `src/tools/oc.ts` + `src/core/*` | La lógica determinista; única fuente de valores. |

Un cambio de reglas de negocio toca `src/core/validate.ts` (o el conocimiento), no
el servidor ni el ciclo del agente.

**Flujo de datos:** las herramientas **recargan siempre desde `fixtures/`** y
recomputan; nunca confían en los objetos que el modelo reenvía. Así el modelo no
puede alterar un monto ni un código (mitiga el riesgo del PRD §10).

## 3. Ciclo del agente

Implementado en `src/agent/loop.ts`:

1. Se arma el `system` = `prompt.md` + conocimiento.
2. Se añade el mensaje del usuario y se entra al bucle **modelo → herramientas →
   modelo**.
3. En cada iteración, si el modelo devuelve `tool_use`, se ejecutan **todas** las
   herramientas pedidas, se adjuntan los `tool_result` y se vuelve a llamar al
   modelo. Si no pide herramientas, el turno termina.
4. **Tope de iteraciones (CA1):** `AGENT_MAX_ITERS` (25). Al alcanzarlo, el agente
   responde con lo que tiene y avisa.
5. **Tope de tokens por sesión:** `AGENT_MAX_TOKENS_SESSION`. Si se supera, corta el
   turno con aviso (control de costo: un usuario no puede vaciar la clave).
6. **Confirmación humana (CA3):** el turno expone `needsConfirmation`. Se activa
   cuando `oc_validar` reporta `confirmaciones` y no hubo una creación exitosa en el
   turno, o cuando `oc_crear` responde `requiere confirmación`. El front resalta ese
   estado; `oc_crear` solo procede con `confirmado: true`, que el agente envía únicamente
   si el mensaje siguiente del usuario confirma.
7. Toda llamada a herramienta se devuelve al front (nombre, argumentos, resultado) y
   queda en `out/log.jsonl` (CA4). Los errores se muestran en lenguaje claro y la
   sesión no muere (CA5).

El **contrato de herramienta** es `{ ok: true, data } | { ok: false, error }` como
**string**; ninguna herramienta lanza (cada `execute` envuelve en try/catch).

## 4. Elección del modelo

- **Proveedor:** Anthropic. **Modelo por defecto:** `claude-sonnet-5-5` (configurable
  por `.env`). El adaptador (`src/llm/adapter.ts`) es una interfaz propia
  `enviar(system, mensajes, herramientas)`; cambiar de proveedor es implementar esa
  interfaz y registrarla en `src/llm/index.ts` — el ciclo del agente no cambia.
- **Por qué:** tool-calling robusto y estable con JSON Schema, buen seguimiento de
  instrucciones de "no inventar valores", y latencia/costo razonables para un flujo
  de pocas herramientas por turno.
- **Costo estimado por caso** (orden de magnitud; _verificar tarifa vigente_):
  un caso completo son ~3–5 llamadas al modelo. Con system+conocimiento (~2k tokens)
  reenviados por llamada y los `tool_result`, estimo **~10–15k tokens de entrada** y
  **~1–2k de salida** por caso. A tarifas de clase Sonnet (~US$3/1M entrada,
  ~US$15/1M salida): **≈ US$0,05–0,09 por caso**. La `demo.ts` cuesta **US$0** (no
  usa modelo).

## 5. Matriz de controles (RC1–RC10)

Implementada en `src/core/validate.ts`, pura y determinista. Entrada: maestros +
paquete normalizado. Salida: `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }`.

| # | Tipo | Implementación |
|---|---|---|
| RC1 | Bloqueo | `resolverProveedor`: match por **NIT normalizado** (sin puntos ni DV); si la solicitud no trae NIT, por **nombre normalizado** (sin tildes/sufijos legales). Debe estar `activo`. |
| RC2 | Bloqueo | Aprobación existe, `aprobado` (regex `/aprobad[oa]/i`) y el emisor figura en `aprobadores` del centro. |
| RC3 | Bloqueo | `valor_total ≤ tope` del aprobador que firmó. |
| RC4 | Bloqueo | `subarea ∈ centro.subareas`. |
| RC5 | Confirmación | `|cot − sol| / sol ≤ 2%`; si excede o no hay cotización, se confirma mostrando ambos valores. |
| RC6 | Confirmación + derivado | Falta `indicador_iva` → se deriva `indicador_iva_default` del proveedor y se confirma. |
| RC7 | Derivado | Falta `condiciones_pago` → se toma `condiciones_pago_default` (solo informa). |
| RC8 | Confirmación | `factura.fecha < fecha_solicitud` → `retroactiva = true` + confirmación. |
| RC9 | Confirmación | `fecha_aprobacion ≥ fecha_solicitud`; si no, confirma. |
| RC10 | Bloqueo | `|cantidad × valor_unitario − valor_total| ≤ 1`. |

**La más difícil: RC1 combinada con la identidad del proveedor.** Los NIT aparecen
en tres formatos (solicitud `900555111`, cotización `900.555.111-2`, maestro
`900555111`), y `sol-006` llega **sin NIT**, obligando a un match por nombre
tolerante a sufijos legales (`S.A.S.`, `Ltda.`) y tildes. Resolver esto de forma
determinista —y que `sol-002` caiga como "no existe" sin falsos positivos— fue lo que
más cuidado pidió. Se aisló en `src/core/text.ts` (`normalizarNit`, `normalizarNombre`)
y `src/core/resolver.ts`.

**Resultado observado** (de `demo.ts`): sol-001 ✅ crea · sol-002 ⛔ RC1 · sol-003 ⛔ RC2
· sol-004 ⚠️ RC5 · sol-005 ⚠️ RC8 (retroactiva) · sol-006 ⚠️ RC6. Coincide con los
objetivos O1–O4.

## 6. Diseño del adaptador SAP real (§7.5)

Hoy: interfaz `SapAdapter` (`src/sap/adapter.ts`) con `mock.ts` sobre `out/sap/`.
Para producción:

- **Opción elegida: OData `API_PURCHASE_ORDER_PROCESS_SRV`** (S/4HANA) vía SAP
  Integration Suite / BTP. Razón: dada una **viabilidad no confirmada**, OData es el
  camino de menor fricción (HTTP+JSON, sin stack RFC/BAPI ni conectividad SAP GUI),
  versionado y con sandbox en el API Business Hub para probar sin el SAP real. Si la
  empresa ya opera sobre ECC sin Gateway, el plan B es RFC/BAPI `BAPI_PO_CREATE1` +
  `BAPI_TRANSACTION_COMMIT` mediante un conector (node-rfc).
- **Mapeo del payload (§7.4) a OData:** `A_PurchaseOrder` (cabecera:
  `CompanyCode=sociedad`, `PurchasingOrganization`, `Supplier=codigo_sap`,
  `PaymentTerms=condiciones_pago`, `DocumentCurrency=moneda`) y `A_PurchaseOrderItem`
  por cada posición (`PurchaseOrderItem=numero`, `Material/PurchaseOrderItemText=
  descripcion`, `OrderQuantity=cantidad`, `PurchaseOrderQuantityUnit=unidad`,
  `NetPriceAmount=precio_unitario`, `CostCenter`, `TaxCode=indicador_iva`). La
  evidencia de aprobación se adjunta como anexo (`AttachmentContentSet`) o se referencia
  por `evidencia_sha256` en un campo de texto.
- **Autenticación:** OAuth 2.0 client-credentials contra BTP; las credenciales viven
  en un **secret manager** (BTP destination service / Azure Key Vault), nunca en el
  agente, el prompt ni los logs. El backend obtiene el token en runtime.
- **Idempotencia frente a reintentos:** se mantiene `buscarOrdenPorReferencia(solicitud_id)`;
  antes de crear se consulta por `PurchaseOrderByCustomer`/campo de referencia propio
  (`YY1_SolicitudId`) para no duplicar. Si SAP responde **error parcial** (cabecera
  creada, posición rechazada), se captura el `PurchaseOrder` devuelto y se reconcilia:
  o se completa la posición faltante, o se marca la OC para revisión manual sin crear
  una segunda.
- **Plan B si no es viable conectarse:** el agente igual ahorra tiempo generando (a)
  la OC **lista para pegar** en SAP GUI (orden de campos de la transacción ME21N) y
  (b) un **archivo de carga masiva** (LSMW/LTMC o CSV del formato de carga), más la
  evidencia. El valor —validación de controles— ya está entregado aunque la creación
  sea manual.

## 7. Lectura del proceso — OC retroactivas (media página)

De los 6 casos, `sol-005` es retroactivo: la **factura (2026-08-10) es anterior a la
solicitud (2026-08-27)** y la propia aprobación lo dice ("ya llegó la factura, crear
la OC para radicarla"). No es un error de dato: es el proceso al revés. La compra se
ejecutó, llegó la factura, y la OC se crea después solo para poder contabilizar. Eso
rompe el control preventivo (la OC debería **autorizar** el gasto, no **legalizarlo**)
y deja a la empresa sin capacidad de negociar o frenar antes de comprometerse.

**Qué le diría a la dirección:** no lo resuelvo escondiéndolo; lo **mido**. El agente
ya marca `retroactiva = true` en `out/control.csv`, así que por primera vez se puede
reportar el **% de OC retroactivas por mes, área y proveedor**. Con ese número sobre la
mesa, propondría: (1) mantener la creación retroactiva **permitida pero con
confirmación y marca** (no bloquear, para no frenar la operación), (2) un **umbral de
tolerancia** por centro de costo, y (3) cuando un área supera el umbral dos meses
seguidos, exigir **solicitud y aprobación previas a la cotización** para sus compras.
La política (tolerar vs. rechazar) es decisión de la dirección; el agente aporta la
evidencia para tomarla y el control para hacerla cumplir.

## 8. Decisiones y trade-offs

1. **Las herramientas recomputan desde `fixtures/` e ignoran los objetos que reenvía
   el modelo.** Alternativa descartada: confiar en el `paquete`/`payload` que pasa el
   modelo (menos I/O). Se descartó porque el modelo podría alterar un monto o un
   código; recomputar garantiza que el valor creado sale siempre de la fuente (CA2 y
   el riesgo del §10). Costo: leer el caso varias veces por turno (barato en local).
2. **Núcleo determinista separado de las herramientas y del agente.** Alternativa:
   meter la lógica dentro de los `execute`. Se descartó para que `demo.ts` pruebe la
   lógica sin modelo y para poder testear `validar()` aislada. Costo: más archivos.
3. **Servidor con `http` nativo de Node en vez de un framework.** Alternativa:
   Express/Fastify. Se descartó para minimizar dependencias y tiempo de arranque
   (< 2 min en máquina limpia); el API es pequeño (3 rutas + estáticos). Costo: escribir
   a mano el ruteo y el CORS.
4. **Unidad de posición derivada por heurística conservadora** (`H` si "horas", `MES`
   solo si cantidad mensual real, si no `UN`). Alternativa: pedírsela al modelo. Se
   descartó para mantener el payload 100% trazable a reglas; se documenta como
   `derivado`.

## 9. Supuestos

- Los adjuntos binarios llegan ya normalizados (lo dice `nota_fixture`): `.xlsx`→JSON,
  `.pdf`→`.txt`. Por eso `oc_leer_excel` es P1 y no se usa.
- El NIT se compara sin dígito de verificación; dos proveedores no comparten los 9
  dígitos base.
- "Aprobado" en el cuerpo del correo es señal suficiente de aprobación (no se exige
  firma digital en el reto).
- El total relevante de la cotización es el "TOTAL (IVA incluido)".
- La moneda del reto es COP; el esquema admite USD por si aparece.
- Fecha de referencia de reglas = fechas de los propios documentos (sin "hoy" externo
  en este reto, a diferencia del reto 02).

## 10. Cobertura (historias de usuario)

| HU | Estado | Nota |
|---|---|---|
| HU-1 Leer el paquete | ✅ hecho | `oc_leer_paquete`, adjunto ausente → `null`, sin excepción. |
| HU-2 Validar controles | ✅ hecho | `oc_validar` RC1–RC10, `apta/bloqueos/confirmaciones/derivados/retroactiva`. |
| HU-3 Construir payload | ✅ hecho | `oc_construir_payload` validado con zod + `out/<caso>/trazabilidad.json`. |
| HU-4 Evidencia | ✅ hecho | `aprobacion.txt` + `sha256` (P0) y `aprobacion.pdf` (P1, `pdf-lib`). |
| HU-5 Crear en SAP | ✅ hecho | `oc_crear`, secuencial desde `4500000001`, idempotente, `control.csv`. |
| HU-6 Errores | ✅ hecho | `{ ok:false, error }` legible; un caso malo no frena el resto. |
| Bonus módulo | ✅ hecho | `modulo/` reutiliza el mismo prompt, tools y conocimiento. |
| Front streaming | ⚪ parcial | Respuesta por turno (no token-a-token); suficiente para la demo. |

**Para producción falta:** adaptador SAP real (OData), OCR para PDF/Excel binarios
reales, persistencia de sesiones fuera de memoria, autenticación y multiusuario,
observabilidad (métricas/alertas) y pruebas automatizadas sobre `validar()`.

## 11. Uso de IA

> _Candidato: ajusta esta sección a tu uso real; debes poder explicar cada línea._

- **Claude Code (Anthropic)** se usó para andamiar el proyecto (estructura, tipos
  zod, núcleo de validación, servidor, front y documentación) y para trazar los 6
  casos contra las reglas RC1–RC10.
- **Qué se revisó/descartó:** se corrigió la heurística de `unidad` (una primera
  versión marcaba `MES` por "12 meses" de vigencia cuando la cantidad eran licencias
  `UN`); se decidió que las herramientas **recomputaran desde fixtures** en vez de
  confiar en los objetos del modelo; y se mantuvo el servidor en `http` nativo en
  lugar de añadir un framework que proponía el asistente.

## 12. Riesgos en producción y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo "arregla" un monto para que cuadre con la cotización. | El payload sale de las herramientas; el modelo no puede alterarlo (recompute desde fixtures). |
| Conexión a SAP no viable a corto plazo. | Plan B del §6: OC lista para pegar + archivo de carga masiva. |
| Falsos negativos en match de proveedor (NIT raro, nombre distinto). | Normalización aislada y testeable; en producción, consulta en vivo al maestro de SAP por NIT. |
| Fuga de la clave LLM. | Solo en entorno del backend; nunca en front, repo, logs ni respuestas; `/api/health` no la expone. |
| Costo descontrolado. | Tope de iteraciones por turno y de tokens por sesión, configurables. |
| PDF/Excel reales (no normalizados). | Añadir OCR/parsers; hoy P1 porque los fixtures vienen normalizados. |
| Evidencia insuficiente para auditoría. | `sha256` del contenido; en producción, firma digital y almacenamiento inmutable. |
