/* PROFITTO TV DASHBOARDS — funções compartilhadas
   Parser de números BR (R$ 1.234,56 / (negativo) / "-") + busca ao vivo do Google Sheets. */

function parseNumBR(raw) {
  if (raw === undefined || raw === null) return 0;
  let s = String(raw).trim();
  if (s === '' || s === '-' || s === '—') return 0;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  s = s.replace(/R\$/gi, '').replace(/%/g, '').replace(/\s/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
}

function fmtBRL(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + 'R$ ' + abs.toLocaleString('pt-BR');
}

function fmtNum(n, decimals) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
}

/* Formato abreviado para caber grande na TV: R$ 1,5M / R$ 345K / -R$ 5K */
function fmtBRLShort(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000000) return sign + 'R$ ' + (abs / 1000000).toFixed(1).replace('.', ',') + 'M';
  if (abs >= 1000) return sign + 'R$ ' + Math.round(abs / 1000) + 'K';
  return sign + 'R$ ' + Math.round(abs);
}

/* Monta a barra de progresso em relação à meta (0% a 100%, com marcador de meta na ponta) */
/* Cor proporcional ao andamento da meta: vermelho (déficit/longe) -> amarelo -> verde (meta batida) */
function barColor(signedPct) {
  if (signedPct <= 0) return '#c33f30';
  const t = Math.max(0, Math.min(1, signedPct / 100));
  const hue = t * 120; // 0 = vermelho, 60 = amarelo, 120 = verde
  return 'hsl(' + hue.toFixed(0) + ', 68%, 44%)';
}

function progressBar(real, meta) {
  const widthPct = meta ? Math.max(0, Math.min(100, (Math.abs(real) / meta) * 100)) : 0;
  const signedPct = meta ? (real / meta) * 100 : 0;
  const color = barColor(signedPct);
  return '<div class="bar-track"><div class="bar-fill" style="width:' + widthPct + '%;background:' + color + '"></div>' +
    '<div class="bar-dot" style="border-color:' + color + '"></div><div class="bar-goal"></div></div>';
}

/* Cabeçalho/navegação compartilhado entre as 3 telas */
function renderNav(active) {
  const host = document.getElementById('navHost');
  if (!host) return;
  const tabs = [
    { key: 'captacao', label: 'CAPTAÇÃO', href: 'captacao.html' },
    { key: 'intensidade', label: 'INTENSIDADE', href: 'intensidade.html' },
    { key: 'campanha', label: 'RANKING', href: 'campanha.html' }
  ];
  const tabsHtml = tabs.map(t =>
    '<a class="navtab' + (t.key === active ? ' active' : '') + '" href="' + t.href + '">' + t.label + '</a>'
  ).join('');
  host.innerHTML =
    '<div class="topbar">' +
    '  <div class="brand"><img class="brand-logo" src="logo.png?v=1" alt="PROFITTO · BTG Pactual"></div>' +
    '  <div class="navtabs">' + tabsHtml + '</div>' +
    '  <div class="meta"><div class="clock" id="clock">--</div><div class="upd">ÚLTIMA ATUALIZAÇÃO<br><b id="lastUpdate">--</b></div></div>' +
    '</div>';
}

/* Busca dados de uma aba do Google Sheets via JSONP (tag <script>), evitando bloqueios de CORS
   que ocorrem com fetch() direto no navegador para o endpoint gviz. Retorna um array de arrays
   (linhas x colunas) de strings, na mesma ordem das colunas da planilha (A, B, C...). */
function fetchSheetRows(sheetId, tabName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = '__gvizCb_' + Math.random().toString(36).slice(2);
    const scriptId = cbName + '_s';
    let finished = false;

    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      const s = document.getElementById(scriptId);
      if (s) s.remove();
    }

    window[cbName] = function (response) {
      finished = true;
      cleanup();
      try {
        if (!response || response.status === 'error') {
          const msg = (response && response.errors && response.errors[0] && response.errors[0].detailed_message) || 'Erro ao consultar a planilha';
          reject(new Error(msg));
          return;
        }
        const table = response.table;
        const rows = (table.rows || []).map(r =>
          (r.c || []).map(cell => {
            if (cell === null || cell === undefined) return '';
            if (cell.f !== undefined && cell.f !== null) return String(cell.f);
            if (cell.v !== undefined && cell.v !== null) return String(cell.v);
            return '';
          })
        );
        resolve(rows);
      } catch (e) {
        reject(e);
      }
    };

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json;responseHandler:' + cbName +
      '&sheet=' + encodeURIComponent(tabName) + '&_=' + Date.now();
    script.onerror = function () {
      if (finished) return;
      cleanup();
      reject(new Error('Não foi possível carregar a planilha. Verifique se ela está compartilhada como "Qualquer pessoa com o link – Leitor".'));
    };
    document.body.appendChild(script);

    setTimeout(function () {
      if (!finished) {
        cleanup();
        reject(new Error('Tempo esgotado ao buscar dados da planilha.'));
      }
    }, timeoutMs || 15000);
  });
}

/* Busca o valor de UMA célula específica (ex: 'H1') de uma aba do Google Sheets, via a mesma
   técnica JSONP. Usada para puxar carimbos de data/hora escritos manualmente na planilha (ex:
   "última atualização"), em vez do horário do navegador. */
function fetchSheetCell(sheetId, tabName, range, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = '__gvizCb_' + Math.random().toString(36).slice(2);
    const scriptId = cbName + '_s';
    let finished = false;

    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      const s = document.getElementById(scriptId);
      if (s) s.remove();
    }

    window[cbName] = function (response) {
      finished = true;
      cleanup();
      try {
        if (!response || response.status === 'error') {
          reject(new Error('Erro ao consultar célula'));
          return;
        }
        const rows = response.table.rows || [];
        const cell = rows[0] && rows[0].c && rows[0].c[0];
        if (!cell) { resolve(''); return; }
        const val = (cell.f !== undefined && cell.f !== null) ? cell.f : (cell.v !== undefined && cell.v !== null ? cell.v : '');
        resolve(String(val));
      } catch (e) {
        reject(e);
      }
    };

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json;responseHandler:' + cbName +
      '&sheet=' + encodeURIComponent(tabName) + '&range=' + encodeURIComponent(range) + '&_=' + Date.now();
    script.onerror = function () {
      if (finished) return;
      cleanup();
      reject(new Error('Não foi possível carregar a célula.'));
    };
    document.body.appendChild(script);

    setTimeout(function () {
      if (!finished) {
        cleanup();
        reject(new Error('Tempo esgotado ao buscar célula.'));
      }
    }, timeoutMs || 15000);
  });
}

function medal(pos) {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return pos;
}

function setLastUpdate(customText) {
  const el = document.getElementById('lastUpdate');
  if (!el) return;
  if (customText && customText.trim() !== '') {
    el.textContent = customText.trim();
    return;
  }
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  el.textContent = dd + '/' + mm + ' ' + hh + 'h' + mi;
}

function startClock(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  function tick() {
    const d = new Date();
    el.textContent = d.toLocaleTimeString('pt-BR');
  }
  tick();
  setInterval(tick, 1000);
}
