# BigQuery Bridge via Apps Script

Este bridge roda as queries D-1 com a conta Google que criou o trigger e envia os JSONs para o GitHub em um unico commit.

## 1. Seguranca imediata

Se um token GitHub foi colado em chat, revogue esse token e crie outro. Nao cole o novo token no chat e nao salve em arquivo do repositorio.

## 2. Criar projeto Apps Script

1. Acesse https://script.google.com.
2. Crie um novo projeto.
3. Copie `Code.gs` para o editor.
4. Copie o conteudo de `appsscript.json` para o manifesto do projeto.
5. Em `Servicos`, adicione o servico avancado `BigQuery API`.

## 3. Propriedades do script

Configure em `Configuracoes do projeto > Propriedades do script`:

```text
BQ_PROJECT_ID=reise-ssot
BQ_EXPORT_ENABLED=1
GITHUB_OWNER=PauloCastroDomingues
GITHUB_REPO=Calendario_de_sazonalidades
GITHUB_BRANCH=main
GITHUB_TOKEN=<novo_token_github>
LOOKBACK_DAYS=760
BQ_MAX_BYTES_BILLED=1073741824
EVENTS_SPREADSHEET_ID=<id_da_planilha_de_eventos>
```

`START_DATE` e `END_DATE` sao opcionais para backfill manual. Remova essas propriedades depois do backfill para voltar ao D-1 automatico.

`BQ_EXPORT_ENABLED` e o disjuntor de custo do BigQuery:

- `1`: consultas BigQuery ligadas.
- `0`: consultas BigQuery pausadas; `atualizarDadosD1` nao executa `BigQuery.Jobs.query`.

`EVENTS_SPREADSHEET_ID` e opcional para o BigQuery D-1, mas obrigatorio para eventos manuais compartilhados. O ID fica na URL da planilha, entre `/d/` e `/edit`.

## 4. Ligar e desligar BigQuery

Use esse fluxo enquanto o projeto ainda nao foi aprovado ou quando quiser reduzir custo:

1. Para pausar, rode `pausarBigQuery`.
2. Confirme no log `bq_export_enabled: false`.
3. O trigger diario pode continuar ativo; ele vai pular as consultas BigQuery.
4. Para reativar, rode `ativarBigQuery`.
5. Confirme com `statusBigQuery`.

Tambem da para mudar manualmente em `Propriedades do script`:

```text
BQ_EXPORT_ENABLED=0
```

Com BigQuery pausado, os eventos manuais continuam funcionando pela Google Sheet. Se `EVENTS_SPREADSHEET_ID` estiver configurado, `atualizarDadosD1` pode exportar apenas `data/eventos_manuais.json`; os JSONs analiticos D-1 permanecem com o ultimo snapshot ja publicado.

## 5. Testar

1. Rode `testarDadosD1`.
2. Autorize com a conta que tem acesso ao BigQuery.
3. Confirme no log os bytes estimados.
4. Rode `atualizarDadosD1`.
5. Confirme o commit no GitHub.

## 6. Agendar

Rode `instalarTriggerDiario` uma vez. O trigger passa a executar `atualizarDadosD1` diariamente por volta de 07:00 no fuso `America/Sao_Paulo`.

## 7. Eventos manuais compartilhados

Os eventos manuais podem ser armazenados em uma Google Sheet e exportados para `data/eventos_manuais.json`.

Fluxo:

1. Crie uma Google Sheet para os eventos.
2. Copie o ID da planilha.
3. Salve `EVENTS_SPREADSHEET_ID` nas propriedades do Apps Script.
4. Rode `instalarBaseEventosManuais`.
5. A funcao cria a aba `eventos_manuais` com as colunas oficiais.
6. Rode `exportarEventosManuais` para gerar apenas o JSON de eventos.
7. Rode `atualizarDadosD1` para atualizar BigQuery D-1 e eventos manuais no mesmo commit.

Colunas da aba:

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

## 8. Web App para escrita pelo dashboard

Para permitir criar, editar e excluir eventos pelo dashboard:

1. No Apps Script, clique em `Implantar > Nova implantacao`.
2. Escolha `App da Web`.
3. Execute como: sua conta com acesso a planilha e ao GitHub.
4. Quem tem acesso: a opcao interna mais restrita que funcione para o time.
5. Copie a URL terminada em `/exec`.
6. Configure no Vercel:

```text
EVENTS_STORAGE=apps_script
EVENTS_APPS_SCRIPT_URL=<url_do_web_app>
EVENT_MUTATIONS_ENABLED=1
```

Com isso, o navegador continua chamando `/api/events`; o backend chama o Apps Script; o Apps Script grava na planilha e atualiza `data/eventos_manuais.json` no GitHub.
