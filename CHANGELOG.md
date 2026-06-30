# Changelog

## 0.4.1 - 2026-06-30

- Reposicionado o projeto como central de prontidao comercial sazonal, evitando sobreposicao com frentes de BI, midia e funil.
- Adicionado playbook de prontidao sazonal ao endpoint `/api/analytics`, com status, score, lacuna de receita, checklist por area e bloqueios principais.
- Incluido bloco `Prontidao sazonal` no dashboard para destacar acoes antes das proximas datas comerciais.
- Removido o workflow D-1 via GitHub Actions do fluxo ativo; Apps Script passa a ser o caminho oficial sem custo para atualizar dados D-1 no GitHub.
- Atualizada a documentacao para deixar Python como alternativa local/tecnica, nao como automacao diaria principal.

## 0.4.0 - 2026-06-30

- Adicionada camada backend de inteligencia comercial com corte D-1.
- Criado endpoint `/api/analytics` com previsao de fechamento, risco, sinais executivos, proximas datas sazonais e recomendacoes.
- Incluido bloco `Previsao e proximos movimentos` no dashboard para antecipar faturamento e acoes antes das datas comerciais.
- Criado exportador `scripts/exportar_bigquery_d1.py` para gerar snapshots diarios dos JSONs a partir do BigQuery com `dry-run` e limite de bytes.
- Adicionado bridge `apps_script/bigquery_bridge` para atualizar snapshots D-1 pelo Apps Script usando a conta Google autorizada no BigQuery e commitando os JSONs no GitHub.
- Preparada alternativa tecnica de automacao via exportador Python, mantida fora do fluxo operacional principal.
- Mantido o modelo sem custo adicional: frontend consome cache JSON/API e nao consulta BigQuery diretamente.

## 0.3.1 - 2026-06-29

- Refinado o visual das tabelas para uma leitura mais limpa, profissional e executiva.
- Substituidos chips muito arredondados por tags compactas com cores semanticas mais discretas.
- Suavizados bordas, sombras, cabecalhos e divisorias para reduzir ruido visual no dashboard.

## 0.3.0 - 2026-06-29

- Compactado o topo do dashboard para dar mais foco ao calendario.
- Movidos os filtros para a area de controles do calendario.
- Reorganizada a toolbar de analise em grupos mais claros.
- Transformado o painel de eventos manuais em drawer lateral.
- Simplificadas as celulas do calendario, deixando metricas visiveis em hover/foco/selecao.
- Ajustado o status do Vercel para indicar atualizacao sob demanda quando nao ha loop de refresh.
- Navegacao mobile mantida fora deste ciclo de layout.

## 0.2.2 - 2026-06-29

- Adicionada tabela `[project]` no `pyproject.toml` para o build Python atual do Vercel com `uv`.
- Fixada a versao Python de deploy em `3.12`.

## 0.2.1 - 2026-06-29

- Adicionado `.vercelignore` para bloquear credenciais, estado local, caches e `data/consolidado.json` em deploys feitos pela Vercel CLI.

## 0.2.0 - 2026-06-29

- Primeiro versionamento do MVP do Calendario Comercial Reise.
- Preparado para publicacao no GitHub e deploy gratuito no Vercel com FastAPI.
- Mantido o fluxo local via `atualizar_dashboard.bat`.
- Protegidas credenciais, caches e estados locais no `.gitignore`.
- Desativado loop permanente de refresh em ambiente Vercel/serverless.
