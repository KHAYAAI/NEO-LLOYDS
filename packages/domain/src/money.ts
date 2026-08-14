import { MoneyError } from './errors.js';

/**
 * Money is an integer count of minor units plus an ISO-4217 currency.
 * Never a float: see ADR-0005. `amountMinor` for USD is cents, for JPY is yen.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError('Money amount must be a safe integer of minor units', {
      amountMinor,
    });
  }
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new MoneyError('Currency must be an ISO-4217 alpha-3 code', { currency });
  }
  return Object.freeze({ amountMinor, currency });
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      'Cannot combine different currencies without an explicit, provenanced FX rate',
      { left: a.currency, right: b.currency },
    );
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/**
 * Sum of a same-currency series. An empty series has no currency and therefore
 * no meaningful zero, so the currency must be supplied.
 */
export function sumMoney(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, item) => addMoney(acc, item), money(0, currency));
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

/**
 * Scale money by a ratio (e.g. a syndication share). Rounds half-up to the
 * nearest minor unit; callers splitting a total across participants must use
 * {@link allocateMoney} instead so that the parts sum exactly to the whole.
 */
export function scaleMoney(m: Money, ratio: number): Money {
  if (!Number.isFinite(ratio)) {
    throw new MoneyError('Scale ratio must be finite', { ratio });
  }
  return money(Math.round(m.amountMinor * ratio), m.currency);
}

/**
 * Split money across weights with no minor units lost or invented.
 * Largest-remainder distribution: the sum of the result always equals the
 * input exactly, which is what makes capital allocation auditable.
 */
export function allocateMoney(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('Cannot allocate across zero weights', {});
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('Weights must be finite and non-negative', { weights });
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    throw new MoneyError('Total weight must be greater than zero', { weights });
  }

  const sign = total.amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(total.amountMinor);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = magnitude - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    const target = order[i % order.length];
    if (target) result[target.index] = (result[target.index] ?? 0) + 1;
  }

  return result.map((amount) => money(sign * (amount ?? 0), total.currency));
}

export function formatMoney(m: Money, minorUnitDigits = 2): string {
  const divisor = 10 ** minorUnitDigits;
  const value = (m.amountMinor / divisor).toFixed(minorUnitDigits);
  return `${value} ${m.currency}`;
}
