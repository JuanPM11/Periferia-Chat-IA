import {
  Maestros,
  Proveedor,
  CentroCosto,
  Aprobador,
  Solicitud,
} from "./types.js";
import { normalizarNit, normalizarNombre } from "./text.js";

/**
 * Encuentra el proveedor de una solicitud en el maestro.
 * Estrategia: primero por NIT normalizado; si la solicitud no trae NIT (sol-006),
 * por nombre normalizado. No valida el estado `activo` (eso es RC1).
 * @returns  El proveedor del maestro, o `null` si no hay coincidencia.
 */
export function resolverProveedor(
  maestros: Maestros,
  solicitud: Solicitud,
): Proveedor | null {
  const nit = normalizarNit(solicitud.proveedor_nit);
  if (nit) {
    const porNit = maestros.proveedores.find((p) => normalizarNit(p.nit) === nit);
    if (porNit) return porNit;
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre);
  return (
    maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
  );
}

/**
 * Busca un centro de costo por su código exacto.
 * @returns  El centro, o `null` si no existe en el maestro.
 */
export function resolverCentro(
  maestros: Maestros,
  centroCosto: string,
): CentroCosto | null {
  return maestros.centrosCosto.find((c) => c.centro_costo === centroCosto) ?? null;
}

/**
 * Devuelve el aprobador de un centro cuyo email coincide con quien firmó la aprobación.
 * Sirve a RC2 (autoridad) y RC3 (tope del aprobador).
 * @param centro          Centro resuelto (o null).
 * @param emailAprobador  Email del emisor del correo de aprobación.
 * @returns               El aprobador autorizado, o `null` si no figura en el centro.
 */
export function resolverAprobador(
  centro: CentroCosto | null,
  emailAprobador: string | null | undefined,
): Aprobador | null {
  if (!centro || !emailAprobador) return null;
  const email = emailAprobador.trim().toLowerCase();
  return centro.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null;
}
