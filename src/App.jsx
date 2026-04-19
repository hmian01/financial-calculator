import { useMemo, useState } from 'react'
import './App.css'

const FIELD_META = {
  pv: { label: 'Present Value (PV)', suffix: '$' },
  fv: { label: 'Future Value (FV)', suffix: '$' },
  rate: { label: 'Periodic Rate (r)', suffix: '%' },
  periods: { label: 'Periods (n)', suffix: '' },
  payment: { label: 'Payment per Period (PMT)', suffix: '$' },
  paymentGrowth: { label: 'Payment Growth (g)', suffix: '%' },
}

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
})

const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
})

function parseField(value) {
  const normalized = value.replace(/,/g, '').trim()

  if (normalized === '') {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function formatInputNumber(value) {
  const normalized = value.replace(/,/g, '').trim()

  if (normalized === '') {
    return ''
  }

  if (normalized === '-') {
    return '-'
  }

  if (!/^-?\d*\.?\d*$/.test(normalized)) {
    return null
  }

  const sign = normalized.startsWith('-') ? '-' : ''
  const unsigned = sign ? normalized.slice(1) : normalized
  const hasDecimal = unsigned.includes('.')
  const [integerPart, decimalPart = ''] = unsigned.split('.')
  const numericInteger = integerPart === '' ? 0 : Number(integerPart)
  const formattedInteger = Number.isFinite(numericInteger)
    ? numericInteger.toLocaleString('en-US')
    : null

  if (formattedInteger === null) {
    return null
  }

  if (!hasDecimal) {
    return `${sign}${formattedInteger}`
  }

  return `${sign}${formattedInteger}.${decimalPart}`
}

function formatField(key, value) {
  if (!Number.isFinite(value)) {
    return 'Invalid result'
  }

  if (key === 'pv' || key === 'fv' || key === 'payment') {
    return CURRENCY_FORMATTER.format(value)
  }

  if (key === 'rate' || key === 'paymentGrowth') {
    return `${PERCENT_FORMATTER.format(value)}%`
  }

  return NUMBER_FORMATTER.format(value)
}

function solveMissingField(values) {
  const coreKeys = ['pv', 'fv', 'rate', 'periods']
  const parsed = {
    pv: parseField(values.pv),
    fv: parseField(values.fv),
    rate: parseField(values.rate),
    periods: parseField(values.periods),
    payment: parseField(values.payment),
    paymentGrowth: parseField(values.paymentGrowth),
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (Number.isNaN(value)) {
      return { error: `${FIELD_META[key].label} must be a valid number.` }
    }
  }

  const missing = coreKeys.filter((key) => parsed[key] === null)

  if (missing.length > 1) {
    return { error: 'Enter at least 3 fields. Leave only one field blank to solve it.' }
  }

  const EPSILON = 1e-10
  const payment = parsed.payment ?? 0
  const paymentGrowthPercent = parsed.paymentGrowth ?? 0
  const paymentGrowthDecimal = paymentGrowthPercent / 100
  const missingKey = missing.length === 0 ? 'payment' : missing[0]
  const pv = parsed.pv
  const fv = parsed.fv
  const ratePercent = parsed.rate
  const n = parsed.periods
  const hasInvalidPeriods = n !== null && n <= 0

  if (hasInvalidPeriods) {
    return { error: 'Periods (n) must be greater than 0.' }
  }

  if (paymentGrowthDecimal <= -1) {
    return { error: 'Payment Growth must be greater than -100%.' }
  }

  const rateDecimal = ratePercent === null ? null : ratePercent / 100

  function paymentContribution(pmt, rate, paymentGrowthRate, periods) {
    if (Math.abs(pmt) < EPSILON) {
      return 0
    }

    if (Math.abs(rate - paymentGrowthRate) < EPSILON) {
      return pmt * periods * Math.pow(1 + rate, periods - 1)
    }

    const rateFactor = Math.pow(1 + rate, periods)
    const growthFactor = Math.pow(1 + paymentGrowthRate, periods)
    return pmt * ((rateFactor - growthFactor) / (rate - paymentGrowthRate))
  }

  function futureValueFromInputs(basePV, pmt, rate, paymentGrowthRate, periods) {
    if (rate <= -1 || paymentGrowthRate <= -1) {
      return Number.NaN
    }

    const pvLeg = basePV * Math.pow(1 + rate, periods)
    const pmtLeg = paymentContribution(pmt, rate, paymentGrowthRate, periods)
    return pvLeg + pmtLeg
  }

  function solveRateByBisection(
    basePV,
    pmt,
    paymentGrowthRate,
    targetFV,
    periods,
  ) {
    const testPoints = [
      -0.9999, -0.9, -0.75, -0.5, -0.25, -0.1, -0.05, -0.01, 0, 0.01, 0.05,
      0.1, 0.25, 0.5, 1, 2, 5, 10,
    ]

    const fn = (rate) =>
      futureValueFromInputs(basePV, pmt, rate, paymentGrowthRate, periods) - targetFV

    const zeroValue = fn(0)
    if (Math.abs(zeroValue) < 1e-8) {
      return 0
    }

    let bracket = null
    let previousRate = null
    let previousValue = null

    for (const rate of testPoints) {
      const value = fn(rate)
      if (!Number.isFinite(value)) {
        continue
      }

      if (Math.abs(value) < 1e-8) {
        return rate
      }

      if (previousValue !== null && value * previousValue < 0) {
        bracket = [previousRate, rate]
        break
      }

      previousRate = rate
      previousValue = value
    }

    if (!bracket) {
      return null
    }

    let [low, high] = bracket
    let lowValue = fn(low)
    let highValue = fn(high)

    for (let i = 0; i < 120; i += 1) {
      const mid = (low + high) / 2
      const midValue = fn(mid)

      if (!Number.isFinite(midValue)) {
        return null
      }

      if (Math.abs(midValue) < 1e-10) {
        return mid
      }

      if (lowValue * midValue < 0) {
        high = mid
        highValue = midValue
      } else {
        low = mid
        lowValue = midValue
      }

      if (Math.abs(high - low) < 1e-12 || Math.abs(highValue - lowValue) < 1e-12) {
        break
      }
    }

    return (low + high) / 2
  }

  function solvePeriodsByBisection(basePV, pmt, rate, paymentGrowthRate, targetFV) {
    const testPoints = [
      1e-6, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100,
    ]

    const fn = (periods) =>
      futureValueFromInputs(basePV, pmt, rate, paymentGrowthRate, periods) - targetFV

    let previousN = 0
    let previousValue = fn(previousN)

    if (!Number.isFinite(previousValue)) {
      return null
    }

    if (Math.abs(previousValue) < 1e-8) {
      return 0
    }

    let bracket = null

    for (const currentN of testPoints) {
      const currentValue = fn(currentN)
      if (!Number.isFinite(currentValue)) {
        continue
      }

      if (Math.abs(currentValue) < 1e-8) {
        return currentN
      }

      if (previousValue * currentValue < 0) {
        bracket = [previousN, currentN]
        break
      }

      previousN = currentN
      previousValue = currentValue
    }

    if (!bracket) {
      return null
    }

    let [low, high] = bracket
    let lowValue = fn(low)
    let highValue = fn(high)

    for (let i = 0; i < 120; i += 1) {
      const mid = (low + high) / 2
      const midValue = fn(mid)

      if (!Number.isFinite(midValue)) {
        return null
      }

      if (Math.abs(midValue) < 1e-10) {
        return mid
      }

      if (lowValue * midValue < 0) {
        high = mid
        highValue = midValue
      } else {
        low = mid
        lowValue = midValue
      }

      if (Math.abs(high - low) < 1e-12 || Math.abs(highValue - lowValue) < 1e-12) {
        break
      }
    }

    return (low + high) / 2
  }

  let solved

  if (missingKey === 'pv') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Present Value.' }
    }

    const pvGrowth = Math.pow(1 + rateDecimal, n)
    const pmtLeg = paymentContribution(payment, rateDecimal, paymentGrowthDecimal, n)
    solved = (fv - pmtLeg) / pvGrowth
  }

  if (missingKey === 'fv') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Future Value.' }
    }

    solved = futureValueFromInputs(pv, payment, rateDecimal, paymentGrowthDecimal, n)
  }

  if (missingKey === 'rate') {
    if (pv === 0 && payment === 0 && fv === 0) {
      return {
        error: 'This input combination does not produce a unique rate.',
      }
    }

    const solvedRate = solveRateByBisection(
      pv,
      payment,
      paymentGrowthDecimal,
      fv,
      n,
    )

    if (solvedRate === null) {
      return {
        error: 'Could not solve a real periodic rate with this input combination.',
      }
    }

    solved = solvedRate * 100
  }

  if (missingKey === 'periods') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Periods.' }
    }

    const solvedPeriods = solvePeriodsByBisection(
      pv,
      payment,
      rateDecimal,
      paymentGrowthDecimal,
      fv,
    )

    if (solvedPeriods === null) {
      return {
        error: 'No real periods solution for this input combination.',
      }
    }

    solved = solvedPeriods
  }

  if (missingKey === 'payment') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Payment.' }
    }

    const pvLeg = pv * Math.pow(1 + rateDecimal, n)
    const target = fv - pvLeg
    let factor

    if (Math.abs(rateDecimal - paymentGrowthDecimal) < EPSILON) {
      factor = n * Math.pow(1 + rateDecimal, n - 1)
    } else {
      const rateFactor = Math.pow(1 + rateDecimal, n)
      const growthFactor = Math.pow(1 + paymentGrowthDecimal, n)
      factor = (rateFactor - growthFactor) / (rateDecimal - paymentGrowthDecimal)
    }

    if (Math.abs(factor) < EPSILON) {
      if (Math.abs(target) < EPSILON) {
        return { error: 'Payment is not uniquely determined for this input combination.' }
      }
      return { error: 'No payment value can satisfy this input combination.' }
    }

    solved = target / factor
  }

  if (!Number.isFinite(solved) || (missingKey === 'periods' && solved <= 0)) {
    return {
      error:
        'No real solution with this combination. Check signs and values, then try again.',
    }
  }

  const completed = {
    ...parsed,
    payment: payment,
    paymentGrowth: paymentGrowthPercent,
    [missingKey]: solved,
  }

  return {
    missingKey,
    completed,
  }
}

function App() {
  const [values, setValues] = useState({
    pv: '',
    fv: '',
    rate: '',
    periods: '',
    payment: '0',
    paymentGrowth: '0',
  })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const formattedResult = useMemo(() => {
    if (!result?.completed) {
      return null
    }

    return {
      pv: formatField('pv', result.completed.pv),
      fv: formatField('fv', result.completed.fv),
      rate: formatField('rate', result.completed.rate),
      periods: formatField('periods', result.completed.periods),
      payment: formatField('payment', result.completed.payment),
      paymentGrowth: formatField('paymentGrowth', result.completed.paymentGrowth),
    }
  }, [result])

  function updateField(key, nextValue) {
    const formattedValue = formatInputNumber(nextValue)
    if (formattedValue === null) {
      return
    }

    setValues((previous) => ({
      ...previous,
      [key]: formattedValue,
    }))
  }

  function handleCalculate(event) {
    event.preventDefault()

    const solved = solveMissingField(values)

    if (solved.error) {
      setError(solved.error)
      setResult(null)
      return
    }

    setError('')
    setResult(solved)
  }

  function handleClear() {
    setValues({
      pv: '',
      fv: '',
      rate: '',
      periods: '',
      payment: '0',
      paymentGrowth: '0',
    })
    setResult(null)
    setError('')
  }

  return (
    <main className="page">
      <section className="card">
        <h1>TVM Calculator</h1>
        <p className="intro">
          Fill any 3 core fields (PV, FV, rate, periods) and leave 1 blank to solve it,
          or fill all 4 core fields to solve the required payment (PMT). Payment inputs
          support optional growth.
        </p>

        <form className="form" onSubmit={handleCalculate}>
          <div className="field-groups">
            <div className="field-group">
              <h3 className="group-title">Required Fields</h3>
              <p className="group-hint">
                Enter any 3 and leave 1 blank, or fill all 4 to solve PMT.
              </p>

              <div className="form-grid">
                <label htmlFor="pv">Present Value (PV)</label>
                <div className="field">
                  <span className="prefix">$</span>
                  <input
                    id="pv"
                    inputMode="decimal"
                    type="text"
                    placeholder="Leave blank to solve"
                    value={values.pv}
                    onChange={(event) => updateField('pv', event.target.value)}
                  />
                </div>

                <label htmlFor="fv">Future Value (FV)</label>
                <div className="field">
                  <span className="prefix">$</span>
                  <input
                    id="fv"
                    inputMode="decimal"
                    type="text"
                    placeholder="Leave blank to solve"
                    value={values.fv}
                    onChange={(event) => updateField('fv', event.target.value)}
                  />
                </div>

                <label htmlFor="rate">Periodic Rate (r)</label>
                <div className="field">
                  <input
                    id="rate"
                    inputMode="decimal"
                    type="text"
                    placeholder="Leave blank to solve"
                    value={values.rate}
                    onChange={(event) => updateField('rate', event.target.value)}
                  />
                  <span className="suffix">%</span>
                </div>

                <label htmlFor="periods">Periods (n)</label>
                <div className="field">
                  <input
                    id="periods"
                    inputMode="decimal"
                    type="text"
                    placeholder="Leave blank to solve"
                    value={values.periods}
                    onChange={(event) => updateField('periods', event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="field-group optional">
              <h3 className="group-title">Optional Fields</h3>
              <p className="group-hint">Defaults to 0 when blank.</p>

              <div className="form-grid">
                <label htmlFor="payment">Payment per Period (PMT)</label>
                <div className="field">
                  <span className="prefix">$</span>
                  <input
                    id="payment"
                    inputMode="decimal"
                    type="text"
                    placeholder="Optional (defaults to 0)"
                    value={values.payment}
                    onChange={(event) => updateField('payment', event.target.value)}
                  />
                </div>

                <label htmlFor="paymentGrowth">Payment Growth (g)</label>
                <div className="field">
                  <input
                    id="paymentGrowth"
                    inputMode="decimal"
                    type="text"
                    placeholder="Optional (defaults to 0)"
                    value={values.paymentGrowth}
                    onChange={(event) =>
                      updateField('paymentGrowth', event.target.value)
                    }
                  />
                  <span className="suffix">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="actions">
            <button type="submit">Calculate Missing Field</button>
            <button type="button" className="secondary" onClick={handleClear}>
              Clear
            </button>
          </div>
        </form>

        {error && <p className="error">{error}</p>}

        {formattedResult && (
          <section className="result" aria-live="polite">
            <h2>Output</h2>
            <p className="solved-for">Solved: {FIELD_META[result.missingKey].label}</p>
            <dl>
              <div>
                <dt>Present Value</dt>
                <dd className={result.missingKey === 'pv' ? 'highlight' : ''}>
                  {formattedResult.pv}
                </dd>
              </div>
              <div>
                <dt>Future Value</dt>
                <dd className={result.missingKey === 'fv' ? 'highlight' : ''}>
                  {formattedResult.fv}
                </dd>
              </div>
              <div>
                <dt>Periodic Rate</dt>
                <dd className={result.missingKey === 'rate' ? 'highlight' : ''}>
                  {formattedResult.rate}
                </dd>
              </div>
              <div>
                <dt>Periods</dt>
                <dd className={result.missingKey === 'periods' ? 'highlight' : ''}>
                  {formattedResult.periods}
                </dd>
              </div>
              <div>
                <dt>Payment per Period</dt>
                <dd className={result.missingKey === 'payment' ? 'highlight' : ''}>
                  {formattedResult.payment}
                </dd>
              </div>
              <div>
                <dt>Payment Growth</dt>
                <dd>{formattedResult.paymentGrowth}</dd>
              </div>
            </dl>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
