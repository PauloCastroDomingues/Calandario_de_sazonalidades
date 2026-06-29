# Changelog

## 0.2.1 - 2026-06-29

- Adicionado `.vercelignore` para bloquear credenciais, estado local, caches e `data/consolidado.json` em deploys feitos pela Vercel CLI.

## 0.2.0 - 2026-06-29

- Primeiro versionamento do MVP do Calendario Comercial Reise.
- Preparado para publicacao no GitHub e deploy gratuito no Vercel com FastAPI.
- Mantido o fluxo local via `atualizar_dashboard.bat`.
- Protegidas credenciais, caches e estados locais no `.gitignore`.
- Desativado loop permanente de refresh em ambiente Vercel/serverless.
