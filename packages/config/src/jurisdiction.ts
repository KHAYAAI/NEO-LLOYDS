/**
 * Jurisdiction modules (ADR-0004, docs/decisions/0004-jurisdiction-modules.md).
 * The core domain (`packages/domain`) is jurisdiction-neutral by design and
 * has no dependency on this package or vice versa — jurisdiction rules are
 * configuration that sits beside the core, never inside it. South Africa is
 * the first module because the strategic HQ is Johannesburg; it is not the
 * fallback, and there is no default jurisdiction anywhere in this system.
 *
 * IMPORTANT — READ BEFORE USING ANY FIELD BELOW: every module here is an
 * illustrative summary of a real regulatory regime, not legal advice, and
 * not a substitute for qualified local counsel. Regulator names and the
 * broad shape of each regime (who regulates insurance, what the applicable
 * data-protection statute is called) are stated as public facts. Every
 * numeric threshold, every "STANDARD vs ENHANCED" KYC/AML level, and every
 * capital-treatment note is a placeholder consistent with how every other
 * threshold in this system is documented (Phase 3's approval bands, Phase
 * 7's auto-approval ceiling) — a defensible starting shape, not a
 * calibrated legal or actuarial position. Shipping a jurisdiction module
 * that looked like real compliance advice would be worse than shipping none
 * — the same principle stated for SSO (security-model.md §10) and for the
 * Phase 8 loss model.
 */

export const JURISDICTION_DISCLAIMER =
  'Illustrative regulatory summary only — not legal advice. Verify against ' +
  'current law and consult qualified local counsel before any real-world use.';

export type KycAmlLevel = 'STANDARD' | 'ENHANCED';

export interface JurisdictionRegulator {
  /** The primary insurance-market regulator(s), by common name. */
  readonly name: string;
  /** What that regulator's remit covers, in one sentence. */
  readonly scope: string;
}

export interface DataResidencyRule {
  readonly requiresLocalStorage: boolean;
  /** The governing data-protection statute, by common name. */
  readonly regime: string;
  readonly note: string;
}

export interface CrossBorderRule {
  readonly permitted: boolean;
  readonly note: string;
}

export interface KycAmlRule {
  readonly level: KycAmlLevel;
  /** Sanctions/watch-list regimes this jurisdiction's screening is expected to check, by common name. */
  readonly sanctionsRegimes: readonly string[];
  readonly note: string;
}

export interface CapitalTreatmentRule {
  /** The prudential framework this jurisdiction's real regulator uses, by common name. */
  readonly framework: string;
  /** Illustrative only — see the module-level disclaimer. Never a real solvency figure. */
  readonly note: string;
}

export interface JurisdictionModule {
  /** ISO-3166-1 alpha-2, except `EU`, used deliberately as a non-ISO shorthand for supranational EU-level rules distinct from any single member state. */
  readonly code: string;
  readonly name: string;
  readonly regulator: JurisdictionRegulator;
  readonly dataResidency: DataResidencyRule;
  readonly crossBorder: CrossBorderRule;
  readonly kycAml: KycAmlRule;
  readonly capitalTreatment: CapitalTreatmentRule;
  /** Non-binding pointer to the real statute(s)/framework(s) this module summarises. Not a citation a court would accept. */
  readonly citation: string;
  readonly disclaimer: typeof JURISDICTION_DISCLAIMER;
}

function module(input: Omit<JurisdictionModule, 'disclaimer'>): JurisdictionModule {
  return Object.freeze({ ...input, disclaimer: JURISDICTION_DISCLAIMER });
}

/**
 * South Africa — the reference module (ADR-0004): built first, and every
 * other module is held to the same shape and honesty bar, not a lighter one.
 */
const ZA = module({
  code: 'ZA',
  name: 'South Africa',
  regulator: {
    name: 'Financial Sector Conduct Authority (FSCA) & Prudential Authority',
    scope: 'Market conduct (FSCA) and prudential solvency (Prudential Authority, housed at the SARB) for insurers.',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'Protection of Personal Information Act (POPIA)',
    note: 'Cross-border transfer is permitted under POPIA conditions (adequate protection at the destination, or consent); not a blanket local-storage mandate.',
  },
  crossBorder: {
    permitted: true,
    note: 'Cross-border reinsurance/risk transfer is a routine, regulated activity — illustrative placeholder pending real prudential review, not a legal clearance.',
  },
  kycAml: {
    level: 'STANDARD',
    sanctionsRegimes: ['UN Security Council Consolidated List', 'South African TFS (Targeted Financial Sanctions) lists'],
    note: 'FICA (Financial Intelligence Centre Act) governs KYC/AML obligations for accountable institutions.',
  },
  capitalTreatment: {
    framework: 'SAM (Solvency Assessment and Management) — South Africa\'s Solvency II-aligned regime',
    note: 'Illustrative only. No real SCR/MCR calculation exists in this system.',
  },
  citation: 'Insurance Act 18 of 2017; POPIA; FICA; SAM regulatory framework',
});

const GB = module({
  code: 'GB',
  name: 'United Kingdom',
  regulator: {
    name: 'Financial Conduct Authority (FCA) & Prudential Regulation Authority (PRA)',
    scope: 'Conduct (FCA) and prudential solvency (PRA, part of the Bank of England) for insurers.',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'UK GDPR & Data Protection Act 2018',
    note: 'Post-Brexit UK GDPR is a distinct regime from EU GDPR; an EU adequacy decision currently permits UK-EU data flows, subject to periodic review.',
  },
  crossBorder: {
    permitted: true,
    note: 'Illustrative placeholder — the UK operates its own equivalence framework for cross-border insurance business, separate from the EU\'s.',
  },
  kycAml: {
    level: 'STANDARD',
    sanctionsRegimes: ['UK HM Treasury (OFSI) sanctions list', 'UN Security Council Consolidated List'],
    note: 'The Money Laundering Regulations 2017 (as amended) govern KYC/AML for UK-regulated firms.',
  },
  capitalTreatment: {
    framework: 'UK Solvency II (onshored, diverging from EU Solvency II post-Brexit)',
    note: 'Illustrative only. No real SCR/MCR calculation exists in this system.',
  },
  citation: 'Financial Services and Markets Act 2000 (as amended); UK GDPR; Money Laundering Regulations 2017',
});

/**
 * A deliberate, documented exception to "code is ISO-3166-1 alpha-2":
 * represents EU-level rules (GDPR, Solvency II, EIOPA) distinct from any one
 * member state's national regulator, which real cross-border EU placements
 * must account for at both levels.
 */
const EU = module({
  code: 'EU',
  name: 'European Union',
  regulator: {
    name: 'EIOPA (coordinating) & national competent authorities per member state',
    scope: 'EIOPA sets EU-wide supervisory standards; day-to-day prudential and conduct supervision is delegated to each member state\'s own regulator.',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'General Data Protection Regulation (GDPR)',
    note: 'Transfers outside the EEA require an adequacy decision, standard contractual clauses, or another Article 46 safeguard — not a blanket local-storage mandate.',
  },
  crossBorder: {
    permitted: true,
    note: 'Freedom to provide services/establishment across EEA member states under Solvency II passporting — illustrative placeholder, not a licensing determination.',
  },
  kycAml: {
    level: 'STANDARD',
    sanctionsRegimes: ['EU Consolidated Sanctions List', 'UN Security Council Consolidated List'],
    note: 'The EU AML framework (currently the 6th AML Directive, moving toward the AMLR/AMLA single rulebook) governs KYC/AML across member states.',
  },
  capitalTreatment: {
    framework: 'Solvency II',
    note: 'Illustrative only. No real SCR/MCR calculation exists in this system.',
  },
  citation: 'Solvency II Directive 2009/138/EC; GDPR (EU) 2016/679; EU AML Directives',
});

const US = module({
  code: 'US',
  name: 'United States',
  regulator: {
    name: 'State insurance departments, coordinated via the NAIC',
    scope: 'Insurance is regulated at the state level in the US — there is no single federal insurance regulator; the NAIC coordinates model laws and standards across states.',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'A state-by-state patchwork (e.g. CCPA/CPRA in California) — no single federal data-protection statute',
    note: 'Data-protection obligations depend on which US states the counterparties/data subjects are in, not a single national rule.',
  },
  crossBorder: {
    permitted: true,
    note: 'Illustrative placeholder — surplus lines and reinsurance have their own state-by-state and NAIC-coordinated frameworks (e.g. credit for reinsurance rules).',
  },
  kycAml: {
    level: 'ENHANCED',
    sanctionsRegimes: ['OFAC Specially Designated Nationals (SDN) List', 'UN Security Council Consolidated List'],
    note: 'Bank Secrecy Act / OFAC sanctions screening applies to US-nexus transactions regardless of which state licenses the insurer.',
  },
  capitalTreatment: {
    framework: 'RBC (Risk-Based Capital), the NAIC\'s model framework, as adopted per state',
    note: 'Illustrative only. No real RBC calculation exists in this system.',
  },
  citation: 'State insurance codes (per-state); NAIC model laws; Bank Secrecy Act; OFAC sanctions program',
});

const RU = module({
  code: 'RU',
  name: 'Russian Federation',
  regulator: {
    name: 'Bank of Russia (Central Bank of the Russian Federation)',
    scope: 'The Bank of Russia is both the central bank and the insurance/financial-market regulator.',
  },
  dataResidency: {
    requiresLocalStorage: true,
    regime: 'Federal Law No. 152-FZ "On Personal Data"',
    note: 'Russian law requires personal data of Russian citizens to be initially recorded, stored, and processed using databases located within the Russian Federation.',
  },
  crossBorder: {
    permitted: false,
    note: 'Illustrative placeholder: cross-border risk transfer/reinsurance and broader international engagement face material sanctions-driven restrictions that are jurisdiction- and counterparty-specific — flagged as materially restricted rather than defaulted open, pending real sanctions-screening integration (security-model.md §8).',
  },
  kycAml: {
    level: 'ENHANCED',
    sanctionsRegimes: ['OFAC Specially Designated Nationals (SDN) List', 'UK HM Treasury (OFSI) sanctions list', 'EU Consolidated Sanctions List'],
    note: 'Enhanced by default given the current international sanctions environment — this system has no real sanctions-screening integration yet (security-model.md §8), so this jurisdiction requires manual review before any live use, not automated clearance.',
  },
  capitalTreatment: {
    framework: 'Bank of Russia solvency requirements for insurers',
    note: 'Illustrative only. No real solvency calculation exists in this system.',
  },
  citation: 'Federal Law No. 4015-1 "On the Organization of Insurance Business"; Federal Law No. 152-FZ "On Personal Data"',
});

const CN = module({
  code: 'CN',
  name: "People's Republic of China",
  regulator: {
    name: 'National Financial Regulatory Administration (NFRA)',
    scope: 'NFRA (formed 2023, absorbing the former CBIRC) regulates the insurance and banking industries.',
  },
  dataResidency: {
    requiresLocalStorage: true,
    regime: 'Personal Information Protection Law (PIPL), Data Security Law, Cybersecurity Law',
    note: 'PIPL imposes strict conditions on cross-border transfer of personal information, including security assessments for large-scale or sensitive transfers — among the strictest data-localisation regimes covered by this system.',
  },
  crossBorder: {
    permitted: false,
    note: 'Illustrative placeholder: cross-border (re)insurance and capital flows are subject to material foreign-exchange and regulatory-approval controls — flagged as materially restricted rather than defaulted open.',
  },
  kycAml: {
    level: 'ENHANCED',
    sanctionsRegimes: ['UN Security Council Consolidated List', "China's own domestic counter-terrorism financing designations"],
    note: 'Anti-Money Laundering Law of the PRC governs KYC/AML for regulated financial institutions.',
  },
  capitalTreatment: {
    framework: 'C-ROSS (China Risk-Oriented Solvency System)',
    note: 'Illustrative only. No real solvency calculation exists in this system.',
  },
  citation: 'Insurance Law of the PRC; Personal Information Protection Law (PIPL); Data Security Law',
});

const SG = module({
  code: 'SG',
  name: 'Singapore',
  regulator: {
    name: 'Monetary Authority of Singapore (MAS)',
    scope: 'MAS is Singapore\'s integrated financial regulator, covering banking, insurance, and capital markets.',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'Personal Data Protection Act (PDPA)',
    note: 'PDPA permits cross-border transfer subject to comparable-protection conditions; not a local-storage mandate.',
  },
  crossBorder: {
    permitted: true,
    note: 'Singapore positions itself as a regional reinsurance/risk-transfer hub — illustrative placeholder, not a licensing determination.',
  },
  kycAml: {
    level: 'STANDARD',
    sanctionsRegimes: ['UN Security Council Consolidated List', 'MAS Targeted Financial Sanctions lists'],
    note: 'The MAS Notices on Prevention of Money Laundering and Countering the Financing of Terrorism govern KYC/AML for regulated entities.',
  },
  capitalTreatment: {
    framework: 'RBC 2 (Risk-Based Capital framework, MAS)',
    note: 'Illustrative only. No real solvency calculation exists in this system.',
  },
  citation: 'Insurance Act 1966 (Singapore); Personal Data Protection Act 2012',
});

const HK = module({
  code: 'HK',
  name: 'Hong Kong SAR',
  regulator: {
    name: 'Insurance Authority (IA)',
    scope: 'The IA has been Hong Kong\'s independent statutory insurance regulator since 2017 (previously the Office of the Commissioner of Insurance).',
  },
  dataResidency: {
    requiresLocalStorage: false,
    regime: 'Personal Data (Privacy) Ordinance (PDPO)',
    note: 'PDPO governs cross-border data transfer conditions; not a blanket local-storage mandate, though the relevant transfer-restriction provision (s.33) has a long, complex history of non-commencement — flagged for real legal review before use.',
  },
  crossBorder: {
    permitted: true,
    note: 'Hong Kong positions itself as a regional and Greater Bay Area risk hub — illustrative placeholder, not a licensing determination.',
  },
  kycAml: {
    level: 'STANDARD',
    sanctionsRegimes: ['UN Security Council Consolidated List', 'Hong Kong Cap. 575 (UN Sanctions Ordinance) designations'],
    note: 'The Anti-Money Laundering and Counter-Terrorist Financing Ordinance (Cap. 615) governs KYC/AML for insurers.',
  },
  capitalTreatment: {
    framework: 'Risk-based Capital (RBC) regime for Hong Kong insurers',
    note: 'Illustrative only. No real solvency calculation exists in this system.',
  },
  citation: 'Insurance Ordinance (Cap. 41); Personal Data (Privacy) Ordinance (Cap. 486)',
});

/** Registry, keyed by code. South Africa first, deliberately (ADR-0004) — not alphabetical, not the default. */
export const JURISDICTION_MODULES: Readonly<Record<string, JurisdictionModule>> = Object.freeze({
  ZA,
  GB,
  EU,
  US,
  RU,
  CN,
  SG,
  HK,
});

export const SUPPORTED_JURISDICTION_CODES: readonly string[] = Object.freeze(
  Object.keys(JURISDICTION_MODULES),
);

export class UnknownJurisdictionError extends Error {
  readonly code = 'UNKNOWN_JURISDICTION';
  readonly jurisdictionCode: string;

  constructor(jurisdictionCode: string) {
    super(`No jurisdiction module is configured for "${jurisdictionCode}"`);
    this.name = 'UnknownJurisdictionError';
    this.jurisdictionCode = jurisdictionCode;
  }
}

export function isConfiguredJurisdiction(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(JURISDICTION_MODULES, code);
}

export function findJurisdictionModule(code: string): JurisdictionModule | undefined {
  return JURISDICTION_MODULES[code];
}

export function requireJurisdictionModule(code: string): JurisdictionModule {
  const found = findJurisdictionModule(code);
  if (!found) throw new UnknownJurisdictionError(code);
  return found;
}

export function listJurisdictionModules(): readonly JurisdictionModule[] {
  return Object.values(JURISDICTION_MODULES);
}
