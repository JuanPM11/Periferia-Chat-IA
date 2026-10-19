/**
 * demo.ts — verificación determinista SIN modelo de lenguaje.
 * Llama directamente a las herramientas de src/tools/oc.ts.
 *
 *   npm run demo        (o: npx tsx demo.ts / bun run demo.ts)
 *
 * No requiere ninguna clave de proveedor LLM.
 */
import { tools, ToolCtx } from "./src/tools/oc.js";
import { limpiarOut } from "./src/core/control.js";

const directory = process.cwd();
const ctx: ToolCtx = { directory, sessionId: "demo" };

type Parsed = { ok: true; data: any } | { ok: false; error: string };
const parse = (s: string): Parsed => JSON.parse(s);

/** Ejecuta una herramienta por nombre y parsea su resultado JSON. */
async function call(nombre: keyof typeof tools, args: Record<string, unknown>): Promise<Parsed> {
  const tool = tools[nombre];
  if (!tool) throw new Error(`herramienta desconocida: ${nombre}`);
  return parse(await tool.execute(args, ctx));
}

function linea(txt = ""): void {
  console.log(txt);
}

/**
 * Procesa un caso imprimiendo validación y resultado de creación.
 * @param caso           Carpeta del caso (ej. "sol-001").
 * @param opts.confirmado Si true, llama a oc_crear con confirmado=true.
 */
async function procesar(caso: string, opts: { confirmado?: boolean } = {}): Promise<void> {
  linea("─".repeat(72));
  linea(`CASO ${caso}${opts.confirmado ? "  (con confirmación explícita)" : ""}`);

  const val = await call("oc_validar", { caso });
  if (!val.ok) {
    linea(`  ✗ validación falló: ${val.error}`);
    return;
  }
  const v = val.data;
  linea(`  apta:         ${v.apta}`);
  linea(`  retroactiva:  ${v.retroactiva}`);
  linea(`  bloqueos:     ${v.bloqueos.length ? v.bloqueos.map((b: any) => b.codigo).join(", ") : "—"}`);
  for (const b of v.bloqueos) linea(`      ⛔ [${b.codigo}] ${b.detalle}`);
  linea(`  confirmaciones: ${v.confirmaciones.length ? v.confirmaciones.map((c: any) => c.codigo).join(", ") : "—"}`);
  for (const c of v.confirmaciones) linea(`      ⚠️  [${c.codigo}] ${c.detalle}`);
  if (Object.keys(v.derivados).length) linea(`  derivados:    ${JSON.stringify(v.derivados)}`);

  const crear = await call("oc_crear", { caso, confirmado: opts.confirmado === true });
  if (crear.ok) {
    linea(
      `  ✅ OC ${crear.data.numero_oc}  (idempotente=${crear.data.idempotente}, retroactiva=${crear.data.retroactiva})`,
    );
  } else {
    linea(`  ⏸️  no se creó OC → ${crear.error}`);
  }
}

async function main(): Promise<void> {
  limpiarOut(directory);
  linea("DEMO RETO 03 — Órdenes de compra SAP (sin modelo)");
  linea(`directorio: ${directory}`);

  // Flujo normal y excepciones
  await procesar("sol-001"); // apta → OC creada
  await procesar("sol-002"); // RC1 bloqueo (proveedor inexistente)
  await procesar("sol-003"); // RC2/RC3 bloqueo (aprobador sin autoridad / tope)
  await procesar("sol-004"); // RC5 confirmación → sin confirmar NO crea
  await procesar("sol-005"); // RC8 retroactiva → sin confirmar NO crea
  await procesar("sol-006"); // RC6 confirmación (IVA derivado) → sin confirmar NO crea

  // Idempotencia: sol-001 de nuevo devuelve el mismo número
  linea("");
  linea("═".repeat(72));
  linea("IDEMPOTENCIA — se reprocesa sol-001 (debe devolver la misma OC):");
  await procesar("sol-001");

  // Confirmación explícita: sol-004 ahora sí se crea
  linea("");
  linea("═".repeat(72));
  linea("CONFIRMACIÓN EXPLÍCITA — sol-004 con confirmado=true:");
  await procesar("sol-004", { confirmado: true });

  linea("");
  linea("Revisa out/control.csv, out/sap/ordenes.jsonl y out/<caso>/ para el detalle.");
}

main().catch((e) => {
  console.error("demo falló:", e);
  process.exit(1);
});
