// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultStorage} from "./VaultTypes.sol";

/// A Diamond-safe reentrancy guard: the lock lives in the shared namespaced
/// storage every facet already uses (VaultStorage.Layout), not in a normal
/// state variable local to one facet contract -- a plain OpenZeppelin
/// ReentrancyGuard's storage slot layout does not compose safely across
/// delegatecall'd facets sharing one proxy address.
abstract contract VaultReentrancyGuard {
    error ReentrantCall();

    modifier nonReentrant() {
        VaultStorage.Layout storage s = VaultStorage.layout();
        if (s.reentrancyLocked) revert ReentrantCall();
        s.reentrancyLocked = true;
        _;
        s.reentrancyLocked = false;
    }
}
