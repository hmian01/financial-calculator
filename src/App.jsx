import { useMemo, useState } from 'react'
import './App.css'

const FIELD_META = {
  pv: { label: 'Present Value (PV)', suffix: '$' },
  fv: { label: 'Future Value (FV)', suffix: '$' },
  rate: { label: 'Periodic Rate (r)', suffix: '%' },
  periods: { label: 'Periods (n)', suffix: '' },
  payment: { label: 'Payment per Period (PMT)', suffix: '$' },
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
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function formatField(key, value) {
  if (!Number.isFinite(value)) {
    return 'Invalid result'
  }

  if (key === 'pv' || key === 'fv' || key === 'payment') {
    return CURRENCY_FORMATTER.format(value)
  }

  if (key === 'rate') {
    return `${PERCENT_FORMATTER.format(value)}%`
  }

  return NUMBER_FORMATTER.format(value)
}

function solveMissingField(values) {
  const parsed = {
    pv: parseField(values.pv),
    fv: parseField(values.fv),
    rate: parseField(values.rate),
    periods: parseField(values.periods),
    payment: parseField(values.payment),
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (Number.isNaN(value)) {
      return { error: `${FIELD_META[key].label} must be a valid number.` }
    }
  }

  const missing = Object.entries(parsed)
    .filter(([, value]) => value === null)
    .map(([key]) => key)

  if (missing.length > 1) {
    return { error: 'Enter at least 3 fields. Leave only one field blank to solve it.' }
  }

  if (missing.length === 0) {
    return { error: 'All 4 fields are filled. Clear one field to calculate it.' }
  }

  const EPSILON = 1e-10
  const payment = parsed.payment ?? 0
  const missingKey = missing[0]
  const pv = parsed.pv
  const fv = parsed.fv
  const ratePercent = parsed.rate
  const n = parsed.periods
  const hasInvalidPeriods = n !== null && n <= 0

  if (hasInvalidPeriods) {
    return { error: 'Periods (n) must be greater than 0.' }
  }

  const rateDecimal = ratePercent === null ? null : ratePercent / 100

  function futureValueFromInputs(basePV, pmt, rate, periods) {
    if (Math.abs(rate) < EPSILON) {
      return basePV + pmt * periods
    }

    const growth = Math.pow(1 + rate, periods)
    return basePV * growth + pmt * ((growth - 1) / rate)
  }

  function solveRateByBisection(basePV, pmt, targetFV, periods) {
    const testPoints = [
      -0.9999, -0.9, -0.75, -0.5, -0.25, -0.1, -0.05, -0.01, 0, 0.01, 0.05,
      0.1, 0.25, 0.5, 1, 2, 5, 10,
    ]
    const fn = (rate) => futureValueFromInputs(basePV, pmt, rate, periods) - targetFV

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

  let solved

  if (missingKey === 'pv') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Present Value.' }
    }

    if (Math.abs(rateDecimal) < EPSILON) {
      solved = fv - payment * n
    } else {
      const growth = Math.pow(1 + rateDecimal, n)
      solved = (fv - payment * ((growth - 1) / rateDecimal)) / growth
    }
  }

  if (missingKey === 'fv') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Future Value.' }
    }

    solved = futureValueFromInputs(pv, payment, rateDecimal, n)
  }

  if (missingKey === 'rate') {
    if (pv === 0 && payment === 0 && fv === 0) {
      return {
        error: 'This input combination does not produce a unique rate.',
      }
    }

    const solvedRate = solveRateByBisection(pv, payment, fv, n)
    if (solvedRate === null) {
      return {
        error:
          'Could not solve a real periodic rate with this input combination.',
      }
    }

    solved = solvedRate * 100
  }

  if (missingKey === 'periods') {
    if (rateDecimal <= -1) {
      return { error: 'Rate must be greater than -100% when solving Periods.' }
    }

    if (Math.abs(rateDecimal) < EPSILON) {
      if (payment === 0) {
        if (pv === fv) {
          return {
            error:
              'With 0% rate and PMT = 0, periods are not uniquely determined.',
          }
        }
        return { error: 'No solution for periods with 0% rate and PMT = 0.' }
      }

      solved = (fv - pv) / payment
    } else {
      const numerator = fv * rateDecimal + payment
      const denominator = pv * rateDecimal + payment

      if (denominator === 0) {
        return {
          error: 'No real periods solution for this input combination.',
        }
      }

      const ratio = numerator / denominator
      if (ratio <= 0) {
        return {
          error: 'No real periods solution for this input combination.',
        }
      }

      solved = Math.log(ratio) / Math.log(1 + rateDecimal)
    }
  }

  if (!Number.isFinite(solved) || solved <= 0) {
    return {
      error:
        'No real solution with this combination. Check signs and values, then try again.',
    }
  }

  const completed = {
    ...parsed,
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
    payment: '',
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
    }
  }, [result])

  function updateField(key, nextValue) {
    setValues((previous) => ({
      ...previous,
      [key]: nextValue,
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
    setValues({ pv: '', fv: '', rate: '', periods: '', payment: '' })
    setResult(null)
    setError('')
  }

  return (
    <main className="page">
      <section className="card">
        <h1>TVM Calculator</h1>
        <p className="intro">
          Fill any 3 core fields (PV, FV, rate, periods), leave 1 core field blank to
          solve it, and optionally add a constant payment (PMT) per period.
        </p>

        <form className="form" onSubmit={handleCalculate}>
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

          <label htmlFor="payment">Payment per Period (PMT) - Optional</label>
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
                <dd>{formattedResult.payment}</dd>
              </div>
            </dl>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
