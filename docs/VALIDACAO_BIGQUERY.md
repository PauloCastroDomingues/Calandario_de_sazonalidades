# Validacao dos snapshots contra BigQuery

Este documento descreve o processo de homologacao dos dados antes de apresentar o MVP como base confiavel.

## Objetivo

Responder de forma objetiva:

```text
Os JSONs versionados em data/*.json batem com as fontes BigQuery no mesmo periodo?
```

Essa validacao e tecnica. Ela nao substitui o painel de qualidade do dashboard; ela serve para homologar os numeros contra a origem.

## Fluxo recomendado

1. Escolha um periodo fechado.
2. Rode o dry-run para estimar custo.
3. Rode a comparacao real.
4. Leia o relatorio em `docs/validacao/`.
5. Explique divergencias antes de apresentar.

## Periodos minimos antes de apresentar

Valide pelo menos:

- um mes fechado, por exemplo `2026-06-01` a `2026-06-30`;
- uma semana fechada;
- um dia especifico de alto volume.

## Configuracao

O script usa as mesmas variaveis do exportador local:

```text
BQ_PROJECT_ID=reise-ssot
BQ_CREDENTIALS_PATH=credentials/reise-bigquery-sa.json
BQ_MAX_BYTES_BILLED=3221225472
```

Se `BQ_CREDENTIALS_PATH` existir, o script usa a service account local. Se nao existir, tenta usar a credencial padrao do ambiente Google.

## Estimar custo antes

```bat
python scripts\validar_snapshot_bigquery.py --start-date 2026-06-01 --end-date 2026-06-30 --dry-run
```

Isso gera um relatorio sem comparar valores. Use para ver os bytes estimados por fonte.

Para reduzir bytes no primeiro teste:

```bat
python scripts\validar_snapshot_bigquery.py --start-date 2026-06-01 --end-date 2026-06-30 --sources kpis_dia funil_dia --dry-run
```

## Rodar comparacao real

```bat
python scripts\validar_snapshot_bigquery.py --start-date 2026-06-01 --end-date 2026-06-30
```

O relatorio padrao sai em:

```text
docs/validacao/VALIDACAO_DADOS_2026-06-30.md
```

## Ignorar estoque no primeiro ciclo

Estoque e uma foto do momento atual. Se a carga e a validacao forem feitas em dias diferentes, pode haver divergencia natural.

Para validar as fontes historicas primeiro:

```bat
python scripts\validar_snapshot_bigquery.py --start-date 2026-06-01 --end-date 2026-06-30 --skip-estoque
```

## Como interpretar

- `ok`: o JSON bate com BigQuery dentro da tolerancia.
- `revisar`: existe divergencia fora da tolerancia.
- `dry-run`: a consulta nao comparou valores, apenas estimou bytes.

Tolerancias principais:

- pedidos: precisa bater;
- receita: tolerancia pequena para arredondamento;
- investimento: tolerancia pequena para arredondamento;
- sessoes, impressoes e cliques: tolerancia percentual pequena;
- taxas, ROAS e ticket medio: recalculados a partir dos agregados.

## Fontes validadas

- `kpis_dia.json` contra `queries/kpis_dia.sql`;
- `funil_dia.json` contra `queries/funil_dia.sql`;
- `produtos_dia.json` contra `queries/produtos_dia.sql`;
- `campanhas_dia.json` contra `queries/campanhas_dia.sql`;
- `utms_dia.json` contra `queries/utms_dia.sql`;
- `estoque.json` contra `queries/estoque.sql`.

## Posicionamento para apresentacao

Enquanto a validacao nao estiver concluida, apresente como:

```text
MVP de prontidao comercial sazonal em validacao cruzada com BigQuery.
```

Depois de validar, pode evoluir para:

```text
MVP de prontidao comercial sazonal com snapshots D-1 homologados contra BigQuery.
```
