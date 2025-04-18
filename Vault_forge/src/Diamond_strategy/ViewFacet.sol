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
                if (block.timestamp >= deposits[i].timestamp + DiamondStorage.LOCK_PERIOD) {
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
        return block.timestamp >= ds.lastDailyUpdate + DiamondStorage.UPDATE_INTERVAL;
    }

    function maxWithdraw(address _owner) external view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalUserAssets = this.convertToAssets(ds.balances[_owner]);

        // Check if ANY deposits are unlocked
        bool hasUnlockedDeposits = false;
        for (uint256 i = 0; i < ds.userStakedDeposits[_owner].length; i++) {
            if (
                block.timestamp >=
                ds.userStakedDeposits[_owner][i].timestamp + DiamondStorage.LOCK_PERIOD
            ) {
                hasUnlockedDeposits = true;
                break;
            }
        }

        if (!hasUnlockedDeposits) {
            return (ds.totalAssets * DiamondStorage.INSTANT_WITHDRAWAL_LIMIT) / 100;
        }
        return totalUserAssets;
    }

    // Helper conversion function used by many facets
    function convertToAssets(uint256 shares) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.totalShares == 0) {
            return shares;
        }
        return (shares * ds.totalAssets) / ds.totalShares;
    }
}
