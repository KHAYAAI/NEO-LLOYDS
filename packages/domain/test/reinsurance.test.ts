import { describe, expect, it } from 'vitest';
import {
  applyAggregate,
  applyExcessOfLoss,
  applyQuotaShare,
  applyReinsuranceProgram,
  DomainError,
  isFullyCeded,
  money,
  requireValidLayerParams,
  type ReinsuranceLayer,
  type ReinsuranceLayerState,
} from '../src/index.js';

describe('applyQuotaShare', () => {
  it('cedes an exact proportion of the loss', () => {
    const result = applyQuotaShare(money(10_000_00, 'USD'), { kind: 'QUOTA_SHARE', cededBps: 3000 });
    expect(result.ceded).toEqual(money(3_000_00, 'USD'));
    expect(result.retained).toEqual(money(7_000_00, 'USD'));
  });

  it('caps the cession at an optional per-loss limit', () => {
    const result = applyQuotaShare(money(10_000_00, 'USD'), {
      kind: 'QUOTA_SHARE',
      cededBps: 5000,
      perLossLimit: money(2_000_00, 'USD'),
    });
    expect(result.ceded).toEqual(money(2_000_00, 'USD'));
    expect(result.retained).toEqual(money(8_000_00, 'USD'));
  });

  it('cedes and retains sum exactly back to the loss', () => {
    const loss = money(9_999_99, 'USD');
    const result = applyQuotaShare(loss, { kind: 'QUOTA_SHARE', cededBps: 3333 });
    expect(result.ceded.amountMinor + result.retained.amountMinor).toBe(loss.amountMinor);
  });
});

describe('applyExcessOfLoss', () => {
  it('cedes nothing below the attachment point', () => {
    const result = applyExcessOfLoss(money(50_00, 'USD'), {
      kind: 'EXCESS_OF_LOSS',
      attachmentPoint: money(100_00, 'USD'),
      limit: money(500_00, 'USD'),
    });
    expect(result.ceded).toEqual(money(0, 'USD'));
    expect(result.retained).toEqual(money(50_00, 'USD'));
  });

  it('cedes the slice between attachment and attachment+limit', () => {
    const result = applyExcessOfLoss(money(400_00, 'USD'), {
      kind: 'EXCESS_OF_LOSS',
      attachmentPoint: money(100_00, 'USD'),
      limit: money(200_00, 'USD'),
    });
    expect(result.ceded).toEqual(money(200_00, 'USD'));
    expect(result.retained).toEqual(money(200_00, 'USD'));
  });

  it('caps cession at the limit even when the loss far exceeds attachment + limit', () => {
    const result = applyExcessOfLoss(money(10_000_00, 'USD'), {
      kind: 'EXCESS_OF_LOSS',
      attachmentPoint: money(100_00, 'USD'),
      limit: money(200_00, 'USD'),
    });
    expect(result.ceded).toEqual(money(200_00, 'USD'));
    expect(result.retained).toEqual(money(9_800_00, 'USD'));
  });
});

describe('applyAggregate', () => {
  const params = {
    kind: 'AGGREGATE' as const,
    attachmentPoint: money(1_000_00, 'USD'),
    limit: money(500_00, 'USD'),
  };
  const zeroState: ReinsuranceLayerState = {
    consumedGross: money(0, 'USD'),
    consumedCeded: money(0, 'USD'),
  };

  it('cedes nothing while cumulative losses stay below the attachment point', () => {
    const result = applyAggregate(money(600_00, 'USD'), params, zeroState);
    expect(result.ceded).toEqual(money(0, 'USD'));
    expect(result.nextState.consumedGross).toEqual(money(600_00, 'USD'));
  });

  it('cedes only the portion of a loss that crosses the attachment point', () => {
    // First loss brings cumulative to 600; second loss of 600 brings it to 1200,
    // 200 of which is above the 1000 attachment.
    const first = applyAggregate(money(600_00, 'USD'), params, zeroState);
    const second = applyAggregate(money(600_00, 'USD'), params, first.nextState);
    expect(second.ceded).toEqual(money(200_00, 'USD'));
    expect(second.retained).toEqual(money(400_00, 'USD'));
  });

  it('stops ceding once the aggregate limit is exhausted', () => {
    const state: ReinsuranceLayerState = {
      consumedGross: money(1_400_00, 'USD'), // 400 already above attachment
      consumedCeded: money(400_00, 'USD'),
    };
    const result = applyAggregate(money(1_000_00, 'USD'), params, state);
    // Only 100 of aggregate limit remains (500 - 400).
    expect(result.ceded).toEqual(money(100_00, 'USD'));
    expect(result.retained).toEqual(money(900_00, 'USD'));
  });
});

describe('applyReinsuranceProgram', () => {
  it('stacks layers in order, each applying to the prior layer\'s retained remainder', () => {
    const layers: ReinsuranceLayer[] = [
      { id: 'l1', order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 2000 } }, // 20%
      {
        id: 'l2',
        order: 2,
        params: { kind: 'EXCESS_OF_LOSS', attachmentPoint: money(1_000_00, 'USD'), limit: money(5_000_00, 'USD') },
      },
    ];
    const result = applyReinsuranceProgram(money(10_000_00, 'USD'), layers);

    // Layer 1: 20% of 10,000 = 2,000 ceded, 8,000 retained.
    expect(result.perLayer[0]?.ceded).toEqual(money(2_000_00, 'USD'));
    // Layer 2: of the 8,000 retained, excess above 1,000 up to 5,000 limit = 5,000 ceded (capped), 3,000 retained.
    expect(result.perLayer[1]?.ceded).toEqual(money(5_000_00, 'USD'));
    expect(result.netRetained).toEqual(money(3_000_00, 'USD'));
    expect(result.totalCeded).toEqual(money(7_000_00, 'USD'));
  });

  it('total ceded plus net retained always equals the gross loss', () => {
    const layers: ReinsuranceLayer[] = [
      { id: 'l1', order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 4321 } },
      {
        id: 'l2',
        order: 2,
        params: { kind: 'EXCESS_OF_LOSS', attachmentPoint: money(50_00, 'USD'), limit: money(300_00, 'USD') },
      },
    ];
    const result = applyReinsuranceProgram(money(777_77, 'USD'), layers);
    expect(result.totalCeded.amountMinor + result.netRetained.amountMinor).toBe(777_77);
  });

  it('applies layers by order regardless of array position', () => {
    const layers: ReinsuranceLayer[] = [
      {
        id: 'xol',
        order: 2,
        params: { kind: 'EXCESS_OF_LOSS', attachmentPoint: money(0, 'USD'), limit: money(1_000_00, 'USD') },
      },
      { id: 'qs', order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 5000 } },
    ];
    const result = applyReinsuranceProgram(money(2_000_00, 'USD'), layers);
    // qs (order 1) applies first: 50% of 2,000 = 1,000 ceded, 1,000 retained.
    expect(result.perLayer[0]?.layerId).toBe('qs');
    expect(result.perLayer[0]?.ceded).toEqual(money(1_000_00, 'USD'));
    // xol (order 2) then applies to the 1,000 retained, with a 1,000 limit: fully ceded.
    expect(result.perLayer[1]?.layerId).toBe('xol');
    expect(result.netRetained).toEqual(money(0, 'USD'));
    expect(isFullyCeded(result)).toBe(true);
  });

  it('carries aggregate layer state forward for the caller to persist', () => {
    const layers: ReinsuranceLayer[] = [
      {
        id: 'agg',
        order: 1,
        params: { kind: 'AGGREGATE', attachmentPoint: money(500_00, 'USD'), limit: money(1_000_00, 'USD') },
        state: { consumedGross: money(400_00, 'USD'), consumedCeded: money(0, 'USD') },
      },
    ];
    const result = applyReinsuranceProgram(money(300_00, 'USD'), layers);
    // Cumulative goes 400 -> 700, of which 200 is above the 500 attachment.
    expect(result.perLayer[0]?.ceded).toEqual(money(200_00, 'USD'));
    expect(result.perLayer[0]?.nextState?.consumedGross).toEqual(money(700_00, 'USD'));
    expect(result.perLayer[0]?.nextState?.consumedCeded).toEqual(money(200_00, 'USD'));
  });

  it('rejects a negative gross loss', () => {
    expect(() => applyReinsuranceProgram(money(-1, 'USD'), [])).toThrow(DomainError);
  });

  it('an empty program cedes nothing', () => {
    const result = applyReinsuranceProgram(money(500_00, 'USD'), []);
    expect(result.totalCeded).toEqual(money(0, 'USD'));
    expect(result.netRetained).toEqual(money(500_00, 'USD'));
  });
});

describe('requireValidLayerParams', () => {
  it('rejects a cededBps outside (0, 10000]', () => {
    expect(() => requireValidLayerParams({ kind: 'QUOTA_SHARE', cededBps: 0 })).toThrow(DomainError);
    expect(() => requireValidLayerParams({ kind: 'QUOTA_SHARE', cededBps: 10_001 })).toThrow(DomainError);
  });

  it('rejects a zero limit on an excess-of-loss layer', () => {
    expect(() =>
      requireValidLayerParams({
        kind: 'EXCESS_OF_LOSS',
        attachmentPoint: money(0, 'USD'),
        limit: money(0, 'USD'),
      }),
    ).toThrow(DomainError);
  });

  it('accepts a well-formed aggregate layer', () => {
    expect(() =>
      requireValidLayerParams({
        kind: 'AGGREGATE',
        attachmentPoint: money(1_000_00, 'USD'),
        limit: money(500_00, 'USD'),
      }),
    ).not.toThrow();
  });
});
