// ccc.js: the finance math for the ElectroMart CCC app.
// Every function here takes numbers or text and returns numbers or objects.
// None of them touch the page, so they can be checked with Node:
//   node -e "const c = require('./ccc.js'); console.log(c.dio(1200000, 6000000, 365))"

(function (root) {
  'use strict';

  // ---------- Reading CSV text ----------

  // Split one CSV line into fields. Handles quoted fields such as "a, b".
  function splitCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields.map(function (f) { return f.trim(); });
  }

  // Turn CSV text into an array of objects keyed by the header row.
  function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) throw new Error('The CSV file has no data rows.');
    const header = splitCsvLine(lines[0]);
    return lines.slice(1).map(function (line) {
      const values = splitCsvLine(line);
      const row = {};
      header.forEach(function (name, i) { row[name] = values[i] === undefined ? '' : values[i]; });
      return row;
    });
  }

  function toNumber(value, label) {
    const n = Number(String(value).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) throw new Error('Not a number for ' + label + ': "' + value + '"');
    return n;
  }

  // Statements CSV (section,item,before,after) -> { before: {item: n}, after: {item: n}, sections: {item: section} }
  function readStatements(text) {
    const out = { before: {}, after: {}, sections: {} };
    parseCsv(text).forEach(function (row) {
      out.before[row.item] = toNumber(row.before, row.item + ' (before)');
      out.after[row.item] = toNumber(row.after, row.item + ' (after)');
      out.sections[row.item] = row.section;
    });
    ['revenue', 'cogs', 'accounts_receivable', 'inventory', 'accounts_payable'].forEach(function (item) {
      if (!(item in out.before)) throw new Error('The statements CSV is missing the line "' + item + '".');
    });
    return out;
  }

  // Assumptions CSV (assumption,value,note) -> { days_in_year: 365, bank_rate: 0.08, ... }
  function readAssumptions(text) {
    const out = {};
    parseCsv(text).forEach(function (row) {
      out[row.assumption] = toNumber(row.value, row.assumption);
    });
    if (!(out.days_in_year > 0)) throw new Error('assumptions.csv needs a positive days_in_year.');
    return out;
  }

  // ---------- Day counts ----------

  // DIO = Inventory / COGS × days in year
  function dio(inventory, cogs, days) { return inventory / cogs * days; }

  // DSO = Accounts receivable / Revenue × days in year (all sales are on credit)
  function dso(receivables, revenue, days) { return receivables / revenue * days; }

  // DPO = Accounts payable / COGS × days in year (purchases equal COGS)
  function dpo(payables, cogs, days) { return payables / cogs * days; }

  // Cash conversion cycle = DIO + DSO − DPO
  function ccc(dioDays, dsoDays, dpoDays) { return dioDays + dsoDays - dpoDays; }

  // All four measures for one period's statements.
  function cycle(period, days) {
    const out = {
      dio: dio(period.inventory, period.cogs, days),
      dso: dso(period.accounts_receivable, period.revenue, days),
      dpo: dpo(period.accounts_payable, period.cogs, days)
    };
    out.ccc = ccc(out.dio, out.dso, out.dpo);
    return out;
  }

  // ---------- Cash freed ----------

  // A drop in an asset frees cash: before − after.
  function cashFreedByAsset(before, after) { return before - after; }

  // A rise in a liability (accounts payable) frees cash: after − before.
  function cashFreedByLiability(before, after) { return after - before; }

  // The same amount worked out from the days: days changed × annual base / days in year.
  // For an asset the days fall (before − after); for payables the days rise (after − before).
  function cashFromDays(daysChanged, annualBase, days) { return daysChanged * annualBase / days; }

  // Everything Part B shows, from the two CSVs' parsed contents.
  function analyze(statements, assumptions) {
    const days = assumptions.days_in_year;
    const b = statements.before;
    const a = statements.after;
    const before = cycle(b, days);
    const after = cycle(a, days);

    const levers = [
      {
        key: 'inventory', label: 'Inventory', kind: 'asset',
        before: b.inventory, after: a.inventory,
        cashFreed: cashFreedByAsset(b.inventory, a.inventory),
        fromDays: cashFromDays(before.dio - after.dio, b.cogs, days),
        daysLabel: 'DIO', daysBefore: before.dio, daysAfter: after.dio, baseLabel: 'COGS', base: b.cogs
      },
      {
        key: 'accounts_receivable', label: 'Accounts receivable', kind: 'asset',
        before: b.accounts_receivable, after: a.accounts_receivable,
        cashFreed: cashFreedByAsset(b.accounts_receivable, a.accounts_receivable),
        fromDays: cashFromDays(before.dso - after.dso, b.revenue, days),
        daysLabel: 'DSO', daysBefore: before.dso, daysAfter: after.dso, baseLabel: 'revenue', base: b.revenue
      },
      {
        key: 'accounts_payable', label: 'Accounts payable', kind: 'liability',
        before: b.accounts_payable, after: a.accounts_payable,
        cashFreed: cashFreedByLiability(b.accounts_payable, a.accounts_payable),
        fromDays: cashFromDays(after.dpo - before.dpo, b.cogs, days),
        daysLabel: 'DPO', daysBefore: before.dpo, daysAfter: after.dpo, baseLabel: 'COGS', base: b.cogs
      }
    ];
    const totalCashFreed = levers.reduce(function (sum, l) { return sum + l.cashFreed; }, 0);

    return { days: days, before: before, after: after, levers: levers, totalCashFreed: totalCashFreed };
  }

  // ---------- Levers (Part C) ----------
  // Revenue and COGS stay at their Before values. Each lever sets a number of days,
  // and the balance it implies is days × annual COGS (or revenue) / days in year.

  // The balance a number of days implies.
  function balanceFromDays(daysValue, annualBase, days) { return daysValue * annualBase / days; }

  // Interest saved each year = cash freed (up to the bank line's Before balance) × bank rate.
  // Negative cash freed means more borrowing, which shows as a negative saving.
  function interestSaved(cashFreed, bankLineBefore, rate) {
    return Math.min(cashFreed, bankLineBefore) * rate;
  }

  // Days paid past the due date = DPO − net days, never less than zero.
  function daysPastDue(dpoDays, netDays) { return Math.max(0, dpoDays - netDays); }

  // Nominal annual cost of skipping the supplier discount = d / (1 − d) × days in year / (days paid − discount days).
  // If DPO is within the discount period, ElectroMart takes the discount and there is no cost.
  function discountCost(dpoDays, discount, discountDays, days) {
    if (dpoDays <= discountDays) return { takesDiscount: true, rate: 0 };
    return { takesDiscount: false, rate: discount / (1 - discount) * days / (dpoDays - discountDays) };
  }

  // Everything the levers show, for chosen DIO, DSO and DPO.
  function scenario(statements, assumptions, chosen) {
    const days = assumptions.days_in_year;
    const b = statements.before;
    const balances = {
      inventory: balanceFromDays(chosen.dio, b.cogs, days),
      accounts_receivable: balanceFromDays(chosen.dso, b.revenue, days),
      accounts_payable: balanceFromDays(chosen.dpo, b.cogs, days)
    };
    const cashFreed = {
      inventory: cashFreedByAsset(b.inventory, balances.inventory),
      accounts_receivable: cashFreedByAsset(b.accounts_receivable, balances.accounts_receivable),
      accounts_payable: cashFreedByLiability(b.accounts_payable, balances.accounts_payable)
    };
    const totalCashFreed = cashFreed.inventory + cashFreed.accounts_receivable + cashFreed.accounts_payable;
    const bankLineBefore = b.notes_payable || 0;
    return {
      ccc: ccc(chosen.dio, chosen.dso, chosen.dpo),
      balances: balances,
      cashFreed: cashFreed,
      totalCashFreed: totalCashFreed,
      bankLineBefore: bankLineBefore,
      interestSaved: interestSaved(totalCashFreed, bankLineBefore, assumptions.bank_rate),
      daysPastDue: daysPastDue(chosen.dpo, assumptions.net_days),
      discount: discountCost(chosen.dpo, assumptions.supplier_discount, assumptions.discount_days, days)
    };
  }

  // ---------- Formatting ----------

  function formatDays(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatDollars(n) {
    const rounded = Math.round(n);
    const text = '$' + Math.abs(rounded).toLocaleString('en-US');
    return rounded < 0 ? '−' + text : text;
  }
  function formatNumber(n) {
    return Math.round(n).toLocaleString('en-US');
  }
  function formatPercent(rate) {
    const text = (Math.abs(rate) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    return rate < 0 && Math.round(rate * 10000) !== 0 ? '−' + text : text;
  }

  const api = {
    parseCsv: parseCsv, readStatements: readStatements, readAssumptions: readAssumptions,
    dio: dio, dso: dso, dpo: dpo, ccc: ccc, cycle: cycle,
    cashFreedByAsset: cashFreedByAsset, cashFreedByLiability: cashFreedByLiability, cashFromDays: cashFromDays,
    analyze: analyze,
    balanceFromDays: balanceFromDays, interestSaved: interestSaved, daysPastDue: daysPastDue,
    discountCost: discountCost, scenario: scenario,
    formatDays: formatDays, formatDollars: formatDollars, formatNumber: formatNumber, formatPercent: formatPercent
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCC = api;
})(this);
