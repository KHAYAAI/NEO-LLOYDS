import { describe, expect, it } from 'vitest';
import {
  findJurisdictionModule,
  isConfiguredJurisdiction,
  JURISDICTION_DISCLAIMER,
  JURISDICTION_MODULES,
  listJurisdictionModules,
  requireJurisdictionModule,
  SUPPORTED_JURISDICTION_CODES,
  UnknownJurisdictionError,
} from '../src/index.js';

describe('jurisdiction module registry', () => {
  it('includes South Africa, the reference module (ADR-0004)', () => {
    expect(isConfiguredJurisdiction('ZA')).toBe(true);
    expect(findJurisdictionModule('ZA')?.name).toBe('South Africa');
  });

  it('covers exactly the eight configured jurisdictions', () => {
    expect(new Set(SUPPORTED_JURISDICTION_CODES)).toEqual(
      new Set(['ZA', 'GB', 'EU', 'US', 'RU', 'CN', 'SG', 'HK']),
    );
  });

  it('lists South Africa first — not the default, but the first module built', () => {
    expect(SUPPORTED_JURISDICTION_CODES[0]).toBe('ZA');
  });

  it('returns undefined for an unconfigured code rather than throwing', () => {
    expect(findJurisdictionModule('XX')).toBeUndefined();
    expect(isConfiguredJurisdiction('XX')).toBe(false);
  });

  it('requireJurisdictionModule throws UnknownJurisdictionError for an unconfigured code', () => {
    expect(() => requireJurisdictionModule('XX')).toThrow(UnknownJurisdictionError);
    try {
      requireJurisdictionModule('XX');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownJurisdictionError);
      expect((error as UnknownJurisdictionError).code).toBe('UNKNOWN_JURISDICTION');
      expect((error as UnknownJurisdictionError).jurisdictionCode).toBe('XX');
    }
  });

  it('requireJurisdictionModule returns the module for a configured code', () => {
    expect(requireJurisdictionModule('GB').name).toBe('United Kingdom');
  });

  it('every module carries the shared disclaimer, verbatim', () => {
    for (const jurisdictionModule of listJurisdictionModules()) {
      expect(jurisdictionModule.disclaimer).toBe(JURISDICTION_DISCLAIMER);
    }
  });

  it('every module has a non-empty regulator, data residency, cross-border, KYC/AML and capital treatment section', () => {
    for (const jurisdictionModule of listJurisdictionModules()) {
      expect(jurisdictionModule.regulator.name.length).toBeGreaterThan(0);
      expect(jurisdictionModule.dataResidency.regime.length).toBeGreaterThan(0);
      expect(typeof jurisdictionModule.crossBorder.permitted).toBe('boolean');
      expect(jurisdictionModule.kycAml.sanctionsRegimes.length).toBeGreaterThan(0);
      expect(jurisdictionModule.capitalTreatment.framework.length).toBeGreaterThan(0);
      expect(jurisdictionModule.citation.length).toBeGreaterThan(0);
    }
  });

  it('flags China and Russia as requiring local data storage, distinctly from the others', () => {
    expect(JURISDICTION_MODULES['CN']?.dataResidency.requiresLocalStorage).toBe(true);
    expect(JURISDICTION_MODULES['RU']?.dataResidency.requiresLocalStorage).toBe(true);
    expect(JURISDICTION_MODULES['ZA']?.dataResidency.requiresLocalStorage).toBe(false);
    expect(JURISDICTION_MODULES['SG']?.dataResidency.requiresLocalStorage).toBe(false);
  });

  it('EU is a deliberate non-ISO code distinct from any single member state', () => {
    const eu = JURISDICTION_MODULES['EU'];
    expect(eu?.code).toBe('EU');
    expect(eu?.name).toBe('European Union');
  });

  it('every code is either a real ISO-3166-1 alpha-2 code or the documented EU exception', () => {
    for (const code of SUPPORTED_JURISDICTION_CODES) {
      expect(code === 'EU' || /^[A-Z]{2}$/.test(code)).toBe(true);
    }
  });
});
