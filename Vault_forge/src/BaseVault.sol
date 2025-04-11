// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./VaultStorage.sol";
import "./MathLib.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract BaseVault is VaultStorage {
    using MathLib for uint256;
    using SafeERC20 for IERC20;

    constructor(address _assetToken) VaultStorage(_assetToken) {}

    function maxDeposit(
        address receiver
    ) public view returns (uint256 maxAssets) {
        uint256 deposited = userDeposits[receiver];
        return
            deposited >= MAX_DEPOSIT_PER_USER
                ? 0
                : MAX_DEPOSIT_PER_USER - deposited;
    }

    function previewDeposit(
        uint256 assets
    ) public view returns (uint256 shares) {
        require(assets > 0, "Deposit amount must be greater than zero");
        return convertToShares(assets);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets.convertToShares(totalAssets, totalShares);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares.convertToAssets(totalAssets, totalShares);
    }

    function maxWithdraw(
        address _owner
    ) public view returns (uint256 maxAssets) {
        uint256 totalUserAssets = convertToAssets(balances[_owner]);

        // Check if ANY deposits are unlocked
        bool hasUnlockedDeposits = false;
        for (uint256 i = 0; i < userStakedDeposits[_owner].length; i++) {
            if (
                block.timestamp >=
                userStakedDeposits[_owner][i].timestamp + LOCK_PERIOD
            ) {
                hasUnlockedDeposits = true;
                break;
            }
        }

        if (!hasUnlockedDeposits) {
            return (totalAssets * INSTANT_WITHDRAWAL_LIMIT) / 100;
        }
        return totalUserAssets;
    }

    function previewWithdraw(
        uint256 assets
    ) public view returns (uint256 shares) {
        require(assets > 0, "Assets must be greater than zero");
        shares = convertToShares(assets);
        return shares > 0 ? shares : 1; // Ensure at least 1 share is burned
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address _owner
    ) public nonReentrant returns (uint256 shares) {
        // Basic validations
        require(assets > 0, "Assets must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(!emergencyShutdown, "Withdrawals suspended");
        require(msg.sender == _owner, "Not authorized");

        // Calculate withdrawable amount based on matured deposits only
        uint256 totalBalance = convertToAssets(balances[_owner]);
        uint256 withdrawableAmount = 0;

        // Only count deposits that have completed their lock period
        for (uint256 i = 0; i < userStakedDeposits[_owner].length; i++) {
            if (
                block.timestamp >=
                userStakedDeposits[_owner][i].timestamp + LOCK_PERIOD
            ) {
                withdrawableAmount += userStakedDeposits[_owner][i].amount;
            }
        }

        // Ensure user isn't withdrawing more than their mature deposits
        require(
            assets <= withdrawableAmount,
            "Amount exceeds unlocked balance"
        );

        // Also verify they have sufficient total balance
        require(assets <= totalBalance, "Amount exceeds total balance");

        // Calculate shares to burn
        shares = previewWithdraw(assets);
        require(shares <= balances[_owner], "Insufficient shares");

        // Update state
        balances[_owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        // Transfer assets
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
        return shares;
    }

    function queueLargeDeposit() external {
        require(
            largeDepositUnlockTime[msg.sender] == 0,
            "Deposit already queued"
        );
        largeDepositUnlockTime[msg.sender] = block.timestamp + DEPOSIT_TIMELOCK;
    }

    function toggleDeposits() external onlyOwner {
        depositsPaused = !depositsPaused;
    }

    function totalSupply() public view returns (uint256) {
        return totalShares;
    }

    function balanceOf(address _owner) public view returns (uint256) {
        return balances[_owner];
    }
}
