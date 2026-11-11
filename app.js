// app.js: loads the CSVs, runs the math in ccc.js and fills in the page.
(function () {
  'use strict';

  const C = window.CCC;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function row(cells, headerFirst) {
    const tr = document.createElement('tr');
    cells.forEach(function (text, i) {
      const cell = el(i === 0 && headerFirst ? 'th' : 'td', text);
      if (i === 0 && headerFirst) cell.scope = 'row';
      tr.appendChild(cell);
    });
    return tr;
  }

  function signedDays(n) {
    const text = C.formatDays(Math.abs(n));
    if (Math.round(n * 100) === 0) return '0.00';
    return (n < 0 ? '−' : '+') + text;
  }

  function renderCycle(result, statements) {
    const tbody = document.querySelector('#cycle-table tbody');
    tbody.replaceChildren();
    const rows = [
      ['DIO (days inventory outstanding)', 'dio'],
      ['DSO (days sales outstanding)', 'dso'],
      ['DPO (days payables outstanding)', 'dpo'],
      ['Cash conversion cycle', 'ccc']
    ];
    rows.forEach(function (r) {
      const b = result.before[r[1]];
      const a = result.after[r[1]];
      const tr = row([r[0], C.formatDays(b), C.formatDays(a), signedDays(a - b)], true);
      if (r[1] === 'ccc') tr.className = 'total';
      tbody.appendChild(tr);
    });

    // Formulas with the numbers plugged in.
    const list = document.getElementById('cycle-math');
    list.replaceChildren();
    const d = result.days;
    ['before', 'after'].forEach(function (p) {
      const s = statements[p];
      const c = result[p];
      const name = p === 'before' ? 'Before' : 'After';
      [
        name + ': DIO = ' + C.formatNumber(s.inventory) + ' / ' + C.formatNumber(s.cogs) + ' × ' + d + ' = ' + C.formatDays(c.dio) + ' days',
        name + ': DSO = ' + C.formatNumber(s.accounts_receivable) + ' / ' + C.formatNumber(s.revenue) + ' × ' + d + ' = ' + C.formatDays(c.dso) + ' days',
        name + ': DPO = ' + C.formatNumber(s.accounts_payable) + ' / ' + C.formatNumber(s.cogs) + ' × ' + d + ' = ' + C.formatDays(c.dpo) + ' days',
        name + ': CCC = ' + C.formatDays(c.dio) + ' + ' + C.formatDays(c.dso) + ' − ' + C.formatDays(c.dpo) + ' = ' + C.formatDays(c.ccc) + ' days'
      ].forEach(function (t) { list.appendChild(el('li', t)); });
    });
  }

  function renderCash(result) {
    const tbody = document.querySelector('#cash-table tbody');
    const tfoot = document.querySelector('#cash-table tfoot');
    tbody.replaceChildren();
    tfoot.replaceChildren();
    result.levers.forEach(function (l) {
      tbody.appendChild(row([l.label, C.formatDollars(l.before), C.formatDollars(l.after), C.formatDollars(l.cashFreed)], true));
    });
    const total = row(['Total cash freed', '', '', C.formatDollars(result.totalCashFreed)], true);
    total.className = 'total';
    tfoot.appendChild(total);

    // Check: days changed × annual COGS (or revenue) / days in year.
    const list = document.getElementById('cash-math');
    list.replaceChildren();
    result.levers.forEach(function (l) {
      const changed = l.kind === 'asset'
        ? '(' + C.formatDays(l.daysBefore) + ' − ' + C.formatDays(l.daysAfter) + ')'
        : '(' + C.formatDays(l.daysAfter) + ' − ' + C.formatDays(l.daysBefore) + ')';
      list.appendChild(el('li',
        l.label + ': ' + changed + ' ' + l.daysLabel + ' days × ' + C.formatNumber(l.base) + ' ' + l.baseLabel +
        ' / ' + result.days + ' = ' + C.formatDollars(l.fromDays)));
    });
  }

  function fetchText(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ').');
      return res.text();
    });
  }

  // Register the service worker (sw.js) so the app installs and works offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker not registered:', err);
      });
    });
  }

  Promise.all([fetchText('data/electromart.csv'), fetchText('data/assumptions.csv')])
    .then(function (texts) {
      const statements = C.readStatements(texts[0]);
      const assumptions = C.readAssumptions(texts[1]);
      const result = C.analyze(statements, assumptions);
      document.getElementById('year-note').textContent = result.days + '-day year';
      renderCycle(result, statements);
      renderCash(result);
      document.getElementById('status').hidden = true;
      document.getElementById('cycle-section').hidden = false;
      document.getElementById('cash-section').hidden = false;
    })
    .catch(function (err) {
      const status = document.getElementById('status');
      status.textContent = 'Something went wrong: ' + err.message;
      status.className = 'status error';
    });
})();
