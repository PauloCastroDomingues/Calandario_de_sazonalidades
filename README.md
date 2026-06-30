# Calendário Comercial Reise

Dashboard do Calendário Comercial Reise em modelo frontend + backend. A versão atual opera como central de prontidão comercial sazonal: lê snapshots D-1, projeta fechamento, identifica riscos antes das próximas datas comerciais e apoia decisões de campanha, estoque e calendário.

## Escopo do produto

Este projeto não deve substituir as frentes analíticas de BI, mídia, funil ou financeiro. O diferencial dele é responder:

```text
Diante das próximas datas comerciais, estamos preparados para capturar a oportunidade?
```

Por isso, métricas de receita, campanha, UTM, produto e funil entram como evidências de apoio. O centro da leitura é a antecipação: previsão, lacuna contra referência, risco, prontidão sazonal, ações e responsáveis.

## Como abrir

1. Instale as dependências uma vez:

```bat
python -m pip install -r requirements.txt
```

2. Dê dois cliques em `atualizar_dashboard.bat`.
3. O script atualiza os JSONs mockados em `data/`.
4. O backend FastAPI é iniciado em `http://localhost:8765/dashboard.html`.
5. O dashboard abre automaticamente no navegador.

Também é possível rodar manualmente:

```bat
python scripts\atualizar_dados.py
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Depois acesse `http://localhost:8765/dashboard.html`.

Se a API não estiver disponível, o frontend ainda tenta abrir em modo fallback lendo os JSONs locais e usando `localStorage` apenas como contingência temporária para eventos manuais.

## Arquitetura compartilhada

O frontend não precisa de credencial BigQuery. Ele consome apenas a API do backend:

- `GET /api/status`: última atualização, próxima atualização, status de refresh e fontes.
- `GET /api/calendar-data`: JSON consolidado usado pelo dashboard.
- `GET /api/analytics`: previsão de fechamento, risco, sinais executivos, próximas datas, playbook de prontidão sazonal e recomendações.
- `POST /api/refresh`: força atualização imediata.
- `GET /api/events`: lista eventos manuais ativos.
- `POST /api/events`: cria evento manual compartilhado.
- `PUT /api/events/{id}`: edita evento manual compartilhado.
- `DELETE /api/events/{id}`: exclui logicamente evento manual com `status = Excluído` e `deleted_at`.

Nesta etapa, o backend lê os JSONs existentes e mantém eventos manuais em `data/eventos_manuais.json` como MVP compartilhado. A interface de armazenamento já está separada para trocar por Google Sheets, BigQuery ou Firestore.

## Atualização dos dados

O backend atualiza o cache ao iniciar e depois a cada 15 minutos. O topo do dashboard mostra:

- última atualização;
- próxima atualização;
- status atualizado/atualizando/erro;
- botão `Atualizar agora`.

O botão `Atualizar agora` chama `POST /api/refresh`. Se uma atualização já estiver em andamento, a API retorna uma mensagem amigável e evita rodar duas cargas simultâneas.

O frontend consulta `GET /api/status` periodicamente. Quando identifica uma nova atualização no backend, recarrega o consolidado via `GET /api/calendar-data` sem expor credenciais no navegador.

## Inteligência comercial e previsão

A partir da versão `0.4.0`, o backend gera uma camada analítica sobre o cache consolidado. Essa camada trabalha com corte `D-1`: se hoje é `30/06/2026`, a leitura executiva considera dados fechados até `29/06/2026`.

O objetivo é transformar o calendário em um braço analítico e preditivo:

- previsão de faturamento do mês;
- risco de fechamento versus referência sugerida;
- sinais executivos de receita, conversão, mídia, estoque e calendário;
- próximas datas sazonais com contagem regressiva;
- playbook de prontidão sazonal por data;
- movimentos sugeridos antes de campanhas e datas comerciais.

O fluxo oficial sem custo adicional é:

```text
Apps Script -> BigQuery D-1 -> data/*.json no GitHub -> Vercel -> dashboard
```

O frontend não consulta BigQuery. A consulta pesada deve acontecer apenas no processo diário de atualização, com filtros de data, limite de bytes e cache JSON versionável.

### Bridge via Apps Script

Para o MVP interno, a opção mais simples é usar Apps Script como bridge autorizado pela conta Google que já acessa o BigQuery:

```text
Apps Script agenda D-1
-> consulta BigQuery com a conta do criador do trigger
-> gera data/*.json
-> cria um commit no GitHub
-> Vercel publica o novo snapshot
```

Esse caminho evita guardar uma service account do BigQuery no GitHub. O token do GitHub deve ficar somente nas propriedades do Apps Script, nunca no código nem no repositório.

Arquivos do bridge:

```text
apps_script/bigquery_bridge/Code.gs
apps_script/bigquery_bridge/appsscript.json
apps_script/bigquery_bridge/README.md
```

Use `testarDadosD1` para estimar bytes sem publicar e `atualizarDadosD1` para atualizar os JSONs no GitHub.

### Exportador Python

O exportador Python continua disponível como alternativa técnica local, útil para testes, backfills e manutenção. O fluxo operacional diário do MVP é o Apps Script.

Exportador BigQuery D-1:

```bat
python scripts\exportar_bigquery_d1.py --dry-run
python scripts\exportar_bigquery_d1.py
```

Variáveis usadas pelo exportador:

```text
BQ_PROJECT_ID=reise-ssot
BQ_CREDENTIALS_PATH=credentials/reise-bigquery-sa.json
BQ_MAX_BYTES_BILLED=1073741824
```

O `--dry-run` estima bytes processados sem alterar os JSONs. A execução real grava os arquivos em `data/` e atualiza `data/manifest.json`.

## Navegação do calendário

Os controles principais ficam dentro do card `Visão mensal`, logo acima do calendário.

- Use `←` para voltar um mês.
- Use `→` para avançar um mês.
- Use `Mês atual` e `Ano atual` para ir direto a um período.
- Use `Hoje` para voltar para a data atual do computador/navegador.
- Use `Limpar seleção` para remover a data ou intervalo selecionado.

O dia de hoje aparece com destaque próprio, sem substituir o destaque da seleção.

## Seleção no calendário

A seleção principal acontece diretamente no calendário.

- Clique em um dia para analisar uma data.
- Clique e arraste de um dia até outro para selecionar um período.
- Também é possível selecionar um intervalo clicando no primeiro dia e depois no último.

Quando houver intervalo, o painel lateral mostra `Período selecionado`, as datas inicial/final e a quantidade de dias.

## Dropdown de período

Na linha `Analisar`, clique no botão `Período` para abrir a lista flutuante.

Opções rápidas como `Hoje`, `Ontem`, `Últimos 7 dias`, `Mês atual` e `Ano atual` aplicam imediatamente e fecham o menu.

Para usar `Data livre`, preencha `Data inicial` e `Data final` dentro do próprio dropdown e clique em `Aplicar`.

## Dropdown de comparação

Clique no botão `Comparação` para abrir a lista flutuante.

Opções simples, como `Sem comparação`, `Período anterior`, `Ano anterior`, `Mês anterior` e `Meta`, aplicam imediatamente.

Quando escolher `Mesmo mês de outro ano`, selecione o ano dentro do dropdown e clique em `Aplicar`.

Quando escolher `Data livre`, preencha as datas de comparação dentro do dropdown e clique em `Aplicar`.

Se os períodos tiverem durações diferentes, o dashboard mostra um aviso porque a comparação pode ficar distorcida.

## Flutuação do período

A área `Flutuação do período` aparece apenas quando há comparação ativa. Ela fica abaixo do calendário e antes dos cards de resumo, ocupando a largura da página para não alongar o painel lateral.

Cada card mostra:

- valor atual;
- valor comparado;
- variação absoluta;
- variação percentual.

Métricas exibidas: faturamento, pedidos, ticket médio, sessões, add_to_cart, checkout, abandono carrinho, abandono checkout, clientes novos, clientes recorrentes, investimento, ROAS e conversão.

Indicadores: seta para cima para variação positiva, seta para baixo para negativa e traço quando não houver base comparável.

## Gráficos comparativos

Sem comparação ativa, os gráficos mostram apenas a série do período atual.

Com comparação ativa, os gráficos exibem duas séries:

- `Atual`;
- `Comparado`.

Para sobrepor períodos diferentes, o eixo X usa dia relativo: `D1`, `D2`, `D3` e assim por diante. Dessa forma, por exemplo, `01/05/2026 a 10/05/2026` pode ser comparado diretamente com `01/05/2025 a 10/05/2025` ou com uma data livre de mesma duração.

Se os períodos tiverem durações diferentes, o dashboard mostra o aviso: `Períodos com durações diferentes podem distorcer a comparação.`

## Tabelas comparativas

Sem comparação ativa, as tabelas continuam simples:

- Produtos: produto, classificação, itens, receita e estoque.
- Aquisição: origem, nome, pedidos, receita e ROAS.

Com comparação ativa, as tabelas mostram o período atual versus o período comparado e exibem um badge `Comparando com`.

Em `Destaques e quedas`, os produtos são cruzados por `product_key`; se não existir, o dashboard usa `sku`; se também não existir, usa `product_name`. Produtos que aparecem só no período atual são marcados como `Novo no período`. Produtos que aparecem só no comparado são marcados como `Sumiu no período`.

Em `Campanhas e UTMs`, campanhas são cruzadas por `campaign_id` ou, na falta dele, por `campaign_name`. UTMs são cruzadas pela combinação `utm_source + utm_medium + utm_campaign`. Campanhas novas aparecem como `Nova no período`; campanhas sem performance atual aparecem como `Sem performance atual`.

As variações seguem a fórmula `(atual - comparado) / comparado`. Quando não há base comparável, a tabela mostra `Novo`, `-100%` ou `-`, conforme o caso. O ROAS é sempre recalculado como `receita / investimento`, não como média simples diária.

## Eventos manuais

Clique em `Campanhas e lançamentos` na linha `Analisar` para abrir ou fechar o painel de eventos manuais.

Dentro desse painel ficam:

- `Adicionar campanha/lançamento`;
- lista de eventos manuais do mês exibido;
- `Exportar eventos manuais`;
- `Importar eventos manuais`.

O formulário de cadastro fica oculto por padrão. Ele abre apenas ao clicar em `Adicionar campanha/lançamento` ou `Editar`.

Campos disponíveis: título, tipo, data início, data fim, produto relacionado, campanha relacionada, prioridade, responsável, status e observação.

Ao salvar com a API ativa, o evento fica gravado na base compartilhada do backend e aparece para todos os usuários. Eventos com mais de um dia marcam todo o intervalo entre `data_inicio` e `data_fim`.

## Editar e excluir eventos manuais

A lista `Eventos manuais neste mês` mostra apenas eventos criados manualmente que cruzam o mês exibido.

- `Editar`: abre o mesmo formulário de cadastro preenchido com os dados atuais.
- `Excluir`: pede confirmação e exclui logicamente apenas o evento manual no backend, removendo-o do calendário, do painel lateral e da exportação.

Feriados, datas comerciais e sazonalidades oficiais de `calendario_br.json` não podem ser excluídos pelo dashboard. Apenas eventos manuais entram na lista com botão `Excluir`.

## Exportar e importar eventos manuais

Com a API ativa, exportar/importar usa os eventos vindos da base compartilhada. O `localStorage` fica apenas como fallback temporário quando a API não responde.

- `Exportar eventos manuais`: baixa um arquivo `eventos_manuais.json`.
- `Importar eventos manuais`: carrega um JSON exportado anteriormente e envia os eventos para a API; em fallback, junta com os eventos locais.

Para versionar ou reaproveitar os eventos, coloque o arquivo exportado em:

```text
data/eventos_manuais.json
```

## Variáveis de ambiente

Variáveis preparadas para execução local, Cloud Run e futura integração BigQuery:

```text
BQ_PROJECT_ID=reise-ssot
BQ_CREDENTIALS_PATH=credentials/reise-bigquery-sa.json
REFRESH_INTERVAL_MINUTES=15
EVENTS_STORAGE=bigquery
EVENTS_DATASET=app_calendar
EVENTS_TABLE=manual_events
PORT=8765
```

Para o MVP sem credencial, use `EVENTS_STORAGE=local` ou deixe a variável ausente. Quando `EVENTS_STORAGE=bigquery`, a interface já aponta conceitualmente para `app_calendar.manual_events`, mas a escrita real em BigQuery entra na próxima etapa.

Schema sugerido para `app_calendar.manual_events`:

```text
event_id
data_inicio
data_fim
titulo
tipo
categoria
produto_relacionado
campanha_relacionada
prioridade
responsavel
observacao
status
created_by
created_at
updated_by
updated_at
deleted_at
```

## GitHub e Vercel sem custo

Este MVP esta preparado para ser versionado no GitHub e conectado ao Vercel no plano Hobby.

Arquivos importantes para deploy:

- `pyproject.toml`: aponta o Vercel para o FastAPI em `backend.app:app`.
- `requirements.txt`: dependencias instaladas no build do Vercel.
- `.gitignore`: bloqueia credenciais, `.env`, caches Python e estado local da Vercel/Codex.
- `.vercelignore`: bloqueia credenciais, caches e arquivos gerados em deploys pela Vercel CLI.
- `VERSION` e `CHANGELOG.md`: registram a versao publicada.

Configuracao recomendada no Vercel:

```text
Framework Preset: Other
Build Command: vazio
Output Directory: vazio
Install Command: pip install -r requirements.txt
Root Directory: ./
```

Para manter custo zero:

- Use o plano Hobby.
- Nao habilite add-ons pagos como Analytics Plus, Speed Insights pago, Blob, KV ou bancos pagos.
- Nao configure credenciais BigQuery no frontend.
- Mantenha `EVENT_MUTATIONS_ENABLED` ausente ou `0` no Vercel enquanto nao houver storage persistente gratuito definido.
- Mantenha `ENABLE_REFRESH_LOOP` ausente ou `0` no Vercel, pois o ambiente e serverless.

No Vercel, o dashboard consegue ler os JSONs mockados e a API FastAPI. A escrita compartilhada de eventos manuais fica desativada por padrao no deploy serverless sem storage persistente; quando a API recusa a escrita, o frontend cai para o fallback local do navegador e permite exportar/importar `eventos_manuais.json`.

## Cloud Run

O projeto já inclui `Dockerfile`. Build local:

```bat
docker build -t calendario-reise .
docker run --rm -p 8080:8080 -e PORT=8080 calendario-reise
```

No Cloud Run, configure as variáveis de ambiente e monte/disponibilize a credencial apenas no backend. Nunca coloque service account em `src/app.js` ou no navegador.

## Arquivos em data/

- `calendario_br.json`: feriados, datas comerciais, sazonalidades e campanhas.
- `kpis_dia.json`: receita, pedidos, ticket médio, sessões, conversão, investimento e ROAS.
- `funil_dia.json`: sessões e etapas do funil.
- `produtos_dia.json`: produtos destaque e produtos em queda.
- `campanhas_dia.json`: campanhas pagas por plataforma.
- `utms_dia.json`: origem, mídia, campanha, canal, receita e pedidos.
- `estoque.json`: posição mockada de estoque por SKU.
- `eventos_manuais.json`: campanhas, lançamentos, ações comerciais e observações criadas manualmente.
- `consolidado.json`: junção dos arquivos anteriores para inspeção rápida.

## Queries futuras

Os rascunhos SQL ficam em `queries/`. No futuro, eles serão usados para substituir os dados mockados por consultas BigQuery.

## Credencial BigQuery

Quando a integração for ativada, a credencial pode ficar em `credentials/`, por exemplo:

```text
credentials/reise-bigquery-sa.json
```

O backend lê esse caminho por `BQ_CREDENTIALS_PATH`. A credencial não é distribuída para colaboradores e não aparece no frontend.
