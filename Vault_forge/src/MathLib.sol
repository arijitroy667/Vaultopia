// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MathLib {
    function convertToShares(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares
    ) internal pure returns (uint256 shares) {
        if (totalShares == 0 || totalAssets == 0) {
            return assets;
        }
        return (assets * totalShares) / totalAssets;
    }

    function convertToAssets(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares
    ) internal pure returns (uint256 assets) {
        if (totalShares == 0) {
            return 0;
        }
        return (shares * totalAssets) / totalShares;
    }
}
