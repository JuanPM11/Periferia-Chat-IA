import fs from "node:fs";
import { controlCsvPath, logJsonlPath, outDir } from "./paths.js";

const CONTROL_HEADER =
  "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts";

export type FilaControl = {
  solicitud_id: string;
  resultado: "creada" | "bloqueada" | "pendiente" | "idempotente";
  numero_oc: string;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
};

/** Escapa un valor para CSV (entrecomilla si contiene coma, comillas o salto de línea). */
function escaparCsv(valor: string): string {
  if (/[",\n]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}

/**
 * Borra y recrea out/ al inicio de cada corrida, para que `demo.ts` sea determinista
 * (misma salida en ejecuciones consecutivas, salvo timestamps).
 * @param directory  Raíz del proyecto.
 */
export function limpiarOut(directory: string): void {
  const dir = outDir(directory);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Agrega una fila al log de control para auditoría (crea el encabezado la 1ª vez).
 * Columnas: solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts.
 * @param fila  Registro del intento (creada / bloqueada / pendiente / idempotente).
 */
export function registrarControl(directory: string, fila: FilaControl): void {
  const ruta = controlCsvPath(directory);
  fs.mkdirSync(outDir(directory), { recursive: true });
  if (!fs.existsSync(ruta)) fs.writeFileSync(ruta, CONTROL_HEADER + "\n", "utf8");
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    fila.bloqueos.join("; "),
    fila.confirmaciones.join("; "),
    new Date().toISOString(),
  ]
    .map((c) => escaparCsv(String(c)))
    .join(",");
  fs.appendFileSync(ruta, linea + "\n", "utf8");
}

export type EstadoControl = {
  solicitud_id: string;
  resultado: FilaControl["resultado"];
  numero_oc: string;
  retroactiva: boolean;
};

/**
 * Lee `out/control.csv` y devuelve el ÚLTIMO estado registrado por `solicitud_id`
 * (la fila más reciente gana). Alimenta el panel de casos del front para saber
 * qué solicitudes ya se procesaron y con qué resultado.
 *
 * Solo lee las 4 primeras columnas (solicitud_id, resultado, numero_oc,
 * retroactiva), que nunca contienen comas, así que un split simple es seguro
 * aunque las columnas de detalle vayan entrecomilladas.
 * @param directory  Raíz del proyecto.
 * @returns          Mapa `solicitud_id → estado` (vacío si no hay log todavía).
 */
export function leerControl(directory: string): Map<string, EstadoControl> {
  const ruta = controlCsvPath(directory);
  const mapa = new Map<string, EstadoControl>();
  if (!fs.existsSync(ruta)) return mapa;
  const lineas = fs
    .readFileSync(ruta, "utf8")
    .split("\n")
    .slice(1) // salta el encabezado
    .filter((l) => l.trim().length > 0);
  for (const linea of lineas) {
    const cols = linea.split(",");
    const solicitud_id = cols[0];
    if (!solicitud_id) continue;
    mapa.set(solicitud_id, {
      solicitud_id,
      resultado: (cols[1] ?? "pendiente") as FilaControl["resultado"],
      numero_oc: cols[2] ?? "",
      retroactiva: cols[3] === "true",
    });
  }
  return mapa;
}

/**
 * Agrega una línea al log técnico `out/log.jsonl` (una por llamada a herramienta).
 * @param entrada  `{ herramienta, caso?, ok, resumen }`; se le añade `ts`.
 */
export function registrarLog(
  directory: string,
  entrada: { herramienta: string; caso?: string; ok: boolean; resumen: string },
): void {
  const ruta = logJsonlPath(directory);
  fs.mkdirSync(outDir(directory), { recursive: true });
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada });
  fs.appendFileSync(ruta, linea + "\n", "utf8");
}
