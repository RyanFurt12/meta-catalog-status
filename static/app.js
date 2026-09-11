/* MetaCatalogMatch — filtros, agregação e gráficos. SVG montado à mão. */

'use strict';

var nf = new Intl.NumberFormat('pt-BR');
var pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

var state = {
  payload: null,
  splitSource: true,        // separar as séries por fonte de evento
  threshold: 90,
  sort: { key: 'date', dir: 'desc' }
};

// Ordem fixa de cores por fonte: a cor segue a entidade, não a posição dela
// na lista filtrada.
var SOURCE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

// Últimos N dias da janela ainda estão consolidando na Meta e costumam subir.
var PROVISIONAL_DAYS = 3;

var RAMP_LIGHT = ['#e3edfa', '#c2d9f4', '#93bcea', '#5f9ae0', '#2a78d6', '#1b56a0'];
var RAMP_DARK  = ['#15304f', '#1b4272', '#245c9c', '#3070c4', '#3987e5', '#7fb3ee'];
var RAMP_INK_LIGHT = ['#0b0b0b', '#0b0b0b', '#0b0b0b', '#ffffff', '#ffffff', '#ffffff'];
var RAMP_INK_DARK  = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#0b0b0b'];

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function isDark() {
  var attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------- métricas */

function rate(matched, unmatched) {
  var den = matched + unmatched;
  return den > 0 ? (matched / den) * 100 : null;
}

/* -------------------------------------------------------------- coleta */

function setStatus(msg, busy) {
  var node = $('collect-status');
  node.innerHTML = '';
  if (busy) node.appendChild(el('span', 'spin'));
  node.appendChild(document.createTextNode(msg || ''));
}

function showError(err) {
  var box = $('collect-error');
  box.innerHTML = '';
  var strong = el('strong', null, 'A coleta falhou.');
  box.appendChild(strong);
  box.appendChild(el('p', null, err.message || 'Erro desconhecido.'));
  if (err.hint) {
    var hint = el('p');
    hint.innerHTML = '<strong>O que isso costuma significar:</strong> ' + esc(err.hint);
    box.appendChild(hint);
  }
  var bits = [];
  if (err.type) bits.push('tipo ' + err.type);
  if (err.code !== undefined && err.code !== null) bits.push('código ' + err.code);
  if (err.subcode) bits.push('subcódigo ' + err.subcode);
  if (err.http_status) bits.push('HTTP ' + err.http_status);
  if (err.endpoint) bits.push('endpoint ' + err.endpoint);
  if (bits.length) box.appendChild(el('p', 'mut', bits.join(' · ')));
  box.classList.remove('hidden');
}

function clearError() { $('collect-error').classList.add('hidden'); }

function collect(ev) {
  ev.preventDefault();
  clearError();
  setStatus('consultando a Graph API…', true);
  $('btn-collect').disabled = true;

  var body = {
    catalog_id: $('catalog_id').value.trim(),
    access_token: $('access_token').value.trim()
  };

  fetch('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  }).then(function (r) {
    $('btn-collect').disabled = false;
    if (!r.ok) { setStatus(''); showError((r.data && r.data.error) || {}); return; }
    setStatus('');
    load(r.data);
  }).catch(function (e) {
    $('btn-collect').disabled = false;
    setStatus('');
    showError({ message: 'Não consegui falar com o servidor local: ' + e.message });
  });
}

/* -------------------------------------------------------------- filtros */

function load(payload) {
  state.payload = payload;
  buildFilterOptions();
  $('filters').classList.remove('hidden');
  ['s-state', 's-kpi', 's-series', 's-heat', 's-table'].forEach(function (id) {
    $(id).classList.remove('hidden');
  });
  $('form-section').classList.add('hidden');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function uniqueSorted(rows, key) {
  var seen = {};
  rows.forEach(function (r) { if (r[key]) seen[r[key]] = true; });
  return Object.keys(seen).sort();
}

function buildFilterOptions() {
  var rows = state.payload.event_stats || [];
  var win = state.payload.meta.window || {};

  $('f-from').value = win.min_date || '';
  $('f-to').value = win.max_date || '';
  if (win.min_date) { $('f-from').min = win.min_date; $('f-to').min = win.min_date; }
  if (win.max_date) { $('f-from').max = win.max_date; $('f-to').max = win.max_date; }

  fillSelect($('f-event'), uniqueSorted(rows, 'event'), 'todos');

  var sources = {};
  rows.forEach(function (r) { if (r.source_id) sources[r.source_id] = r.source_name || r.source_id; });
  var sel = $('f-source');
  sel.innerHTML = '';
  sel.appendChild(new Option('todas', ''));
  Object.keys(sources).sort().forEach(function (id) {
    sel.appendChild(new Option(sources[id] + (sources[id] === id ? '' : ' (' + id + ')'), id));
  });
}

function fillSelect(sel, values, allLabel) {
  sel.innerHTML = '';
  sel.appendChild(new Option(allLabel, ''));
  values.forEach(function (v) { sel.appendChild(new Option(v, v)); });
}

function filtered() {
  var rows = (state.payload && state.payload.event_stats) || [];
  var from = $('f-from').value, to = $('f-to').value;
  var ev = $('f-event').value, src = $('f-source').value;
  return rows.filter(function (r) {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (ev && r.event !== ev) return false;
    if (src && r.source_id !== src) return false;
    return true;
  });
}

function provisionalDates() {
  var all = uniqueSorted(state.payload.event_stats || [], 'date');
  return all.slice(Math.max(0, all.length - PROVISIONAL_DAYS));
}

/* --------------------------------------------------------------- render */

function render() {
  if (!state.payload) return;
  var rows = filtered();
  renderSummary(rows);
  renderState(rows);
  renderKpi(rows);
  renderSeries(rows);
  renderHeatmap(rows);
  renderTable(rows);
}

function renderSummary(rows) {
  var days = uniqueSorted(rows, 'date').length;
  $('filter-summary').textContent = nf.format(rows.length) + ' linhas · ' + days + ' dia(s)';
}

function renderState(rows) {
  var meta = state.payload.meta;
  var box = $('state-body');
  box.innerHTML = '';

  var tiles = el('div', 'tiles');
  tiles.appendChild(tile('Catálogo', meta.catalog_id || '—', 'Graph API ' + (meta.graph_version || '')));
  var win = meta.window || {};
  tiles.appendChild(tile('Janela disponível', (win.days || 0) + ' dias',
    win.min_date ? win.min_date + ' → ' + win.max_date : 'sem dados'));

  // Atraso real do dado, medido — a Meta consolida com defasagem própria.
  var lagLabel = '—', lagNote = 'sem dados', lagCls = '';
  if (win.max_date) {
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var ultimo = new Date(win.max_date + 'T00:00:00');
    var dias = Math.round((hoje - ultimo) / 86400000);
    lagLabel = 'D-' + dias;
    lagNote = 'dado mais recente: ' + win.max_date;
    if (dias === 0) { lagLabel = 'D0'; lagNote += ' — hoje já aparece, mas ainda incompleto'; }
    else if (dias >= 3) lagCls = 'warn-gap';
  }
  tiles.appendChild(tile('Frescor do dado', lagLabel, lagNote, lagCls));
  tiles.appendChild(tile('Coletado em', (meta.fetched_at || '').replace('T', ' ').slice(0, 19), 'horário local'));
  var prov = provisionalDates();
  tiles.appendChild(tile('Dias provisórios', prov.length ? prov.join(', ') : '—',
    'ainda consolidando na Meta — tendem a subir'));
  box.appendChild(tiles);

  if (prov.length) {
    var c = el('div', 'callout warn');
    c.innerHTML = '<strong>Não leia queda nos últimos dias como quebra.</strong> A Meta consolida ' +
      'os eventos com atraso; ' + esc(prov.join(', ')) + ' ainda podem subir. Nos gráficos eles ' +
      'aparecem com marcador vazado.';
    box.appendChild(c);
  }

  if (meta.warnings && meta.warnings.length) {
    var w = el('div', 'callout no-c');
    w.appendChild(el('strong', null, 'Avisos da coleta'));
    var ul = el('ul');
    meta.warnings.forEach(function (t) { ul.appendChild(el('li', null, t)); });
    w.appendChild(ul);
    box.appendChild(w);
  }
}

function tile(k, v, n, cls) {
  var t = el('div', 'tile' + (cls ? ' ' + cls : ''));
  t.appendChild(el('div', 'k', k));
  t.appendChild(el('div', 'v', v));
  if (n) t.appendChild(el('div', 'n', n));
  return t;
}

function renderKpi(rows) {
  var m = 0, u = 0, o = 0;
  rows.forEach(function (r) { m += r.matched; u += r.unmatched; o += r.other; });
  var rt = rate(m, u);

  var box = $('kpi-tiles');
  box.innerHTML = '';

  var cls = rt === null ? '' : (rt < state.threshold ? 'big-gap' : (rt < state.threshold + 5 ? 'warn-gap' : ''));
  box.appendChild(tile('Match rate do recorte', rt === null ? '—' : pf.format(rt) + '%',
    nf.format(m) + ' com match de ' + nf.format(m + u), cls));
  box.appendChild(tile('Content_ids sem match', nf.format(u),
    'ocorrências', u > 0 ? 'warn-gap' : ''));

  // Quebra por fonte: compara os pixels sem precisar filtrar um por vez.
  var srcBox = $('kpi-sources');
  srcBox.innerHTML = '';
  var perSource = {};
  rows.forEach(function (r) {
    var acc = perSource[r.source_id] || (perSource[r.source_id] = { m: 0, u: 0, o: 0 });
    acc.m += r.matched; acc.u += r.unmatched; acc.o += r.other;
  });
  var srcIds = Object.keys(perSource);
  if (srcIds.length > 1) {
    srcBox.appendChild(el('h3', null, 'Por fonte de evento'));
    var grid = el('div', 'tiles');
    allSources().forEach(function (s) {
      var acc = perSource[s.id];
      if (!acc) return;
      var sr = rate(acc.m, acc.u);
      var t = tile(s.name, sr === null ? '—' : pf.format(sr) + '%',
        nf.format(acc.u) + ' sem match' + (acc.o ? ' · ' + nf.format(acc.o) + ' em outro catálogo' : ''),
        sr !== null && sr < state.threshold ? 'big-gap' : '');
      t.style.borderLeft = '3px solid ' + s.color;
      grid.appendChild(t);
    });
    srcBox.appendChild(grid);
  }

  var alerts = $('kpi-alerts');
  alerts.innerHTML = '';
  if (o > 0) {
    var a = el('div', 'callout no-c');
    a.innerHTML = '<strong>⚠ ' + nf.format(o) + ' content_ids casaram com OUTRO catálogo.</strong> ' +
      'Isso costuma ser pixel apontando para o catálogo errado, ou catálogos duplicados no mesmo ' +
      'Business. Veja a coluna <em>outro catálogo</em> na tabela para achar o dia e a fonte.';
    alerts.appendChild(a);
  }
  if (rt !== null && rt < state.threshold) {
    var b = el('div', 'callout no-c');
    b.innerHTML = '<strong>⚠ Match rate abaixo do seu limiar</strong> (' +
      pf.format(rt) + '% vs ' + state.threshold + '%) no recorte selecionado.';
    alerts.appendChild(b);
  }
}

/* --------------------------------------------- séries (small multiples) */

function allSources() {
  var names = {};
  ((state.payload && state.payload.event_stats) || []).forEach(function (r) {
    names[r.source_id] = r.source_name || r.source_id;
  });
  return Object.keys(names).sort().map(function (id, i) {
    return { id: id, name: names[id], color: SOURCE_COLORS[i] || 'var(--neutral)' };
  });
}

/* Devolve { evento: { chaveSerie: { data: {...} } } }. Com fontes somadas a
   chave é '*', então o resto do render não precisa saber em que modo está. */
function seriesByEventSource(rows) {
  var split = state.splitSource;
  var out = {};
  rows.forEach(function (r) {
    var e = out[r.event] || (out[r.event] = {});
    var key = split ? r.source_id : '*';
    var s = e[key] || (e[key] = {});
    var d = s[r.date] || (s[r.date] = { matched: 0, unmatched: 0, other: 0 });
    d.matched += r.matched; d.unmatched += r.unmatched; d.other += r.other;
  });
  return out;
}

/* Evento que nunca traz content_id (Lead, Subscribe…) não tem match a medir e
   sai dos gráficos — mas nunca da tabela. Cuidado: "sem content_id" é
   matched + unmatched === 0; matched 0 com unmatched 500 é 0% e tem de aparecer. */
function seriesHasContentIds(dateMap) {
  return Object.keys(dateMap).some(function (d) {
    return (dateMap[d].matched + dateMap[d].unmatched) > 0;
  });
}

function pruneEmptyEvents(nested) {
  var kept = {}, dropped = [];
  Object.keys(nested).forEach(function (ev) {
    var keys = Object.keys(nested[ev]).filter(function (k) {
      return seriesHasContentIds(nested[ev][k]);
    });
    if (!keys.length) { dropped.push(ev); return; }
    var o = {};
    keys.forEach(function (k) { o[k] = nested[ev][k]; });
    kept[ev] = o;
  });
  return { data: kept, dropped: dropped.sort() };
}

function droppedNote(dropped) {
  var n = el('p', 'note-drop');
  n.innerHTML = '<b>' + dropped.length + ' evento(s) ocultado(s)</b> por não trazerem ' +
    '<code>content_id</code> nenhum na janela: ' + esc(dropped.join(', ')) +
    '. Sem content_id não há match a medir. Eles continuam na tabela de detalhe.';
  return n;
}

function seriesMeta(key) {
  if (key === '*') return { name: 'todas as fontes', color: 'var(--s1)' };
  var found = allSources().filter(function (s) { return s.id === key; })[0];
  return found || { name: key, color: 'var(--neutral)' };
}

function renderSeries(rows) {
  var wrap = $('series-panels');
  wrap.innerHTML = '';
  var legendBox = $('series-legend');
  legendBox.innerHTML = '';

  var pruned = pruneEmptyEvents(seriesByEventSource(rows));
  var byEvent = pruned.data;
  var events = Object.keys(byEvent).sort();
  if (!events.length) {
    wrap.appendChild(el('div', 'empty-state',
      pruned.dropped.length
        ? 'Nenhum evento com content_id no recorte atual.'
        : 'Nenhuma linha no recorte atual.'));
    if (pruned.dropped.length) wrap.appendChild(droppedNote(pruned.dropped));
    return;
  }

  var dates = uniqueSorted(rows, 'date');
  var prov = provisionalDates();

  // Legenda única acima da grade: as cores são as mesmas em todos os painéis.
  var keys = {};
  events.forEach(function (e) { Object.keys(byEvent[e]).forEach(function (k) { keys[k] = true; }); });
  var seriesKeys = Object.keys(keys).sort();
  if (state.splitSource && seriesKeys.length > 1) {
    var lg = el('div', 'legend');
    seriesKeys.forEach(function (k) {
      var m = seriesMeta(k);
      var sp = el('span');
      var i = el('i'); i.style.background = m.color;
      sp.appendChild(i);
      sp.appendChild(document.createTextNode(m.name));
      lg.appendChild(sp);
    });
    legendBox.appendChild(lg);
  }

  events.forEach(function (evName) {
    var series = seriesKeys.filter(function (k) { return byEvent[evName][k]; }).map(function (k) {
      var m = seriesMeta(k);
      return {
        key: k, name: m.name, color: m.color,
        points: dates.map(function (d) {
          var v = byEvent[evName][k][d];
          return {
            date: d,
            rate: v ? rate(v.matched, v.unmatched) : null,
            matched: v ? v.matched : 0,
            unmatched: v ? v.unmatched : 0,
            other: v ? v.other : 0,
            provisional: prov.indexOf(d) !== -1
          };
        })
      };
    });

    var anyValid = series.some(function (s) {
      return s.points.some(function (p) { return p.rate !== null; });
    });

    var panel = el('div', 'sm-panel');
    panel.appendChild(el('h4', null, evName));

    var cap = el('p', 'cap');
    if (anyValid) {
      cap.innerHTML = series.map(function (s) {
        var valid = s.points.filter(function (p) { return p.rate !== null; });
        if (!valid.length) return '';
        var avg = valid.reduce(function (a, p) { return a + p.rate; }, 0) / valid.length;
        var below = valid.filter(function (p) {
          return p.rate < state.threshold && !p.provisional;
        }).length;
        var label = (state.splitSource && series.length > 1) ? esc(s.name) + ': ' : '';
        return label + 'média <b>' + pf.format(avg) + '%</b>' +
          (below ? ' · <span class="no">⚠ ' + below + ' dia(s) abaixo</span>'
                 : ' · <span class="yes">✓</span>');
      }).filter(Boolean).join('<br>');
    } else {
      cap.textContent = 'sem dados no recorte';
    }
    panel.appendChild(cap);

    panel.appendChild(anyValid ? lineChart(dates, series, evName)
                               : el('div', 'empty-state', 'sem dados'));
    wrap.appendChild(panel);
  });

  if (pruned.dropped.length) legendBox.appendChild(droppedNote(pruned.dropped));
}

function lineChart(dates, series, label) {
  var multi = series.length > 1;
  var W = 340, H = 150, PL = 34, PR = multi ? 60 : 10, PT = 10, PB = 22;
  var iw = W - PL - PR, ih = H - PT - PB;
  var n = dates.length;

  var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
    'aria-label': 'Match rate diário de ' + label });

  function x(i) { return n <= 1 ? PL + iw / 2 : PL + (i / (n - 1)) * iw; }
  function y(v) { return PT + (1 - v / 100) * ih; }

  // grade a cada 25%, recessiva
  [0, 25, 50, 75, 100].forEach(function (v) {
    svg.appendChild(svgEl('line', { class: 'grid-line', x1: PL, x2: PL + iw, y1: y(v), y2: y(v) }));
    var t = svgEl('text', { class: 'tick', x: PL - 5, y: y(v) + 3.5, 'text-anchor': 'end' });
    t.textContent = v + '%';
    svg.appendChild(t);
  });

  // limiar do usuário
  svg.appendChild(svgEl('line', { class: 'thr-line', x1: PL, x2: PL + iw,
    y1: y(state.threshold), y2: y(state.threshold) }));

  // onde não há dado a linha corta, em vez de interpolar por cima do buraco
  series.forEach(function (s) {
    var seg = [], segs = [];
    s.points.forEach(function (p, i) {
      if (p.rate === null) { if (seg.length) { segs.push(seg); seg = []; } }
      else seg.push([x(i), y(p.rate)]);
    });
    if (seg.length) segs.push(seg);
    segs.forEach(function (g) {
      if (g.length === 1) {
        svg.appendChild(svgEl('circle', { cx: g[0][0], cy: g[0][1], r: 3, fill: s.color }));
        return;
      }
      svg.appendChild(svgEl('path', { class: 'series-line', stroke: s.color,
        d: g.map(function (pt, i) {
          return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1);
        }).join(' ') }));
    });

    // marcadores: vermelho = abaixo do limiar; vazado = dia provisório
    s.points.forEach(function (p, i) {
      if (p.rate === null) return;
      if (p.provisional) {
        svg.appendChild(svgEl('circle', { class: 'dot-prov', cx: x(i), cy: y(p.rate), r: 4,
          stroke: p.rate < state.threshold ? 'var(--critical)' : s.color }));
      } else if (p.rate < state.threshold) {
        svg.appendChild(svgEl('circle', { class: 'dot-bad', cx: x(i), cy: y(p.rate), r: 4.5 }));
      }
    });
  });

  // rótulo no fim da linha, afastado verticalmente quando duas se encostam
  if (multi) {
    var ends = series.map(function (s) {
      for (var i = s.points.length - 1; i >= 0; i--) {
        if (s.points[i].rate !== null) return { s: s, i: i, y: y(s.points[i].rate) };
      }
      return null;
    }).filter(Boolean).sort(function (a, b) { return a.y - b.y; });

    for (var k = 1; k < ends.length; k++) {
      if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
    }
    ends.forEach(function (e) {
      var t = svgEl('text', { class: 'tick', x: x(e.i) + 5, y: e.y + 3.5,
        'text-anchor': 'start', fill: e.s.color });
      t.textContent = shortName(e.s.name);
      svg.appendChild(t);
    });
  }

  // eixo x: primeiro e último rótulo, para não colidir
  svg.appendChild(svgEl('line', { class: 'axis-line', x1: PL, x2: PL + iw, y1: PT + ih, y2: PT + ih }));
  if (n) {
    [[0, 'start'], [n - 1, 'end']].forEach(function (pair) {
      if (n === 1 && pair[0] === n - 1) return;
      var t = svgEl('text', { class: 'tick', x: x(pair[0]), y: H - 6, 'text-anchor': pair[1] });
      t.textContent = shortDate(dates[pair[0]]);
      svg.appendChild(t);
    });
  }

  // camada de hover: um crosshair, um ponto de foco por série
  var cross = svgEl('line', { class: 'crosshair', y1: PT, y2: PT + ih, x1: 0, x2: 0, opacity: 0 });
  svg.appendChild(cross);
  var focuses = series.map(function (s) {
    var c = svgEl('circle', { r: 5, fill: s.color, stroke: 'var(--surface-1)',
      'stroke-width': 2, opacity: 0 });
    svg.appendChild(c);
    return c;
  });

  var hit = svgEl('rect', { class: 'hit', x: PL, y: PT, width: iw, height: ih });
  svg.appendChild(hit);

  hit.addEventListener('mousemove', function (e) {
    var box = svg.getBoundingClientRect();
    var px = (e.clientX - box.left) / box.width * W;
    var idx = n <= 1 ? 0 : Math.round(((px - PL) / iw) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx));
    cross.setAttribute('opacity', 1);

    var prov = false;
    var lines = series.map(function (s, si) {
      var p = s.points[idx];
      if (!p || p.rate === null) {
        focuses[si].setAttribute('opacity', 0);
        return multi ? esc(s.name) + ': <span class="mut">sem evento</span>' : null;
      }
      if (p.provisional) prov = true;
      focuses[si].setAttribute('cx', x(idx));
      focuses[si].setAttribute('cy', y(p.rate));
      focuses[si].setAttribute('opacity', 1);
      return (multi ? esc(s.name) + ': ' : '') +
        '<span class="num">' + pf.format(p.rate) + '%</span>' +
        ' <span class="mut">(' + nf.format(p.matched) + ' com match, ' +
        nf.format(p.unmatched) + ' sem' + (p.other ? ', ' + nf.format(p.other) + ' em outro catálogo' : '') + ')</span>';
    }).filter(Boolean);

    if (!lines.length) lines = ['sem evento nesse dia'];
    showTip(e, '<strong>' + esc(label) + ' · ' + esc(dates[idx]) +
      (prov ? ' (provisório)' : '') + '</strong>' + lines.join('<br>'));
  });
  hit.addEventListener('mouseleave', function () {
    cross.setAttribute('opacity', 0);
    focuses.forEach(function (f) { f.setAttribute('opacity', 0); });
    hideTip();
  });

  return svg;
}

// Nome de pixel costuma ser longo; no rótulo do gráfico só cabe o que distingue.
function shortName(name) {
  var s = String(name).replace(/^Pixel\s*[-–]\s*/i, '');
  return s.length > 10 ? s.slice(0, 9) + '…' : s;
}

function svgEl(tag, attrs) {
  var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
  return n;
}
function shortDate(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }

/* -------------------------------------------------------------- heatmap */

function renderHeatmap(rows) {
  var wrap = $('heat-wrap');
  wrap.innerHTML = '';
  var legend = $('heat-legend');
  legend.innerHTML = '';

  // No modo separado cada linha do mapa é evento × fonte.
  var prunedHeat = pruneEmptyEvents(seriesByEventSource(rows));
  var nested = prunedHeat.data;
  var byEvent = {};
  Object.keys(nested).forEach(function (ev) {
    Object.keys(nested[ev]).forEach(function (k) {
      var label = (state.splitSource && k !== '*') ? ev + ' · ' + shortName(seriesMeta(k).name) : ev;
      byEvent[label] = nested[ev][k];
    });
  });

  var events = Object.keys(byEvent).sort();
  var dates = uniqueSorted(rows, 'date');
  if (!events.length || !dates.length) {
    wrap.appendChild(el('div', 'empty-state', 'Nenhuma linha no recorte atual.'));
    return;
  }

  var ramp = isDark() ? RAMP_DARK : RAMP_LIGHT;
  var inks = isDark() ? RAMP_INK_DARK : RAMP_INK_LIGHT;
  var prov = provisionalDates();

  // Match rate vive espremido perto de 100%: uma rampa 0–100 deixaria 92 e 98
  // da mesma cor. Ancoro o piso no percentil 10 (nunca acima do limiar) e o que
  // estiver abaixo satura no passo mais baixo — já tem contorno vermelho.
  var all = [];
  events.forEach(function (evName) {
    dates.forEach(function (d) {
      var v = byEvent[evName][d];
      var r = v ? rate(v.matched, v.unmatched) : null;
      if (r !== null) all.push(r);
    });
  });
  all.sort(function (a, b) { return a - b; });
  var p10 = all.length ? all[Math.floor(all.length * 0.10)] : 0;
  var lo = Math.max(0, Math.min(Math.floor(p10 / 5) * 5, Math.floor(state.threshold / 5) * 5));
  var span = Math.max(1, 100 - lo);

  function stepFor(r) {
    var t = (r - lo) / span;
    return Math.min(ramp.length - 1, Math.max(0, Math.floor(t * ramp.length)));
  }

  var table = el('table', 'heat');
  var thead = el('thead');
  var hr = el('tr');
  hr.appendChild(el('th', 'rowh', 'evento'));
  dates.forEach(function (d) {
    var th = el('th', null, shortDate(d));
    th.title = d + (prov.indexOf(d) !== -1 ? ' — provisório' : '');
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  var tbody = el('tbody');
  events.forEach(function (evName) {
    var tr = el('tr');
    tr.appendChild(el('th', 'rowh', evName));
    dates.forEach(function (d) {
      var v = byEvent[evName][d];
      var r = v ? rate(v.matched, v.unmatched) : null;
      var td = el('td');
      if (r === null) {
        td.className = 'empty';
        td.textContent = '–';
        td.title = evName + ' · ' + d + ' — sem evento';
      } else {
        var step = stepFor(r);
        td.style.background = ramp[step];
        td.style.color = inks[step];
        td.textContent = Math.round(r);
        if (r < state.threshold) td.classList.add('flag');
        var payload = v;
        td.addEventListener('mousemove', function (e) {
          showTip(e, '<strong>' + esc(evName) + ' · ' + esc(d) +
            (prov.indexOf(d) !== -1 ? ' (provisório)' : '') + '</strong>' +
            'match <span class="num">' + pf.format(r) + '%</span><br>' +
            'com match <span class="num">' + nf.format(payload.matched) + '</span><br>' +
            'sem match <span class="num">' + nf.format(payload.unmatched) + '</span>');
        });
        td.addEventListener('mouseleave', hideTip);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  var rampBox = el('div', 'ramp');
  ramp.forEach(function (c) { var i = el('i'); i.style.background = c; rampBox.appendChild(i); });
  legend.appendChild(el('span', null, '≤' + lo + '%'));
  legend.appendChild(rampBox);
  legend.appendChild(el('span', null, '100% de match'));
  legend.appendChild(el('span', null,
    '· escala ancorada em ' + lo + '% para não achatar a faixa útil · contorno vermelho = abaixo de ' +
    state.threshold + '% · “–” = sem evento'));
  if (prunedHeat.dropped.length) legend.appendChild(droppedNote(prunedHeat.dropped));
}

/* --------------------------------------------------------------- tabela */

var COLS = [
  { key: 'date', label: 'Data', l: true },
  { key: 'event', label: 'Evento', l: true },
  { key: 'source_name', label: 'Fonte', l: true },
  { key: 'matched', label: 'Com match', num: true },
  { key: 'unmatched', label: 'Sem match', num: true },
  { key: 'rate', label: 'Match %', num: true },
  { key: 'other', label: 'Outro catálogo', num: true }
];

function tableRows(rows) {
  return rows.map(function (r) {
    return {
      date: r.date, event: r.event, source_name: r.source_name, source_id: r.source_id,
      matched: r.matched, unmatched: r.unmatched, other: r.other,
      rate: rate(r.matched, r.unmatched)
    };
  });
}

function renderTable(rows) {
  var wrap = $('table-wrap');
  wrap.innerHTML = '';
  var data = tableRows(rows);
  if (!data.length) {
    wrap.appendChild(el('div', 'empty-state', 'Nenhuma linha no recorte atual.'));
    return;
  }

  var dir = state.sort.dir === 'asc' ? 1 : -1;
  var key = state.sort.key;
  data.sort(function (a, b) {
    var x = a[key], y = b[key];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });

  var table = el('table', 'data');
  var thead = el('thead'), hr = el('tr');
  COLS.forEach(function (c) {
    var th = el('th', c.l ? 'l' : '');
    th.appendChild(document.createTextNode(c.label + ' '));
    if (state.sort.key === c.key) {
      th.appendChild(el('span', 'arrow', state.sort.dir === 'asc' ? '▲' : '▼'));
    }
    th.addEventListener('click', function () {
      if (state.sort.key === c.key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.key = c.key; state.sort.dir = c.num ? 'desc' : 'asc'; }
      renderTable(filtered());
    });
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  var tbody = el('tbody');
  data.forEach(function (r) {
    var tr = el('tr');
    if (r.rate !== null && r.rate < state.threshold) tr.className = 'bad';
    COLS.forEach(function (c) {
      var td = el('td', c.l ? 'l' : '');
      var v = r[c.key];
      if (c.key === 'rate') {
        td.textContent = v === null ? '—' : pf.format(v) + '%';
        if (v !== null) td.className += ' ' + (v < state.threshold ? 'no' : 'yes');
      } else if (c.key === 'other') {
        td.textContent = nf.format(v);
        if (v > 0) td.className += ' no';
      } else if (c.num) {
        td.textContent = nf.format(v);
      } else {
        td.textContent = v;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

/* ------------------------------------------------------------- tooltip */

function showTip(e, html) {
  var tip = $('tooltip');
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  var pad = 14;
  var w = tip.offsetWidth, h = tip.offsetHeight;
  var x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { $('tooltip').classList.add('hidden'); }

/* ------------------------------------------------------------------ init */

function setSplit(on) {
  state.splitSource = on;
  $('src-split').setAttribute('aria-pressed', String(on));
  $('src-sum').setAttribute('aria-pressed', String(!on));
  render();
}

document.addEventListener('DOMContentLoaded', function () {
  $('collect-form').addEventListener('submit', collect);
  $('src-split').addEventListener('click', function () { setSplit(true); });
  $('src-sum').addEventListener('click', function () { setSplit(false); });

  ['f-from', 'f-to', 'f-event', 'f-source'].forEach(function (id) {
    $(id).addEventListener('change', render);
  });
  $('f-threshold').addEventListener('input', function () {
    var v = Number($('f-threshold').value);
    state.threshold = isNaN(v) ? 90 : Math.max(0, Math.min(100, v));
    render();
  });

  $('btn-reset').addEventListener('click', function () {
    buildFilterOptions();
    $('f-event').value = ''; $('f-source').value = '';
    render();
  });
  $('btn-new').addEventListener('click', function () {
    $('form-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (state.payload) renderHeatmap(filtered());
  });
});
