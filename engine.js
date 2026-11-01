// My Paycheck – pay engine for Tasmanian registrars (RHH).
// Rules reverse-engineered from real Tas Health payslips (Feb–Sep 2026).
// Pure functions, no DOM: can run in the browser or in Node for tests.

export const SALARY_TABLE = [
  // Medical Practitioners (Tas State Service) Agreement 2025, Schedule 1 (from 1 Jan 2026)
  { level: 'MP Level 5 (Registrar yr1)', salary: 138978 },
  { level: 'MP Level 6 (Registrar yr2)', salary: 146404 },
  { level: 'MP Level 7 (Registrar yr3)', salary: 152770 },
  { level: 'MP Level 8 (Registrar yr4)', salary: 159135 },
  { level: 'MP Level 9 (Registrar yr5)', salary: 180883 },
  { level: 'MP Level 10 (Registrar yr6)', salary: 189371 },
  { level: 'MP Level 11 (Senior Registrar)', salary: 194675 },
];

// Tasmanian public holidays observed by the Tas State Service in Hobart.
export const TAS_PUBLIC_HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-26': 'Australia Day', '2026-02-09': 'Royal Hobart Regatta',
  '2026-03-09': 'Eight Hours Day', '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday',
  '2026-04-07': 'Easter Tuesday', '2026-04-25': 'Anzac Day', '2026-06-08': "King's Birthday",
  '2026-10-22': 'Royal Hobart Show', '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day (observed)',
  '2027-01-01': "New Year's Day", '2027-01-26': 'Australia Day', '2027-02-08': 'Royal Hobart Regatta',
  '2027-03-08': 'Eight Hours Day', '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday',
  '2027-03-30': 'Easter Tuesday', '2027-06-14': "King's Birthday", '2027-10-21': 'Royal Hobart Show',
  '2027-12-27': 'Christmas Day (observed)', '2027-12-28': 'Boxing Day (observed)',
};

export const DEFAULT_RULES = {
  annualHoursDivisor: 2244.6,   // 43 h x 52.2 weeks: payroll's hourly-rate divisor
  fullTimeServiceHours: 76,     // per fortnight; beyond this = Excess Time (overtime)
  fullTimeTotalHours: 86,       // per fortnight incl. 10 h training time
  trainingPerAdditional: 5 / 38,// Training Time accrued on Additional Hours
  ordinaryStart: 7, ordinaryEnd: 19, // weekday ordinary-hours window
  penaltyAfterHours: 0.25, penaltyWeekend: 0.5, penaltyPublicHoliday: 1.5,
  otWeekday: 1.25, otWeekend: 1.5, otPublicHolidayWithin: 1.5, otPublicHolidayOutside: 2.5,
  otDoubleThreshold: 120, otDouble: 2.0,
  cpdRate: 1.46605,             // CPD allowance $ per paid hour (payslips Sep 2026: $1.47 shown)
  matchTolerance: 1.0,          // $ difference treated as a match
};

export const FN_ANCHOR = '2026-01-18'; // a payroll fortnight start (Sunday)

// ---------- date helpers (all dates are 'YYYY-MM-DD', treated as UTC days) ----------
const DAY = 86400000;
export const toDays = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
export const fromDays = (d) => new Date(d * DAY).toISOString().slice(0, 10);
export const addDays = (s, n) => fromDays(toDays(s) + n);
export const weekday = (s) => new Date(toDays(s) * DAY).getUTCDay(); // 0 = Sun
export function fortnightStart(dateStr) {
  const diff = toDays(dateStr) - toDays(FN_ANCHOR);
  return addDays(FN_ANCHOR, Math.floor(diff / 14) * 14);
}
export const fortnightEnd = (fnStart) => addDays(fnStart, 13);
export const payDateFor = (fnStart) => addDays(fnStart, 17); // Wednesday after the fortnight ends
export const isPublicHoliday = (dateStr, overrides = {}) =>
  dateStr in overrides ? !!overrides[dateStr] : dateStr in TAS_PUBLIC_HOLIDAYS;

const r2 = (x) => Math.round(x * 100) / 100;
const hm = (t) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };

export function profileOn(profiles, dateStr) {
  const sorted = [...profiles].sort((a, b) => a.from.localeCompare(b.from));
  let p = sorted[0];
  for (const q of sorted) if (q.from <= dateStr) p = q;
  return p;
}
export const hourlyRate = (profile, rules = DEFAULT_RULES) => profile.salary / rules.annualHoursDivisor;

// Split a shift into pieces at midnight and at the 07:00 / 19:00 boundaries.
export function shiftPieces(shift, rules = DEFAULT_RULES, phOverrides = {}) {
  let s = hm(shift.start), e = hm(shift.end);
  if (e <= s) e += 24;
  const total = e - s;
  const breakH = (shift.breakMins || 0) / 60;
  const scale = total > 0 ? Math.max(0, total - breakH) / total : 0;
  const cuts = [0, rules.ordinaryStart, rules.ordinaryEnd, 24, 24 + rules.ordinaryStart, 24 + rules.ordinaryEnd, 48];
  const pieces = [];
  let t = s;
  while (t < e - 1e-9) {
    const next = Math.min(e, cuts.find((c) => c > t + 1e-9));
    const date = addDays(shift.date, t >= 24 ? 1 : 0);
    const hod = t % 24;
    const wd = weekday(date);
    const ph = isPublicHoliday(date, phOverrides);
    const weekend = wd === 0 || wd === 6;
    const outside = hod < rules.ordinaryStart || hod >= rules.ordinaryEnd;
    pieces.push({ date, startH: t, hours: (next - t) * scale, ph, weekend, outside });
    t = next;
  }
  return pieces;
}

export const LEAVE_TYPES = {
  rec: 'Recreation Leave', sick: 'Sick Leave', pd: 'Professional Dev Lve', lwop: 'Leave Without Pay', other: 'Other Leave',
};

// Calculate what payroll should pay for one fortnight, split into payslip-style lines
// with the pay date each line is expected on.
export function calcFortnight(fnStart, allShifts, state, rules = DEFAULT_RULES) {
  const fnEnd = fortnightEnd(fnStart);
  const profile = profileOn(state.profiles, fnStart);
  const rate = hourlyRate(profile, rules);
  const fte = profile.fte;
  const cpdRate = profile.cpdRate ?? rules.cpdRate;
  const late = !!(state.lateFortnights || {})[fnStart];
  const basePay = payDateFor(fnStart);
  const extrasPay = addDays(basePay, late ? 28 : 14);
  const shifts = allShifts.filter((s) => s.date >= fnStart && s.date <= fnEnd)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const contractedTotal = rules.fullTimeTotalHours * fte;      // Normal Pay hours
  const contractedService = rules.fullTimeServiceHours * fte;  // service part of contracted hours

  // Leave
  const leave = {};
  for (const s of shifts.filter((x) => x.kind === 'leave')) leave[s.leaveType] = (leave[s.leaveType] || 0) + (+s.hours || 0);
  const leaveHours = Object.values(leave).reduce((a, b) => a + b, 0);

  // Work pieces in time order, classified by the running total of service hours
  const pieces = [];
  for (const s of shifts.filter((x) => x.kind === 'work')) pieces.push(...shiftPieces(s, rules, state.phOverrides));
  let cum = Math.min(leaveHours, contractedService); // paid leave fills contracted hours first
  const acc = { worked: 0, additional: 0, pen25: 0, pen50: 0, ph: 0, ot: {} };
  const addOT = (mult, h) => { acc.ot[mult] = (acc.ot[mult] || 0) + h; };
  for (const p of pieces) {
    acc.worked += p.hours;
    let remaining = p.hours;
    // split this piece into: within contracted | additional | excess | excess beyond 120
    const bands = [
      ['contract', contractedService], ['additional', rules.fullTimeServiceHours],
      ['excess', rules.otDoubleThreshold], ['double', Infinity],
    ];
    for (const [band, limit] of bands) {
      if (remaining <= 1e-9) break;
      const room = Math.max(0, limit - cum);
      const h = Math.min(remaining, room);
      if (h <= 0) continue;
      cum += h; remaining -= h;
      if (band === 'contract' || band === 'additional') {
        if (band === 'additional') acc.additional += h;
        // Payroll pays PH penalty AND the 25% after-hours penalty on PH night hours;
        // on weekends only the 50% applies (higher penalty, not cumulative).
        if (p.ph) { acc.ph += h; if (p.outside) acc.pen25 += h; }
        else if (p.weekend) acc.pen50 += h;
        else if (p.outside) acc.pen25 += h;
      } else if (band === 'excess') {
        const mult = p.ph ? (p.outside ? rules.otPublicHolidayOutside : rules.otPublicHolidayWithin)
          : p.weekend ? rules.otWeekend : rules.otWeekday;
        addOT(mult, h);
      } else addOT(rules.otDouble, h);
    }
  }

  const lines = [];
  const add = (cat, label, hours, lineRate, due, note) => {
    if (Math.abs(hours) < 0.005) return;
    lines.push({ id: `${fnStart}|${cat}|${label}`, fn: fnStart, cat, label, hours: r2(hours), rate: lineRate,
      amount: r2(hours * lineRate), due, note });
  };
  const lwop = leave.lwop || 0;
  const paidLeave = leaveHours - lwop;
  const normalHours = Math.max(0, contractedTotal - leaveHours);
  add('normal', 'Normal Pay', normalHours, rate, basePay, `${contractedTotal} contracted h (${fte} FTE) minus leave`);
  for (const [k, h] of Object.entries(leave)) if (k !== 'lwop') add('leave', LEAVE_TYPES[k] || 'Leave', h, rate, basePay);
  add('cpd', 'CPD Allow', normalHours + paidLeave, cpdRate, basePay, 'on contracted hours');
  const training = acc.additional * rules.trainingPerAdditional;
  add('additional', 'Additional Hours', acc.additional, rate, extrasPay, 'hours above your FTE, up to full-time, at 100%');
  add('training', 'Training Time Registrars', training, rate, extrasPay, '5/38 of Additional Hours');
  add('cpd', 'CPD Allow (extra hours)', acc.additional + training, cpdRate, extrasPay, 'on additional + training hours');
  add('pen25', '25.0% Penalty', acc.pen25, rate * rules.penaltyAfterHours, extrasPay, 'weekday hours 7pm–7am');
  add('pen50', '50%Penalty', acc.pen50, rate * rules.penaltyWeekend, extrasPay, 'Saturday/Sunday hours');
  add('ph', 'Public Holiday Penalty 150%', acc.ph, rate * rules.penaltyPublicHoliday, extrasPay, 'public holiday hours');
  for (const [m, h] of Object.entries(acc.ot)) add('ot', `Overtime @ ${m}`, h, rate * +m, extrasPay, 'hours beyond 76 service hours');

  return {
    fnStart, fnEnd, profile, rate, late, basePay, extrasPay, lines,
    summary: { worked: r2(acc.worked), leave: r2(leaveHours), additional: r2(acc.additional),
      excess: r2(Object.values(acc.ot).reduce((a, b) => a + b, 0)), contractedTotal, contractedService },
    gross: r2(lines.reduce((a, l) => a + l.amount, 0)),
  };
}

// All fortnights from the first profile/shift up to `untilDate`.
export function allExpected(state, untilDate, rules = DEFAULT_RULES) {
  const dates = state.shifts.map((s) => s.date);
  const firstProfile = [...state.profiles].sort((a, b) => a.from.localeCompare(b.from))[0];
  const startFrom = state.trackFrom || firstProfile?.from;
  if (!startFrom) return [];
  let fn = fortnightStart(startFrom);
  const last = fortnightStart([untilDate, ...dates].sort().pop());
  const out = [];
  while (fn <= last) { out.push(calcFortnight(fn, state.shifts, state, rules)); fn = addDays(fn, 14); }
  return out;
}

// Map a payslip line description to a category.
export function categorise(desc) {
  const d = desc.replace(/\s+/g, ' ');
  if (/^Backpay/i.test(d)) return 'backpay';
  if (/^Normal Pay/i.test(d)) return 'normal';
  if (/Additional Hours/i.test(d)) return 'additional';
  if (/Training Time/i.test(d)) return 'training';
  if (/25(\.0)?%\s*Penalty/i.test(d)) return 'pen25';
  if (/50%\s*Penalty/i.test(d)) return 'pen50';
  if (/Public Holiday/i.test(d)) return 'ph';
  if (/Overtime/i.test(d)) return 'ot';
  if (/CPD/i.test(d)) return 'cpd';
  if (/Leave Without Pay/i.test(d)) return 'lwop';
  if (/Leave|Lve|Sick/i.test(d)) return 'leave';
  return 'other';
}
export const CAT_LABELS = {
  normal: 'Normal Pay', leave: 'Paid leave', cpd: 'CPD allowance', additional: 'Additional Hours',
  training: 'Training Time', pen25: '25% after-hours penalty', pen50: '50% weekend penalty',
  ph: 'Public holiday penalty', ot: 'Overtime', backpay: 'Backpay', lwop: 'Leave without pay', other: 'Other',
};

// Reconcile imported payslips against expected lines, oldest payslip first.
// Each payslip's money in a category pays off outstanding expected items in that
// category (oldest due first) that were due on or before that pay date.
export function reconcile(expectedFns, payslips, today, rules = DEFAULT_RULES) {
  const items = expectedFns.flatMap((f) => f.lines.map((l) => ({ ...l, paid: 0, paidBy: [] })));
  const slips = [...payslips].sort((a, b) => a.payDate.localeCompare(b.payDate));
  const results = [];
  for (const slip of slips) {
    const byCat = {};
    for (const l of slip.lines) {
      const c = categorise(l.desc);
      (byCat[c] ||= { paid: 0, lines: [] }).paid += l.amount;
      byCat[c].lines.push(l);
    }
    const checks = [];
    const cats = new Set([...Object.keys(byCat),
      ...items.filter((i) => i.due === slip.payDate).map((i) => i.cat)]);
    for (const cat of cats) {
      const paid = r2(byCat[cat]?.paid || 0);
      const open = (i) => i.cat === cat && i.amount - i.paid > 0.005;
      // 1) what this payslip was scheduled to pay; 2) older amounts still owed; 3) next cycle (paid early)
      const scheduled = items.filter((i) => open(i) && i.due === slip.payDate);
      const older = items.filter((i) => open(i) && i.due < slip.payDate).sort((a, b) => a.due.localeCompare(b.due));
      const early = items.filter((i) => open(i) && i.due > slip.payDate && i.due <= addDays(slip.payDate, 14));
      const expected = r2(scheduled.reduce((a, i) => a + (i.amount - i.paid), 0));
      let pool = paid;
      const allocate = (list) => {
        const used = [];
        for (const i of list) {
          if (pool <= rules.matchTolerance) break;
          const owe = i.amount - i.paid;
          const take = Math.min(owe, pool);
          // within tolerance of the full amount → treat as fully paid
          i.paid = owe - take <= rules.matchTolerance ? i.amount : r2(i.paid + take);
          i.paidBy.push(slip.payDate); pool -= take; used.push({ fn: i.fn, label: i.label, hours: i.hours, amount: r2(take) });
        }
        return used;
      };
      // Lines carrying dates (CPD, leave, public holidays) go to their own fortnight first
      const usedDated = [];
      for (const l of byCat[cat]?.lines || []) {
        if (!l.from || l.amount <= 0) continue;
        const fn = fortnightStart(l.from);
        const mine = items.filter((i) => open(i) && i.fn === fn)
          .sort((a, b) => Math.abs(a.amount - a.paid - l.amount) - Math.abs(b.amount - b.paid - l.amount) || a.due.localeCompare(b.due));
        const keep = pool; pool = Math.min(l.amount, pool);
        const used = allocate(mine);
        const spent = used.reduce((a, x) => a + x.amount, 0);
        pool = keep - spent; usedDated.push(...used);
      }
      const usedScheduled = usedDated.filter((u) => scheduled.some((i) => i.fn === u.fn && i.label === u.label))
        .concat(allocate(scheduled));
      const isSched = (u) => scheduled.some((i) => i.fn === u.fn && i.label === u.label);
      const catchUp = usedDated.filter((u) => !isSched(u)).concat(allocate(older), allocate(early));
      const catchUpTotal = r2(catchUp.reduce((a, x) => a + x.amount, 0));
      const leftover = r2(paid - expected - catchUpTotal);
      let status = 'match';
      const diff = r2(paid - expected);
      if (cat === 'backpay' || cat === 'lwop' || cat === 'other') status = 'info';
      else if (diff < -rules.matchTolerance) status = paid === 0 ? 'missing' : 'under';
      else if (leftover > rules.matchTolerance) status = 'over';
      const due = scheduled;
      // rate check on payslip lines
      const rateIssues = [];
      for (const l of byCat[cat]?.lines || []) {
        const exp = [...due, ...older].find((i) => Math.abs(i.rate) > 0 && i.label.split(' ')[0] === (l.desc.split(' ')[0]));
        if (exp && l.rate > 0 && Math.abs(l.rate - exp.rate) > 0.015 && cat !== 'cpd')
          rateIssues.push({ line: l, expectedRate: r2(exp.rate) });
      }
      checks.push({ cat, label: CAT_LABELS[cat] || cat, paid, expected, diff, status, leftover, catchUp, catchUpTotal,
        lines: byCat[cat]?.lines || [], items: usedScheduled, scheduled: scheduled.map((i) => ({ fn: i.fn, label: i.label, hours: i.hours, amount: i.amount })),
        rateIssues });
    }
    const order = Object.keys(CAT_LABELS);
    checks.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
    results.push({ slip, checks,
      problems: checks.filter((c) => ['missing', 'under', 'over'].includes(c.status) || c.rateIssues.length).length });
  }
  // Only call something "owed" when we have evidence: the payslip it was due on was imported,
  // or (for extras, which payroll often pays late) a later payslip was imported.
  const slipDates = new Set(slips.map((x) => x.payDate));
  const lastSlip = slips.length ? slips[slips.length - 1].payDate : '';
  const BASE = ['normal', 'leave'];
  const outstanding = items.filter((i) => i.amount - i.paid > 0.005).map((i) => {
    let status = 'upcoming';
    if (i.due < today) {
      const evidence = slipDates.has(i.due) || (!BASE.includes(i.cat) && i.label !== 'CPD Allow' && lastSlip > i.due);
      status = evidence ? 'overdue' : 'noslip';
    }
    return { ...i, owed: r2(i.amount - i.paid), status };
  });
  return { results, outstanding, items };
}

// Upcoming paydays with predicted gross, from outstanding items.
export function forecast(outstanding, today) {
  const by = {};
  for (const i of outstanding) {
    const d = i.status === 'overdue' ? 'overdue' : i.status === 'noslip' ? 'noslip' : i.due;
    (by[d] ||= { date: d, total: 0, items: [] }).items.push(i);
    by[d].total = r2(by[d].total + i.owed);
  }
  return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
}
