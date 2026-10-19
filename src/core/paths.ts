import path from "node:path";

// Todas las rutas se resuelven desde la raíz del proyecto (ctx.directory),
// nunca absolutas al sistema de archivos del desarrollador.

export function fixturesRoot(directory: string): string {
  return path.join(directory, "fixtures", "reto-03");
}

export function casoDir(directory: string, caso: string): string {
  return path.join(fixturesRoot(directory), "solicitudes", caso);
}

export function maestrosDir(directory: string): string {
  return path.join(fixturesRoot(directory), "maestros");
}

export function outDir(directory: string): string {
  return path.join(directory, "out");
}

export function outCasoDir(directory: string, caso: string): string {
  return path.join(outDir(directory), caso);
}

export function sapDir(directory: string): string {
  return path.join(outDir(directory), "sap");
}

export function controlCsvPath(directory: string): string {
  return path.join(outDir(directory), "control.csv");
}

export function logJsonlPath(directory: string): string {
  return path.join(outDir(directory), "log.jsonl");
}
