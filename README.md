# My Paycheck – Registrars

A phone app for registrars at the Royal Hobart Hospital to log shifts, predict their fortnightly pay, and check each payslip line by line.

- Works offline once added to the home screen.
- All data stays on the doctor's phone. Nothing is sent to any server, and there are no accounts.
- Pay rules follow the Medical Practitioners (Tasmanian State Service) Agreement 2025 and how Tas Health payroll prints payslips.

This is a guide, not official payroll advice.

## Files
- `index.html` – the app screens
- `engine.js` – pay rules (rates, FTE, additional hours, penalties, overtime, payment timing)
- `parser.js` – reads the "Pay Advice Slip" PDF
- `sw.js` – offline cache
- `pdf.min.mjs`, `pdf.worker.min.mjs` – PDF.js 4.10.38 (Apache-2.0, Mozilla)

© All rights reserved.
