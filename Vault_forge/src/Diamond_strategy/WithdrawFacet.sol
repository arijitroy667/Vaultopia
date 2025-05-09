// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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
    ) external returns (uint256, uint256); // Return both ETH and USDC amounts
}

contract WithdrawFacet is Modifiers {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // Error definitions
    error EmergencyShutdown();
    error WithdrawalNotReady();
    error SlippageTooHigh(uint256 received, uint256 expected);
    error NoSharesToMint();
    error InvalidAmount();
    error NoWithdrawalInProgress();
    error WithdrawalAlreadyInProgress();
    error AddressNotSet();
    error NoEligibleDeposits();
    error ExternalCallFailed();

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
        uint256 wstETHAmount,
        uint256 stETHAmount,
        uint256 timestamp
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
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAmount();
        if (ds.emergencyShutdown) revert EmergencyShutdown();
        if (msg.sender != _owner) revert("Not authorized");

        // Calculate withdrawable amount based on matured deposits only
        uint256 totalBalance = convertToAssets(ds.balances[_owner]);
        uint256 withdrawableAmount = calculateWithdrawableAmount(_owner);

        // Ensure user isn't withdrawing more than their mature deposits
        if (assets > withdrawableAmount)
            revert("Amount exceeds unlocked balance");

        // Also verify they have sufficient total balance
        if (assets > totalBalance) revert("Amount exceeds total balance");

        // Calculate shares to burn
        shares = previewWithdraw(assets);
        if (shares > ds.balances[_owner]) revert("Insufficient shares");

        // Update state (following checks-effects-interactions pattern)
        ds.balances[_owner] -= shares;
        ds.totalShares -= shares;
        ds.totalAssets -= assets;

        // Transfer assets - this is the external interaction
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
        if (ds.lidoWithdrawalAddress == address(0)) revert AddressNotSet();
        if (ds.receiverContract == address(0)) revert AddressNotSet();

        uint256 requestId = ds.withdrawalRequestIds[user];

        // Check withdrawal status first
        if (
            !ILidoWithdrawal(ds.lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
        ) {
            revert WithdrawalNotReady();
        }

        // Calculate withdrawn amounts
        (
            uint256 withdrawnAmount,
            uint256 withdrawnWstETH
        ) = getWithdrawnAmounts(user);

        if (withdrawnAmount == 0) revert InvalidAmount();

        // Have Receiver claim and process the withdrawal - before state changes
        // Update return type to get both ETH and USDC amounts
        uint256 ethReceived;
        (ethReceived, usdcReceived) = IReceiver(ds.receiverContract)
            .claimWithdrawalFromLido(requestId, user, minUSDCExpected);

        if (usdcReceived < minUSDCExpected)
            revert SlippageTooHigh(usdcReceived, minUSDCExpected);

        // Now that external call succeeded, update state
        ds.withdrawalInProgress[user] = false;
        delete ds.withdrawalRequestIds[user];

        // Only reduce by the amount being withdrawn
        ds.stakedPortions[user] -= withdrawnAmount;
        ds.userWstETHBalance[user] -= withdrawnWstETH;

        // Calculate and handle fees
        uint256 yield = usdcReceived > withdrawnAmount
            ? usdcReceived - withdrawnAmount
            : 0;
        uint256 fee = calculateFee(yield);
        uint256 userAmount = usdcReceived - fee;

        // Update fee accounting
        if (fee > 0) {
            ds.accumulatedFees += fee;
            emit PerformanceFeeCollected(user, fee);
        }

        // Calculate and mint shares
        sharesMinted = convertToShares(userAmount);
        if (sharesMinted == 0) revert NoSharesToMint();

        // Update global state
        ds.totalStakedValue -= withdrawnAmount;
        ds.totalAssets += userAmount;
        ds.totalShares += sharesMinted;
        ds.balances[user] += sharesMinted;

        // Emit events with accurate values
        emit WithdrawalProcessed(
            user,
            ethReceived, // Use actual ETH received
            usdcReceived,
            fee,
            sharesMinted
        );
        emit StakedAssetsReturned(user, userAmount);
        emit LidoWithdrawalCompleted(user, ethReceived); // Use actual ETH received

        return (sharesMinted, userAmount);
    }

    function safeProcessCompletedWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        if (user == address(0)) revert InvalidAmount();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Verify withdrawal is in progress
        if (!ds.withdrawalInProgress[user]) revert NoWithdrawalInProgress();

        // Calculate withdrawn amount
        (uint256 withdrawnAmount, ) = getWithdrawnAmounts(user);
        if (withdrawnAmount == 0) revert InvalidAmount();

        // Calculate minimum expected USDC with slippage protection
        uint256 minExpectedUSDC = (withdrawnAmount *
            DiamondStorage.AUTO_WITHDRAWAL_SLIPPAGE) / 1000;

        // Process the withdrawal
        try this.processCompletedWithdrawals(user, minExpectedUSDC) returns (
            uint256,
            uint256
        ) {
            return true;
        } catch {
            // Don't revert the entire transaction if processing fails
            return false;
        }
    }

    function safeInitiateWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        if (user == address(0)) revert InvalidAmount();

        try this.publicInitiateWithdrawal(user) {
            return true;
        } catch {
            return false;
        }
    }

    function initiateAutomaticWithdrawal(address user) internal {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Add critical validations
        if (ds.withdrawalInProgress[user]) revert WithdrawalAlreadyInProgress();
        if (ds.wstETHAddress == address(0)) revert AddressNotSet();
        if (ds.lidoWithdrawalAddress == address(0)) revert AddressNotSet();
        if (ds.receiverContract == address(0)) revert AddressNotSet();
        if (ds.userWstETHBalance[user] == 0) revert("No wstETH to withdraw");

        (uint256 totalWstETHToWithdraw, ) = getEligibleWithdrawalAmounts(user);

        // Only proceed if there's something to withdraw
        if (totalWstETHToWithdraw == 0) revert NoEligibleDeposits();

        // Set withdrawal in progress FIRST (follow checks-effects-interactions)
        ds.withdrawalInProgress[user] = true;

        // First unwrap wstETH to stETH
        bool approveSuccess = IWstETH(ds.wstETHAddress).approve(
            ds.lidoWithdrawalAddress,
            totalWstETHToWithdraw
        );
        if (!approveSuccess) revert ExternalCallFailed();

        uint256 stETHAmount = IWstETH(ds.wstETHAddress).unwrap(
            totalWstETHToWithdraw
        );

        // Request withdrawal from Lido
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = stETHAmount;
        uint256[] memory requestIds = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .requestWithdrawals(amounts, ds.receiverContract);

        ds.withdrawalRequestIds[user] = requestIds[0];
        emit WithdrawalFromLidoInitiated(
            user,
            totalWstETHToWithdraw,
            stETHAmount,
            block.timestamp
        );
    }

    // Helper function to get eligible withdrawal amounts
    function getEligibleWithdrawalAmounts(
        address user
    ) internal returns (uint256 totalWstETH, uint256 totalAmount) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                totalWstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                totalAmount += ds.userStakedDeposits[user][i].amount;
                ds.userStakedDeposits[user][i].withdrawn = true;
            }
        }

        return (totalWstETH, totalAmount);
    }

    // Helper function to calculate withdrawable amount
    function calculateWithdrawableAmount(
        address user
    ) internal view returns (uint256 withdrawable) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                withdrawable += ds.userStakedDeposits[user][i].amount;
            }
        }

        return withdrawable;
    }

    // Helper function to get withdrawn amounts
    function getWithdrawnAmounts(
        address user
    ) internal view returns (uint256 amount, uint256 wstETH) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (ds.userStakedDeposits[user][i].withdrawn) {
                wstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                amount += ds.userStakedDeposits[user][i].amount;
            }
        }

        return (amount, wstETH);
    }

    // Utility functions
    function calculateFee(uint256 yield) internal pure returns (uint256) {
        if (yield == 0) return 0;

        uint256 fee = (yield * DiamondStorage.PERFORMANCE_FEE) /
            DiamondStorage.FEE_DENOMINATOR;

        // Don't charge fees for small yields
        if (yield <= DiamondStorage.MINIMUM_FEE) {
            return 0;
        }

        return Math.min(fee, yield);
    }

    function previewWithdraw(
        uint256 assets
    ) public view returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();

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

    function publicInitiateWithdrawal(address user) public onlyContract {
        initiateAutomaticWithdrawal(user);
    }
}
