// Utilidades de normalización deterministas (sin dependencia del modelo).

/**
 * Normaliza un NIT para poder compararlo entre fuentes con formatos distintos
 * (solicitud "900555111", cotización "900.555.111-2", maestro "900555111").
 *
 * Contrato:
 * - Quita puntos y espacios, descarta el dígito de verificación (lo que sigue a "-")
 *   y se queda solo con los dígitos base.
 * @param nit  NIT en cualquier formato, o null/undefined.
 * @returns    El NIT solo-dígitos, o `null` si no hay dígitos.
 */
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

/**
 * Normaliza una razón social para compararla de forma tolerante cuando no hay NIT
 * (caso sol-006). Pasa a minúsculas, quita tildes, elimina sufijos legales
 * (S.A.S., Ltda., S.A., …) y toda puntuación, y colapsa espacios.
 * @param nombre  Razón social tal como aparece en el documento.
 * @returns       Cadena normalizada comparable (ej. "tecnosuministros").
 */
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

/**
 * Extrae el primer monto numérico de un texto en formato colombiano.
 * Interpreta '.' como separador de miles y ',' como decimal.
 * Ej.: "COP 11.400.000" → 11400000 · "2.689.076" → 2689076.
 * @param texto  Fragmento que contiene el número (con o sin prefijo de moneda).
 * @returns      El entero resultante, o `null` si no se encontró un número válido.
 */
export function parsearMontoCOP(texto: string): number | null {
  const m = texto.match(/([\d][\d.,]*)/);
  if (!m) return null;
  const crudo = m[1]!;
  // Formato colombiano: '.' miles, ',' decimales. Quitamos miles, convertimos coma decimal.
  const soloNumero = crudo.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(soloNumero);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Recorta una fecha ISO a su parte de día.
 * @param fechaIso  Fecha ISO (ej. "2026-08-20T09:00:00-05:00").
 * @returns         Los primeros 10 caracteres, "YYYY-MM-DD".
 */
export function soloFecha(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

/**
 * Compara dos fechas por su parte de día, sin construir objetos Date
 * (comparación lexicográfica estable sobre "YYYY-MM-DD").
 * @returns  Negativo si a < b, 0 si iguales, positivo si a > b.
 */
export function compararFechas(a: string, b: string): number {
  const fa = soloFecha(a);
  const fb = soloFecha(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}
