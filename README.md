# MetaCatalogMatch

Dash para analisar **match de catálogo do Meta** com granularidade que o Commerce
Manager não dá: por **dia × evento × fonte**, no intervalo que você escolher.

## Rodar local

```bash
python3 server.py
# http://127.0.0.1:8787
```

Só stdlib — nada para instalar. O `server.py` serve os estáticos e roteia
`/api/collect` para a mesma classe que roda como função na Vercel, então o que
você testa local é o que sobe.

## Deploy na Vercel

```bash
vercel        # preview
vercel --prod
```

Zero-config: `api/collect.py` vira a função `/api/collect`, `index.html` e
`static/` são servidos pelo CDN. Não há dependências, então não existe
`requirements.txt`.

> **Ligue a proteção de acesso antes de mandar para produção.** Sem ela a dash
> fica pública e qualquer pessoa com a URL abre o formulário. Em
> *Project → Settings → Deployment Protection*, ative **Vercel Authentication**
> (ou uma senha) para restringir quem entra.

## Token

Gere no [Graph API Explorer](https://developers.facebook.com/tools/explorer/) com
`catalog_management` **e `ads_read`**, para um usuário com acesso ao catálogo.

O `ads_read` não é opcional: o `event_stats` é documentado sob a Marketing API (a tabela de
erros dele inclui o código 270, *"not allowed for apps with development access level"*), e
por isso `catalog_management` sozinho devolve `(#100) subcode 33` — a mesma mensagem que a
Meta usa para "objeto não existe". O app também precisa do produto/caso de uso **Marketing
API** habilitado, senão o Explorer nem oferece o `ads_read` na lista.

O token vai no corpo do POST e não é gravado em disco nem em log. Rodando local
ele só sai da sua máquina para a Meta; **hospedado, ele trafega pela
infraestrutura da Vercel** — é o trade-off de ter a dash em uma URL.

## A limitação que importa

A edge `event_stats` **não aceita filtro de data**. Ela devolve uma janela fixa de ~28
dias corridos; o único parâmetro é `breakdowns`. Ou seja:

- Você recorta o intervalo à vontade **dentro** dessa janela, sem refazer a chamada.
- Uma coleta só **não alcança meses atrás**.
- Os últimos ~3 dias ainda estão consolidando na Meta e tendem a subir. A dash marca
  esses dias como provisórios (marcador vazado nos gráficos) para você não ler uma queda
  falsa.

## O que a dash mostra

| Seção | O que responde |
|---|---|
| Estado da coleta | janela disponível, dias provisórios, avisos da coleta |
| Resumo | match rate do recorte e content_ids sem match, por fonte |
| Match diário por evento | um painel por evento — *qual* evento quebrou e *em que dia*, uma linha por fonte |
| Mapa data × evento | heatmap para achar o dia da quebra de relance |
| Detalhe (última seção) | tabela ordenável por qualquer coluna |

Eventos que não trazem `content_id` nenhum na janela (Lead, Subscribe, Search…) saem dos
gráficos e do heatmap — sem content_id não há match a medir, e um painel achatado em zero
sugeriria problema onde não há. Eles continuam na tabela de detalhe, e a dash diz quantos
ocultou e quais. Atenção à distinção: um evento com 0 matched e 500 unmatched é 0% de
match, o pior caso real, e continua visível.

### Separar por fonte de evento

Um catálogo pode ter vários pixels associados. O botão **Separar / Somar** controla isso:
separado (padrão) desenha uma linha por fonte em cada painel, quebra o heatmap em
evento × fonte e mostra um KPI de match rate por pixel. É o que revela um pixel quebrado
enquanto o outro vai bem — na soma isso desaparece na média.

As cores das fontes são atribuídas a partir do payload inteiro, não do recorte filtrado:
filtrar um evento nunca repinta as séries que sobraram.

Filtros (data, evento, fonte, limiar) recalculam tudo no cliente.

Match rate = `matched / (matched + unmatched)` dos content_ids recebidos pelas fontes
associadas ao catálogo.

A coluna **outro catálogo** (`total_content_ids_matched_other_catalogs`) merece atenção:
quando é > 0, normalmente é pixel apontando para o catálogo errado, ou catálogos
duplicados no mesmo Business.

## Endpoint usado

- `GET /{catalog_id}/event_stats` — série diária de match por evento e fonte

A versão da Graph API é a constante `GRAPH_VERSION` em `api/collect.py`. Se a Meta
descontinuar a versão, é só trocar ali.

## Arquivos

```
api/collect.py       função serverless: Graph API + normalização
index.html           form e estrutura da dash
static/app.js        filtros, agregação, gráficos SVG (sem biblioteca)
static/styles.css    tokens de cor e layout
server.py            servidor local de dev (não sobe: está no .vercelignore)
vercel.json          duração da função
```
