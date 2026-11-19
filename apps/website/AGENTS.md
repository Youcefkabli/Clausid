# Website instructions

This package is the independent Astro/Lumos marketing site. Read [LUMOS.md](LUMOS.md) before
changing pages, components or styles. The Astryx rules in `apps/web` do not apply here.

- Compose with the existing Lumos components and tokens; preserve attribution and licenses.
- Use the repository's pnpm workspace and lockfile. Upstream starter instructions mentioning
  npm lockfiles or starter CI are historical upstream guidance, not instructions to add those here.
- Keep product claims consistent with qualified application behavior. Website deployment is not
  application release qualification.
- Run `pnpm --filter @clausid/website check` and `pnpm --filter @clausid/website build` from the
  root; include responsive/rendered evidence for visual changes. Root `pnpm verify` includes the
  site checker and build but does not compare screenshots or deploy the site.
