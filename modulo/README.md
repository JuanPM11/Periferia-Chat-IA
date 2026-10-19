# Módulo reutilizable (bonus)

El agente empaquetado para integrarse a otras plataformas de agentes, **sin** depender
del servidor HTTP de este repo.

- `agent.md` — el system prompt del agente (mismo cuerpo que `../agent/prompt.md`),
  con frontmatter `mode: primary` y `permission { edit: deny, bash: deny }`.
- `tools/oc.ts` — **reexporta** las herramientas de `../../src/tools/oc.ts` (no es una
  copia; importa las mismas funciones).
- `skill/ordenes-compra/SKILL.md` — el conocimiento del proceso (mismo cuerpo que
  `../src/knowledge/ordenes-compra.md`).

`agent.md` y `SKILL.md` se generan desde sus fuentes canónicas, así que no divergen.
Para regenerarlos tras cambiar el prompt o el conocimiento:

```bash
npm run modulo:sync
```
