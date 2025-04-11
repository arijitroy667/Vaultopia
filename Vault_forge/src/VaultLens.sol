//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import interfaces
import "./Interfaces.sol";
import "./VaultStorage.sol"; // For struct definitions

interface IYield_Bull {
    // Define view functions from Yield_Bull that you need
    function isUpdateNeeded() external view returns (bool);

    function exchangeRate() external view returns (uint256);

    function getWithdrawalStatus(
        address user
    )
        external
        view
        returns (bool isInProgress, uint256 requestId, bool isFinalized);

    function getUnlockTime(
        address user
    ) external view returns (uint256[] memory);

    function getNearestUnlockTime(address user) external view returns (uint256);

    function getWithdrawableAmount(
        address user
    ) external view returns (uint256);

    function getLockedAmount(address user) external view returns (uint256);

    function getTotalStakedAssets() external view returns (uint256);

    function convertToAssets(uint256 shares) external view returns (uint256);

    // Read-only access to state variables
    function totalShares() external view returns (uint256);

    function totalAssets() external view returns (uint256);

    function totalStakedValue() external view returns (uint256);

    function lastDailyUpdate() external view returns (uint256);

    function UPDATE_INTERVAL() external view returns (uint256);

    function LOCK_PERIOD() external view returns (uint256);

    function LIQUID_PORTION() external view returns (uint256);
}

contract VaultLens {
    IYield_Bull public immutable vault;

    constructor(address _vault) {
        vault = IYield_Bull(_vault);
    }

    function isUpdateNeeded() public view returns (bool) {
        return vault.isUpdateNeeded();
    }

    function exchangeRate() public view returns (uint256) {
        return vault.exchangeRate();
    }

    function getWithdrawalStatus(
        address user
    )
        external
        view
        returns (bool isInProgress, uint256 requestId, bool isFinalized)
    {
        return vault.getWithdrawalStatus(user);
    }

    function getUnlockTime(
        address user
    ) public view returns (uint256[] memory) {
        return vault.getUnlockTime(user);
    }

    function getNearestUnlockTime(address user) public view returns (uint256) {
        return vault.getNearestUnlockTime(user);
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        return vault.getWithdrawableAmount(user);
    }

    function getLockedAmount(address user) public view returns (uint256) {
        return vault.getLockedAmount(user);
    }

    function getTotalStakedAssets() public view returns (uint256) {
        return vault.getTotalStakedAssets();
    }
}
