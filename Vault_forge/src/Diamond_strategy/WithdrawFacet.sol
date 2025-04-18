// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

//import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface ILidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address recipient
    ) external returns (uint256[] memory requestIds);

    function isWithdrawalFinalized(
        uint256 requestId
    ) external view returns (bool);
}

interface IWstETH {
    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IReceiver {
    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external returns (uint256);
}

contract WithdrawFacet is Modifiers {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Math for uint256;

    // Error definitions
    error EmergencyShutdown();
    error WithdrawalNotReady();
    error SlippageTooHigh(uint256 received, uint256 expected);
    error NoSharesToMint();
    error InvalidAmount();
    error NoWithdrawalInProgress();

    // Events
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event WithdrawalFromLidoInitiated(
        address indexed user,
        uint256 wstETHAmount
    );
    event WithdrawalProcessed(
        address indexed user,
        uint256 ethReceived,
        uint256 usdcReceived,
        uint256 fee,
        uint256 sharesMinted
    );
    event StakedAssetsReturned(address indexed user, uint256 usdcReceived);
    event LidoWithdrawalCompleted(address indexed user, uint256 ethReceived);
    event PerformanceFeeCollected(address indexed user, uint256 fee);

    function withdraw(
        uint256 assets,
        address receiver,
        address _owner
    ) external nonReentrantVault returns (uint256 shares) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Basic validations
        require(assets > 0, "Assets must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(!ds.emergencyShutdown, "Withdrawals suspended");
        require(msg.sender == _owner, "Not authorized");

        // Calculate withdrawable amount based on matured deposits only
        uint256 totalBalance = convertToAssets(ds.balances[_owner]);
        uint256 withdrawableAmount = 0;

        // Only count deposits that have completed their lock period
        for (uint256 i = 0; i < ds.userStakedDeposits[_owner].length; i++) {
            if (
                block.timestamp >=
                ds.userStakedDeposits[_owner][i].timestamp + ds.LOCK_PERIOD
            ) {
                withdrawableAmount += ds.userStakedDeposits[_owner][i].amount;
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
        require(shares <= ds.balances[_owner], "Insufficient shares");

        // Update state
        ds.balances[_owner] -= shares;
        ds.totalShares -= shares;
        ds.totalAssets -= assets;

        // Transfer assets
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
        return shares;
    }

    function processCompletedWithdrawals(
        address user,
        uint256 minUSDCExpected
    )
        external
        nonReentrantVault
        onlyAuthorizedOperator
        returns (uint256 sharesMinted, uint256 usdcReceived)
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Input validation
        if (!ds.withdrawalInProgress[user]) revert NoWithdrawalInProgress();
        if (user == address(0)) revert InvalidAmount();
        if (minUSDCExpected == 0) revert InvalidAmount();

        uint256 requestId = ds.withdrawalRequestIds[user];
        uint256 withdrawnAmount = 0;
        uint256 withdrawnWstETH = 0;

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (ds.userStakedDeposits[user][i].withdrawn) {
                withdrawnWstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                withdrawnAmount += ds.userStakedDeposits[user][i].amount;
            }
        }

        // Only reduce by the amount being withdrawn
        ds.stakedPortions[user] -= withdrawnAmount;
        ds.userWstETHBalance[user] -= withdrawnWstETH;

        // Check withdrawal status
        if (
            !ILidoWithdrawal(ds.lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
        ) {
            revert WithdrawalNotReady();
        }

        // Clear withdrawal state first
        ds.withdrawalInProgress[user] = false;
        delete ds.withdrawalRequestIds[user];

        // Have Receiver claim and process the withdrawal
        usdcReceived = IReceiver(ds.receiverContract).claimWithdrawalFromLido(
            requestId,
            user,
            minUSDCExpected
        );

        if (usdcReceived < minUSDCExpected)
            revert SlippageTooHigh(usdcReceived, minUSDCExpected);

        // Calculate and handle fees
        uint256 yield = usdcReceived > withdrawnAmount
            ? usdcReceived - withdrawnAmount
            : 0;
        uint256 fee = calculateFee(yield);
        uint256 userAmount = usdcReceived - fee;

        // Update fee accounting
        if (fee > 0) {
            ds.accumulatedFees = ds.accumulatedFees.add(fee);
            emit PerformanceFeeCollected(user, fee);
        }

        // Calculate and mint shares
        sharesMinted = convertToShares(userAmount);
        if (sharesMinted == 0) revert NoSharesToMint();

        // Update global state
        ds.totalStakedValue = ds.totalStakedValue.sub(withdrawnAmount);
        ds.totalAssets = ds.totalAssets.add(userAmount);
        ds.totalShares = ds.totalShares.add(sharesMinted);
        ds.balances[user] = ds.balances[user].add(sharesMinted);

        // Emit events
        emit WithdrawalProcessed(
            user,
            0, // ETH received by Receiver
            usdcReceived,
            fee,
            sharesMinted
        );
        emit StakedAssetsReturned(user, userAmount);
        emit LidoWithdrawalCompleted(user, 0);

        return (sharesMinted, userAmount);
    }

    function safeProcessCompletedWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Calculate withdrawn amount
        uint256 withdrawnAmount = 0;
        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (ds.userStakedDeposits[user][i].withdrawn) {
                withdrawnAmount += ds.userStakedDeposits[user][i].amount;
            }
        }

        // Calculate minimum expected USDC with slippage protection
        uint256 minExpectedUSDC = (withdrawnAmount *
            ds.AUTO_WITHDRAWAL_SLIPPAGE) / 1000;

        // Process the withdrawal
        this.processCompletedWithdrawals(user, minExpectedUSDC);
        return true;
    }

    function safeInitiateWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        // Call internal function
        initiateAutomaticWithdrawal(user);
        return true;
    }

    function initiateAutomaticWithdrawal(address user) internal {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(ds.userWstETHBalance[user] > 0, "No wstETH to withdraw");

        uint256 totalWstETHToWithdraw = 0;
        uint256 totalAmountWithdrawn = 0;

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp + ds.LOCK_PERIOD
            ) {
                totalWstETHToWithdraw += ds
                .userStakedDeposits[user][i].wstETHAmount;
                totalAmountWithdrawn += ds.userStakedDeposits[user][i].amount;
                ds.userStakedDeposits[user][i].withdrawn = true;
            }
        }

        // Only proceed if there's something to withdraw
        require(totalWstETHToWithdraw > 0, "No eligible deposits to withdraw");

        ds.withdrawalInProgress[user] = true;

        // First unwrap wstETH to stETH
        IWstETH(ds.wstETHAddress).approve(
            ds.lidoWithdrawalAddress,
            totalWstETHToWithdraw
        );
        uint256 stETHAmount = IWstETH(ds.wstETHAddress).unwrap(
            totalWstETHToWithdraw
        );

        // Request withdrawal from Lido
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = stETHAmount;
        uint256[] memory requestIds = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .requestWithdrawals(amounts, ds.receiverContract);

        ds.withdrawalRequestIds[user] = requestIds[0];
        emit WithdrawalFromLidoInitiated(user, totalWstETHToWithdraw);
    }

    // Utility functions
    function calculateFee(uint256 yield) internal pure returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (yield == 0) return 0;

        uint256 fee = yield.mul(ds.PERFORMANCE_FEE).div(ds.FEE_DENOMINATOR);

        // Don't charge minimum fee if yield is too small
        if (yield <= ds.MINIMUM_FEE) {
            return yield;
        }

        return Math.min(fee, yield);
    }

    function previewWithdraw(
        uint256 assets
    ) public view returns (uint256 shares) {
        require(assets > 0, "Assets must be greater than zero");
        shares = convertToShares(assets);
        return shares > 0 ? shares : 1; // Ensure at least 1 share is burned
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalAssets == 0 || ds.totalShares == 0) {
            return assets;
        }
        return (assets * ds.totalShares) / ds.totalAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.totalShares == 0) {
            return shares;
        }
        return (shares * ds.totalAssets) / ds.totalShares;
    }
}
