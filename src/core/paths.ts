import path from "node:path";

// Todas las rutas se resuelven desde la raíz del proyecto (ctx.directory),
// nunca absolutas al sistema de archivos del desarrollador.

/** Raíz de los fixtures entregados (solo lectura). @param directory Raíz del proyecto. */
export function fixturesRoot(directory: string): string {
  return path.join(directory, "fixtures", "reto-03");
}

/** Carpeta de un caso de prueba. @param caso Nombre de carpeta (ej. "sol-001"). */
export function casoDir(directory: string, caso: string): string {
  return path.join(fixturesRoot(directory), "solicitudes", caso);
}

/** Carpeta de los maestros de referencia (proveedores, centros, IVA, pagos). */
export function maestrosDir(directory: string): string {
  return path.join(fixturesRoot(directory), "maestros");
}

/** Carpeta de salida (escritura); se limpia al inicio de cada corrida. */
export function outDir(directory: string): string {
  return path.join(directory, "out");
}

/** Carpeta de salida específica de un caso (evidencia, trazabilidad). */
export function outCasoDir(directory: string, caso: string): string {
  return path.join(outDir(directory), caso);
}

/** Carpeta del SAP simulado (ordenes.jsonl). */
export function sapDir(directory: string): string {
  return path.join(outDir(directory), "sap");
}

/** Ruta del log de control para auditoría (una fila por intento de OC). */
export function controlCsvPath(directory: string): string {
  return path.join(outDir(directory), "control.csv");
}

/** Ruta del log técnico de llamadas a herramientas (JSON Lines). */
export function logJsonlPath(directory: string): string {
  return path.join(outDir(directory), "log.jsonl");
}
