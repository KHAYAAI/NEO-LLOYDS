# Neo-Lloyds stablecoin settlement vault

> UNAUDITED SKETCH -- not deployed to any network. This is the on-chain
> leg a future `StablecoinSettlementProvider` would call into; it does not
> replace anything in `apps/api` and nothing there calls it yet.

## What's here

```
src/VaultTypes.sol            Shared Diamond-storage struct, enums (TriggerMode, BundleStatus)
src/PricingLib.sol            The oracle-mode fee premium, as a pure function
src/VaultReentrancyGuard.sol  Diamond-safe reentrancy guard
src/SyndicationVaultFacet.sol Mirrors SyndicationService.bind() -- locks capital
src/ClaimTriggerFacet.sol     Mirrors ClaimsService.decide() -- releases capital
src/ExpiryFacet.sol           Coverage-expiry return path -- the common, uneventful case
scripts/compile.js            Compiles src/ against real solc + real @openzeppelin/contracts
```

Follows the Diamond pattern (EIP-2535), the same approach Nayms uses in
production (`github.com/nayms/contracts-v3`) and the same one
`nayms/diamond-2-hardhat` provides as reusable boilerplate: one proxy
address, facets upgradeable independently. `DiamondCutFacet`/
`DiamondLoupeFacet` themselves are not written yet -- the facets above are
the business logic that would sit behind them.

## What's verified vs. not

**Verified for real, in this repo:**
- `npm run compile` runs every `.sol` file in `src/` through the real
  `solc` npm package against the real `@openzeppelin/contracts` v5 library
  (`SafeERC20`, `ECDSA`, `MessageHashUtils`) -- not stubs, not
  reimplementations. It compiles clean (a handful of upstream OpenZeppelin
  deprecation warnings only, none from this package's own code).
- Getting there caught one real bug: the original `lockCapital` reverted
  with `CompilerError: Stack too deep` until `viaIR: true` was enabled --
  a genuine compiler-enforced correctness signal, not a stylistic warning.

**Not verified -- needs a real EVM, which this sandbox cannot reach:**
- No unit test has ever executed a single function in this package. `forge
  test` (Foundry) and `npx hardhat test` (Hardhat) were both attempted:
  Foundry's installer (`foundry.paradigm.xyz`) and Hardhat's own
  solc-binary downloader were both blocked by this sandbox's network
  egress policy -- the same wall this project has hit before
  (`registry.terraform.io` for the AWS stack, `api.stripe.com` for the
  settlement adapter). Compiling against real solc + real OpenZeppelin is
  the strongest check available here, not the check that was skipped by
  choice.
- No contract has been deployed anywhere, testnet or mainnet.
- `_verifyOracleReport` / ORACLE-mode `releaseClaim` deliberately
  `revert()`s rather than pretending to verify anything -- no oracle
  network has been chosen (design doc §05), and a fake verification path
  would be worse than an honest "not implemented".

## What's a placeholder by design, not an oversight

- **Governance/relayer bootstrapping.** `initializeGovernance` is a plain
  function callable once, not a real Diamond `init` pattern -- there's no
  deployment tooling in this package yet to wire that up properly.
- **Fee treasury routing.** `ClaimTriggerFacet.releaseClaim` computes and
  deducts the fee correctly but doesn't send it anywhere yet -- needs the
  same treasury-address decision `SettlementService` already makes
  off-chain.
- **Oracle verification.** Explicitly unimplemented -- see above.

## The pricing decision this implements

`PricingLib.settlementFeeBps` charges ORACLE-mode bundles
`baseSettlementFeeBps + oraclePremiumBps`; ATTESTATION-mode bundles pay
`baseSettlementFeeBps` only. Both parameters are governance-settable
(`ClaimTriggerFacet.setFeeParameters`), deliberately not hardcoded, so
`oraclePremiumBps` can be set to (real oracle-network cost + a modest
margin) once that cost is actually known -- nothing here invents a
number. `quoteSettlementFee` is a read-only function so a capital
provider can see the exact price of their chosen trigger mode before
funding a bundle, before this is UI-exposed anywhere.

## Before this touches a single real dollar

1. Pick a chain and a stablecoin (design doc §05, still open).
2. Pick an oracle network and implement `_verifyOracleReport` for real.
3. Decide the custody/counsel question this design doc's §02 raised --
   this code assumes that decision landed on "smart-contract vault", it
   doesn't make the decision itself.
4. Get this compiling and passing real unit tests against a real EVM
   (Foundry or Hardhat, outside this sandbox's network restrictions).
5. An independent smart-contract audit. Non-negotiable, same as the
   independent pentest the rest of the platform still needs before launch.
6. Only then does `StablecoinSettlementProvider` (apps/api) get written
   to call into this, the same way `StripeSettlementProvider` calls into
   a real, live-verified Stripe account.
