// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface ILidoWithdrawal {
    function isWithdrawalFinalized(
        uint256 _requestId
    ) external view returns (bool);
}

contract ViewFacet {
    using SafeMath for uint256;
    using Math for uint256;

    // Constants
    uint256 private constant LOCK_PERIOD = 30 days;
    uint256 private constant LIQUID_PORTION = 60; // 60% can be withdrawn immediately

    // Basic vault info
    function totalAssets() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalAssets;
    }

    function totalShares() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalShares;
    }

    function totalStakedValue() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalStakedValue;
    }

    function exchangeRate() public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalShares == 0) {
            return 1e6; // Default 1:1 ratio with 6 decimals
        }

        // Include both liquid and staked assets
        uint256 totalValue = ds.totalAssets + ds.totalStakedValue;
        return (totalValue * 1e6) / ds.totalShares;
    }

    function userDeposit(address user) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.userDeposits[user];
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalShares == 0) {
            return shares;
        }

        uint256 totalValue = ds.totalAssets + ds.totalStakedValue;
        return (shares * totalValue) / ds.totalShares;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalAssets == 0 || ds.totalShares == 0) {
            return assets;
        }

        return
            (assets * ds.totalShares) / (ds.totalAssets + ds.totalStakedValue);
    }

    // Withdrawal status and timing
    function getWithdrawalStatus(
        address user
    )
        external
        view
        returns (bool isInProgress, uint256 requestId, bool isFinalized)
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        isInProgress = ds.withdrawalInProgress[user];
        requestId = ds.withdrawalRequestIds[user];
        isFinalized = requestId > 0
            ? ILidoWithdrawal(ds.lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
            : false;
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalUserBalance = convertToAssets(ds.balances[user]);

        // If user has no balance, nothing to withdraw
        if (totalUserBalance == 0) return 0;

        // Get all user's staked deposits
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[
            user
        ];

        // For users with no staked deposits, check global timestamp
        if (deposits.length == 0) {
            bool isLocked = block.timestamp <
                ds.depositTimestamps[user] + LOCK_PERIOD;
            return
                isLocked
                    ? (totalUserBalance * LIQUID_PORTION) / 100
                    : totalUserBalance;
        }

        // Track matured and unmatured portions
        uint256 maturedValue = 0;
        uint256 unmaturedValue = 0;

        // Calculate the value of matured/unmatured deposits
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                if (block.timestamp >= deposits[i].timestamp + LOCK_PERIOD) {
                    maturedValue += deposits[i].amount;
                } else {
                    unmaturedValue += deposits[i].amount;
                }
            }
        }

        // Calculate total staked value
        uint256 userTotalStaked = maturedValue + unmaturedValue;

        // If all deposits are mature or no deposits exist, everything is withdrawable
        if (userTotalStaked == 0 || unmaturedValue == 0) {
            return totalUserBalance;
        }

        // Calculate withdrawable portion of unmatured deposits (60%)
        uint256 withdrawableFromUnmatured = (unmaturedValue * LIQUID_PORTION) /
            100;

        // Total withdrawable value is matured deposits + withdrawable portion of unmatured
        uint256 totalWithdrawableValue = maturedValue +
            withdrawableFromUnmatured;

        // Calculate ratio using proper USDC decimals (1e6)
        uint256 withdrawableRatio = (totalWithdrawableValue * 1e6) /
            userTotalStaked;

        // Apply the ratio to total balance
        return (totalUserBalance * withdrawableRatio) / 1e6;
    }

    function getLockedAmount(address user) public view returns (uint256) {
        uint256 withdrawable = getWithdrawableAmount(user);
        uint256 totalUserBalance = convertToAssets(balanceOf(user));

        // Prevent underflow if withdrawable exceeds balance for any reason
        return
            withdrawable >= totalUserBalance
                ? 0
                : totalUserBalance - withdrawable;
    }

    function getUnlockTime(
        address user
    ) public view returns (uint256[] memory) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Get the user's deposits
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[
            user
        ];

        // Count active (non-withdrawn) deposits
        uint256 activeCount = 0;
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                activeCount++;
            }
        }

        // Create array for unlock times
        uint256[] memory unlockTimes = new uint256[](activeCount);

        // Populate array with unlock times for active deposits
        uint256 index = 0;
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                unlockTimes[index] = deposits[i].timestamp + LOCK_PERIOD;
                index++;
            }
        }

        // Sort array from nearest to farthest (simple bubble sort)
        for (uint256 i = 0; i < unlockTimes.length; i++) {
            for (uint256 j = i + 1; j < unlockTimes.length; j++) {
                if (unlockTimes[j] < unlockTimes[i]) {
                    uint256 temp = unlockTimes[i];
                    unlockTimes[i] = unlockTimes[j];
                    unlockTimes[j] = temp;
                }
            }
        }

        return unlockTimes;
    }

    function getNearestUnlockTime(
        address user
    ) external view returns (uint256) {
        uint256[] memory times = getUnlockTime(user);
        if (times.length == 0) return 0;
        return times[0]; // Return earliest maturity date
    }

    // Vault status functions
    function getTotalStakedAssets() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        uint256 totalStaked = 0;

        // Iterate through all users
        for (uint256 i = 0; i < ds.userAddresses.length; i++) {
            address user = ds.userAddresses[i];

            // Get all of this user's staked deposits
            DiamondStorage.StakedDeposit[] storage deposits = ds
                .userStakedDeposits[user];

            // Sum up all non-withdrawn deposits
            for (uint256 j = 0; j < deposits.length; j++) {
                if (!deposits[j].withdrawn) {
                    totalStaked += deposits[j].amount;
                }
            }
        }

        return totalStaked;
    }

    function isUpdateNeeded() external view returns (bool) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 UPDATE_INTERVAL = 1 days; // Assuming 1 day update interval
        return block.timestamp >= ds.lastDailyUpdate + UPDATE_INTERVAL;
    }

    function getUserWstETHBalance(
        address user
    ) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.userWstETHBalance[user];
    }

    function getUserStakedDeposits(
        address user
    )
        external
        view
        returns (
            uint256[] memory amounts,
            uint256[] memory timestamps,
            uint256[] memory wstETHAmounts,
            bool[] memory withdrawnStatus
        )
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[
            user
        ];

        uint256 length = deposits.length;

        amounts = new uint256[](length);
        timestamps = new uint256[](length);
        wstETHAmounts = new uint256[](length);
        withdrawnStatus = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            amounts[i] = deposits[i].amount;
            timestamps[i] = deposits[i].timestamp;
            wstETHAmounts[i] = deposits[i].wstETHAmount;
            withdrawnStatus[i] = deposits[i].withdrawn;
        }

        return (amounts, timestamps, wstETHAmounts, withdrawnStatus);
    }

    // Configuration and state info
    function getConfiguration()
        external
        view
        returns (
            address owner,
            address feeCollector,
            address assetToken,
            address lidoWithdrawalAddress,
            address wstETHAddress,
            address receiverContract,
            address swapContract,
            bool emergencyShutdown,
            bool depositsPaused
        )
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        return (
            ds.owner,
            ds.feeCollector,
            ds.ASSET_TOKEN_ADDRESS,
            ds.lidoWithdrawalAddress,
            ds.wstETHAddress,
            ds.receiverContract,
            ds.swapContract,
            ds.emergencyShutdown,
            ds.depositsPaused
        );
    }

    function getAccumulatedFees() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.accumulatedFees;
    }

    function balanceOf(address user) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.balances[user];
    }
}
