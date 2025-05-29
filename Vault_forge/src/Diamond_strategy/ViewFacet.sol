// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";

interface ILidoWithdrawal {
    function isWithdrawalFinalized(
        uint256 requestId
    ) external view returns (bool);
}

contract ViewFacet {
    function totalAssets() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalAssets;
    }

    function totalShares() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalShares;
    }

    function totalSupply() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalShares;
    }

    function balanceOf(address _owner) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.balances[_owner];
    }

    function exchangeRate() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.totalShares == 0) {
            return 1e6;
        }
        // Include both liquid and staked assets
        uint256 totalValue = ds.totalAssets + ds.totalStakedValue;
        return (totalValue * 1e6) / ds.totalShares;
    }

    function getUsedLiquidPortion(
        address user
    ) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalLiquidPortion = (ds.userDeposits[user] *
            DiamondStorage.LIQUID_PORTION) / 100;

        if (ds.usedLiquidPortion[user] >= totalLiquidPortion) {
            return totalLiquidPortion; // Cap at total liquid portion
        }

        return ds.usedLiquidPortion[user];
    }

    function getRemainingLiquidPortion(
        address user
    ) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalLiquidPortion = (ds.userDeposits[user] *
            DiamondStorage.LIQUID_PORTION) / 100;

        if (ds.usedLiquidPortion[user] >= totalLiquidPortion) {
            return 0;
        }

        return totalLiquidPortion - ds.usedLiquidPortion[user];
    }

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

    function getUnlockTime(
        address user
    ) external view returns (uint256[] memory) {
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
                unlockTimes[index] =
                    deposits[i].timestamp +
                    DiamondStorage.LOCK_PERIOD;
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
        uint256[] memory times = this.getUnlockTime(user);
        if (times.length == 0) return 0;
        return times[0]; // Return earliest maturity date
    }

    function getWithdrawableAmount(
        address user
    ) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalUserBalance = this.convertToAssets(ds.balances[user]);

        // If user has no balance, nothing to withdraw
        if (totalUserBalance == 0) return 0;

        // Get all user's staked deposits
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[
            user
        ];

        // For users with no staked deposits, check global timestamp
        if (deposits.length == 0) {
            bool isLocked = block.timestamp <
                ds.depositTimestamps[user] + DiamondStorage.LOCK_PERIOD;
            return
                isLocked
                    ? (totalUserBalance * DiamondStorage.LIQUID_PORTION) / 100
                    : totalUserBalance;
        }

        // Track matured and unmatured portions
        uint256 maturedValue = 0;
        uint256 unmaturedValue = 0;

        // Calculate the value of matured/unmatured deposits
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                if (
                    block.timestamp >=
                    deposits[i].timestamp + DiamondStorage.LOCK_PERIOD
                ) {
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
        uint256 withdrawableFromUnmatured = (unmaturedValue *
            DiamondStorage.LIQUID_PORTION) / 100;

        // Total withdrawable value is matured deposits + withdrawable portion of unmatured
        uint256 totalWithdrawableValue = maturedValue +
            withdrawableFromUnmatured;

        // Calculate ratio using proper USDC decimals (1e6)
        uint256 withdrawableRatio = (totalWithdrawableValue * 1e6) /
            userTotalStaked;

        // Apply the ratio to total balance
        return (totalUserBalance * withdrawableRatio) / 1e6;
    }

    function getLockedAmount(address user) external view returns (uint256) {
        uint256 withdrawable = this.getWithdrawableAmount(user);
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalUserBalance = this.convertToAssets(ds.balances[user]);

        // Prevent underflow if withdrawable exceeds balance for any reason
        return
            withdrawable >= totalUserBalance
                ? 0
                : totalUserBalance - withdrawable;
    }

    function getTotalStakedAssets() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.totalStakedValue;
    }

    function isUpdateNeeded() external view returns (bool) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return
            block.timestamp >=
            ds.lastDailyUpdate + DiamondStorage.UPDATE_INTERVAL;
    }

    // Helper conversion function used by many facets
    function convertToAssets(uint256 shares) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.totalShares == 0) {
            return shares;
        }
        return (shares * ds.totalAssets) / ds.totalShares;
    }

    function accumulatedFees() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.accumulatedFees;
    }

    function lastUpdateTime() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.lastUpdateTime;
    }

    function lastDailyUpdate() external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        return ds.lastDailyUpdate;
    }

    function maxWithdraw(address _owner) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Calculate total liquid portion (60% of total deposits)
        uint256 totalLiquidPortion = (ds.userDeposits[_owner] *
            DiamondStorage.LIQUID_PORTION) / 100;

        // Calculate remaining liquid portion
        uint256 remainingLiquidPortion = 0;
        if (totalLiquidPortion > ds.usedLiquidPortion[_owner]) {
            remainingLiquidPortion =
                totalLiquidPortion -
                ds.usedLiquidPortion[_owner];
        }

        // Start with remaining liquid portion
        uint256 withdrawable = remainingLiquidPortion;

        // Add matured deposits
        for (uint256 i = 0; i < ds.userStakedDeposits[_owner].length; i++) {
            if (
                !ds.userStakedDeposits[_owner][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[_owner][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                withdrawable += ds.userStakedDeposits[_owner][i].amount;
            }
        }

        // Cap the withdrawable amount by the user's total balance
        uint256 totalBalance = this.convertToAssets(ds.balances[_owner]);
        if (withdrawable > totalBalance) {
            withdrawable = totalBalance;
        }

        return withdrawable;
    }

    // Add a new helper function to get calculated withdrawal info
    function getWithdrawalDetails(
        address user
    )
        external
        view
        returns (
            uint256 totalDeposit,
            uint256 totalLiquid,
            uint256 usedLiquid,
            uint256 remainingLiquid,
            uint256 lockedAmount,
            uint256 maturedLockedAmount,
            uint256 totalWithdrawable
        )
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Calculate total amounts
        totalDeposit = ds.userDeposits[user];
        totalLiquid = (totalDeposit * DiamondStorage.LIQUID_PORTION) / 100;
        usedLiquid = ds.usedLiquidPortion[user];

        // Calculate remaining liquid portion
        remainingLiquid = 0;
        if (totalLiquid > usedLiquid) {
            remainingLiquid = totalLiquid - usedLiquid;
        }

        // Calculate matured locked deposits
        maturedLockedAmount = 0;
        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                maturedLockedAmount += ds.userStakedDeposits[user][i].amount;
            }
        }

        // Calculate total locked amount (40% of deposits)
        lockedAmount = (totalDeposit * DiamondStorage.STAKED_PORTION) / 100;

        // Calculate total withdrawable
        totalWithdrawable = remainingLiquid + maturedLockedAmount;

        // Cap by user's actual balance
        uint256 totalBalance = this.convertToAssets(ds.balances[user]);
        if (totalWithdrawable > totalBalance) {
            totalWithdrawable = totalBalance;
        }

        return (
            totalDeposit,
            totalLiquid,
            usedLiquid,
            remainingLiquid,
            lockedAmount,
            maturedLockedAmount,
            totalWithdrawable
        );
    }
}
