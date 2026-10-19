// Regenera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md desde sus
// fuentes canónicas, para que el módulo reutilizable no diverja de la app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prompt = fs.readFileSync(path.join(root, "agent/prompt.md"), "utf8").trimEnd();
const know = fs
  .readFileSync(path.join(root, "src/knowledge/ordenes-compra.md"), "utf8")
  .trimEnd();

fs.mkdirSync(path.join(root, "modulo/skill/ordenes-compra"), { recursive: true });

const agent =
  `---\n` +
  `description: Agente que prepara y crea órdenes de compra en SAP a partir del paquete de correo, validando controles y pidiendo confirmación humana.\n` +
  `mode: primary\n` +
  `permission:\n  edit: deny\n  bash: deny\n` +
  `---\n\n` +
  prompt +
  "\n";
fs.writeFileSync(path.join(root, "modulo/agent.md"), agent, "utf8");

const skill =
  `---\n` +
  `name: ordenes-compra\n` +
  `description: Conocimiento del proceso de órdenes de compra de Periferia (paquete, maestros y controles RC1-RC10).\n` +
  `---\n\n` +
  know +
  "\n";
fs.writeFileSync(path.join(root, "modulo/skill/ordenes-compra/SKILL.md"), skill, "utf8");

console.log("modulo/ sincronizado desde agent/prompt.md y src/knowledge/");
