// Utilidades de normalización deterministas (sin dependencia del modelo).

/** Quita puntos, espacios y el dígito de verificación (-N) de un NIT. */
export function normalizarNit(nit: string | null | undefined): string | null {
  if (!nit) return null;
  const limpio = nit.replace(/[.\s]/g, "").trim();
  // "900555111-2" -> "900555111"; "900.555.111-2" ya quedó "900555111-2"
  const sinDv = limpio.includes("-") ? limpio.split("-")[0]! : limpio;
  const soloDigitos = sinDv.replace(/\D/g, "");
  return soloDigitos.length > 0 ? soloDigitos : null;
}

const SUFIJOS_LEGALES = [
  "s.a.s.",
  "s.a.s",
  "sas",
  "s.a.",
  "s.a",
  "sa",
  "ltda.",
  "ltda",
  "s. en c.",
  "e.u.",
  "eu",
];

/** Normaliza una razón social: minúsculas, sin tildes, sin sufijos ni puntuación. */
export function normalizarNombre(nombre: string): string {
  let n = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita tildes
  for (const suf of SUFIJOS_LEGALES) {
    n = n.replace(new RegExp(`\\b${suf.replace(/\./g, "\\.")}\\b`, "g"), " ");
  }
  return n
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "COP 11.400.000" / "11.400.000" -> 11400000 (enteros COP, separador de miles '.'). */
export function parsearMontoCOP(texto: string): number | null {
  const m = texto.match(/([\d][\d.,]*)/);
  if (!m) return null;
  const crudo = m[1]!;
  // Formato colombiano: '.' miles, ',' decimales. Quitamos miles, convertimos coma decimal.
  const soloNumero = crudo.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(soloNumero);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Devuelve la parte YYYY-MM-DD de una fecha ISO (con o sin hora/zona). */
export function soloFecha(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

/** Compara dos fechas YYYY-MM-DD de forma estable (a < b => negativo). */
export function compararFechas(a: string, b: string): number {
  const fa = soloFecha(a);
  const fb = soloFecha(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}
