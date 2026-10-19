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

function escaparCsv(valor: string): string {
  if (/[",\n]/.test(valor)) return `"${valor.replace(/"/g, '""')}"`;
  return valor;
}

/** Limpia out/ al inicio para garantizar determinismo entre corridas. */
export function limpiarOut(directory: string): void {
  const dir = outDir(directory);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

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

export function registrarLog(
  directory: string,
  entrada: { herramienta: string; caso?: string; ok: boolean; resumen: string },
): void {
  const ruta = logJsonlPath(directory);
  fs.mkdirSync(outDir(directory), { recursive: true });
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada });
  fs.appendFileSync(ruta, linea + "\n", "utf8");
}
