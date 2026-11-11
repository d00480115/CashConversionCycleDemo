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

  // ---------- Levers ----------

  const LEVERS = [
    { key: 'dio', label: 'DIO (days inventory outstanding)' },
    { key: 'dso', label: 'DSO (days sales outstanding)' },
    { key: 'dpo', label: 'DPO (days payables outstanding)' }
  ];

  // The exact days the levers are set to. The inputs only display these, so
  // Set to Before and Set to After give exactly the days in the table.
  let chosen = null;

  function setupLevers(statements, assumptions, result) {
    const box = document.getElementById('levers');
    box.replaceChildren();
    LEVERS.forEach(function (lever) {
      const top = Math.max(result.before[lever.key], result.after[lever.key]);
      const max = Math.max(10, Math.ceil(top * 2 / 10) * 10);

      const wrap = el('div', undefined, 'lever');
      const label = el('label', lever.label);
      label.htmlFor = 'range-' + lever.key;
      const line = el('div', undefined, 'lever-line');

      const range = document.createElement('input');
      range.type = 'range';
      range.id = 'range-' + lever.key;
      range.min = '0';
      range.max = String(max);
      range.step = 'any';

      const number = document.createElement('input');
      number.type = 'number';
      number.id = 'number-' + lever.key;
      number.min = '0';
      number.step = 'any';
      number.inputMode = 'decimal';
      number.setAttribute('aria-label', lever.label + ' in days');

      range.addEventListener('input', function () {
        chosen[lever.key] = Number(range.value);
        update(statements, assumptions);
      });
      number.addEventListener('input', function () {
        const v = Number(number.value);
        if (number.value === '' || !Number.isFinite(v) || v < 0) return;
        chosen[lever.key] = v;
        update(statements, assumptions, lever.key);
      });

      line.appendChild(range);
      line.appendChild(number);
      line.appendChild(el('span', 'days', 'unit'));
      wrap.appendChild(label);
      wrap.appendChild(line);
      box.appendChild(wrap);
    });

    function setTo(period) {
      chosen = { dio: result[period].dio, dso: result[period].dso, dpo: result[period].dpo };
      update(statements, assumptions);
    }
    document.getElementById('set-before').onclick = function () { setTo('before'); };
    document.getElementById('set-after').onclick = function () { setTo('after'); };
    setTo('before');
  }

  // Redraw everything that depends on the levers. typingIn = the box the student is typing in, left alone.
  function update(statements, assumptions, typingIn) {
    LEVERS.forEach(function (lever) {
      document.getElementById('range-' + lever.key).value = String(chosen[lever.key]);
      if (lever.key !== typingIn) {
        document.getElementById('number-' + lever.key).value = (Math.round(chosen[lever.key] * 100) / 100).toFixed(2);
      }
    });

    const s = C.scenario(statements, assumptions, chosen);
    const b = statements.before;
    const days = assumptions.days_in_year;

    const tbody = document.querySelector('#lever-table tbody');
    const tfoot = document.querySelector('#lever-table tfoot');
    tbody.replaceChildren();
    tfoot.replaceChildren();
    [['inventory', 'Inventory'], ['accounts_receivable', 'Accounts receivable'], ['accounts_payable', 'Accounts payable']]
      .forEach(function (r) {
        tbody.appendChild(row([r[1], C.formatDollars(s.balances[r[0]]), C.formatDollars(s.cashFreed[r[0]])], true));
      });
    const total = row(['Total cash freed', '', C.formatDollars(s.totalCashFreed)], true);
    total.className = 'total';
    tfoot.appendChild(total);

    const results = document.getElementById('lever-results');
    results.replaceChildren();
    function result(term, value, note, className) {
      const div = el('div', undefined, className);
      div.appendChild(el('dt', term));
      div.appendChild(el('dd', value));
      if (note) div.appendChild(el('dd', note, 'note'));
      results.appendChild(div);
    }
    result('Cash conversion cycle', C.formatDays(s.ccc) + ' days', 'Before: ' + C.formatDays(C.cycle(b, days).ccc) + ' days', 'big');
    result('Interest saved each year', C.formatDollars(s.interestSaved),
      s.totalCashFreed < 0
        ? 'Cash freed is negative, so ElectroMart borrows more on the bank line. This is the extra interest at ' + C.formatPercent(assumptions.bank_rate) + '.'
        : 'Assumes every freed dollar pays down the bank line (Before balance ' + C.formatDollars(s.bankLineBefore) +
          ') at ' + C.formatPercent(assumptions.bank_rate) + '. The case\'s own After balance sheet shows part of the cash was kept as cash instead.');
    result('Days paid past the net-' + assumptions.net_days + ' due date', C.formatDays(s.daysPastDue) + ' days');
    result('Annual cost of skipping the ' + C.formatPercent(assumptions.supplier_discount) + ' discount',
      s.discount.takesDiscount ? 'Takes the discount' : C.formatPercent(s.discount.rate),
      s.discount.takesDiscount
        ? 'DPO is within the ' + assumptions.discount_days + '-day discount period, so ElectroMart pays early and keeps the discount.'
        : 'Nominal annual rate: the price of using suppliers\' money instead of paying within ' + assumptions.discount_days + ' days.');

    // Formulas with the numbers plugged in.
    const list = document.getElementById('lever-math');
    list.replaceChildren();
    const d = assumptions.supplier_discount;
    [
      'CCC = ' + C.formatDays(chosen.dio) + ' + ' + C.formatDays(chosen.dso) + ' − ' + C.formatDays(chosen.dpo) + ' = ' + C.formatDays(s.ccc) + ' days',
      'Inventory = ' + C.formatDays(chosen.dio) + ' × ' + C.formatNumber(b.cogs) + ' / ' + days + ' = ' + C.formatDollars(s.balances.inventory) +
        '; cash freed = ' + C.formatNumber(b.inventory) + ' − ' + C.formatNumber(s.balances.inventory) + ' = ' + C.formatDollars(s.cashFreed.inventory),
      'Receivables = ' + C.formatDays(chosen.dso) + ' × ' + C.formatNumber(b.revenue) + ' / ' + days + ' = ' + C.formatDollars(s.balances.accounts_receivable) +
        '; cash freed = ' + C.formatNumber(b.accounts_receivable) + ' − ' + C.formatNumber(s.balances.accounts_receivable) + ' = ' + C.formatDollars(s.cashFreed.accounts_receivable),
      'Payables = ' + C.formatDays(chosen.dpo) + ' × ' + C.formatNumber(b.cogs) + ' / ' + days + ' = ' + C.formatDollars(s.balances.accounts_payable) +
        '; cash freed = ' + C.formatNumber(s.balances.accounts_payable) + ' − ' + C.formatNumber(b.accounts_payable) + ' = ' + C.formatDollars(s.cashFreed.accounts_payable),
      'Interest saved = ' + (s.totalCashFreed > s.bankLineBefore ? 'min(' + C.formatNumber(s.totalCashFreed) + ', ' + C.formatNumber(s.bankLineBefore) + ')' : C.formatNumber(s.totalCashFreed)) +
        ' × ' + C.formatPercent(assumptions.bank_rate) + ' = ' + C.formatDollars(s.interestSaved),
      'Days past due = max(0, ' + C.formatDays(chosen.dpo) + ' − ' + assumptions.net_days + ') = ' + C.formatDays(s.daysPastDue),
      s.discount.takesDiscount
        ? 'Discount cost: DPO ' + C.formatDays(chosen.dpo) + ' ≤ ' + assumptions.discount_days + ' days, so ElectroMart takes the discount'
        : 'Discount cost = ' + d + ' / (1 − ' + d + ') × ' + days + ' / (' + C.formatDays(chosen.dpo) + ' − ' + assumptions.discount_days + ') = ' + C.formatPercent(s.discount.rate)
    ].forEach(function (t) { list.appendChild(el('li', t)); });
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
      setupLevers(statements, assumptions, result);
      document.getElementById('status').hidden = true;
      document.getElementById('levers-section').hidden = false;
      document.getElementById('cycle-section').hidden = false;
      document.getElementById('cash-section').hidden = false;
    })
    .catch(function (err) {
      const status = document.getElementById('status');
      status.textContent = 'Something went wrong: ' + err.message;
      status.className = 'status error';
    });
})();
