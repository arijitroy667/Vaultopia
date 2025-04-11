// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";


interface ILidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata _amounts,
        address _owner
    ) external returns (uint256[] memory requestIds);
    
    function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) 
        external returns (uint256 claimedEthAmount);
        
    function isWithdrawalFinalized(uint256 _requestId) external view returns (bool);
}

interface ISwapContract {
    function swapExactETHForUSDC(
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountOut);
    
    function getUSDCAmountOut(
        uint256 ethAmountIn
    ) external view returns (uint256 usdcAmountOut);
}

// Custom errors
error NoWithdrawableAssets();
error EmergencyActive();
error InsufficientBalance();
error WithdrawalAlreadyInProgress();
error WithdrawalNotInProgress();
error WithdrawalNotFinalized();
error NoWithdrawalRequests();
error NotAuthorized();
error InvalidAddress();
error ZeroAmount();
error SlippageExceeded();
error InvalidDeadline();
error FailedETHTransfer();
error NoWithdrawalsToProcess();

contract WithdrawalFacet is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Math for uint256;
    
    // Constants
    uint256 private constant LIQUID_PORTION = 60; // 60% can be withdrawn immediately
    uint256 private constant MIN_WITHDRAWAL = 10 * 1e6; // 10 USDC minimum
    uint256 private constant LOCK_PERIOD = 30 days;
    
    // Events
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
    
    event WithdrawalInitiated(address indexed user, uint256 requestId);
    event WithdrawalProcessed(
        address indexed user,
        uint256 requestId,
        uint256 ethAmount,
        uint256 usdcReceived
    );

    function withdraw(
        uint256 assets,
        address receiver
    ) external nonReentrant returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        if (ds.emergencyShutdown) revert EmergencyActive();
        if (assets == 0) revert ZeroAmount();
        if (assets < MIN_WITHDRAWAL) revert ZeroAmount();
        
        // Check if the withdrawal is currently in progress for this user
        if (ds.withdrawalInProgress[msg.sender]) revert WithdrawalAlreadyInProgress();
        
        // Calculate maximum withdrawable amount based on user's balance and staked status
        uint256 withdrawableAmount = getWithdrawableAmount(msg.sender);
        if (withdrawableAmount == 0) revert NoWithdrawableAssets();
        
        // Cannot withdraw more than the withdrawable amount
        if (assets > withdrawableAmount) revert InsufficientBalance();
        
        // Calculate shares to burn based on assets
        uint256 shares = convertToShares(assets);
        if (shares > ds.balances[msg.sender]) revert InsufficientBalance();
        
        // Update state
        ds.balances[msg.sender] -= shares;
        ds.totalShares -= shares;
        ds.totalAssets -= assets;
        
        // Transfer assets to receiver
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, assets, shares);
        
        return shares;
    }
    
    function initiateWithdrawal(address user) external nonReentrant {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Only contract or owner can call this
        if (msg.sender != address(this) && msg.sender != ds.owner) 
            revert NotAuthorized();
            
        // Check if withdrawal is already in progress
        if (ds.withdrawalInProgress[user]) revert WithdrawalAlreadyInProgress();
        
        // Ensure user has wstETH balance to withdraw
        if (ds.userWstETHBalance[user] == 0) revert NoWithdrawableAssets();
        
        // Create array with single element for the withdrawal amount
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = ds.userWstETHBalance[user];
        
        // Call Lido withdrawal contract to request withdrawal
        uint256[] memory requestIds = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .requestWithdrawals(amounts, address(this));
            
        // Store request ID
        ds.withdrawalRequestIds[user] = requestIds[0];
        ds.withdrawalInProgress[user] = true;
        
        emit WithdrawalInitiated(user, requestIds[0]);
    }
    
    function processCompletedWithdrawals(address user, uint256 minExpected) 
        external nonReentrant {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Only contract or owner can call this
        if (msg.sender != address(this) && msg.sender != ds.owner) 
            revert NotAuthorized();
            
        // Check if user has any pending withdrawals
        if (!ds.withdrawalInProgress[user]) revert WithdrawalNotInProgress();
        
        uint256 requestId = ds.withdrawalRequestIds[user];
        
        // Check if the withdrawal is finalized in Lido
        bool isFinalized = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .isWithdrawalFinalized(requestId);
        
        if (!isFinalized) revert WithdrawalNotFinalized();
        
        // Create array with single request ID
        uint256[] memory requestIds = new uint256[](1);
        requestIds[0] = requestId;
        
        // Create hints array (can be empty for single withdrawals)
        uint256[] memory hints = new uint256[](1);
        hints[0] = 0;
        
        // Get ETH from Lido
        uint256 ethAmount = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .claimWithdrawals(requestIds, hints);
            
        if (ethAmount == 0) revert NoWithdrawalsToProcess();
        
        // Reset user withdrawal status
        ds.withdrawalInProgress[user] = false;
        ds.withdrawalRequestIds[user] = 0;
        
        // Get expected USDC return with 1% slippage tolerance
        uint256 expectedUsdc = ISwapContract(ds.swapContract)
            .getUSDCAmountOut(ethAmount);
            
        uint256 minUsdc = minExpected > 0 ? minExpected : (expectedUsdc * 99) / 100;
        
        // Calculate deadline (5 minutes from now)
        uint256 deadline = block.timestamp + 300;
        
        // Convert ETH back to USDC through swap contract
        uint256 usdcReceived = ISwapContract(ds.swapContract).swapExactETHForUSDC{
            value: ethAmount
        }(minUsdc, address(this), deadline);
        
        // Reset wstETH balance
        ds.userWstETHBalance[user] = 0;
        
        // Mark all staked deposits as withdrawn
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[user];
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                deposits[i].withdrawn = true;
            }
        }
        
        // Update total staked value
        ds.totalStakedValue -= usdcReceived;
        ds.stakedPortions[user] = 0;
        
        // Add USDC back to total assets
        ds.totalAssets += usdcReceived;
        
        emit WithdrawalProcessed(user, requestId, ethAmount, usdcReceived);
    }
    
    function getWithdrawableAmount(address user) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 totalUserBalance = convertToAssets(ds.balances[user]);

        // If user has no balance, nothing to withdraw
        if (totalUserBalance == 0) return 0;

        // Get all user's staked deposits
        DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[user];

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

        // Calculate withdrawable portion of unmatured deposits (LIQUID_PORTION%)
        uint256 withdrawableFromUnmatured = (unmaturedValue * LIQUID_PORTION) /
            100;

        // Total withdrawable value is matured deposits + withdrawable portion of unmatured
        uint256 totalWithdrawableValue = maturedValue +
            withdrawableFromUnmatured;

        // Calculate ratio using proper decimals (1e6 for USDC)
        uint256 withdrawableRatio = (totalWithdrawableValue * 1e6) /
            userTotalStaked;

        // Apply the ratio to total balance
        return (totalUserBalance * withdrawableRatio) / 1e6;
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
        
        uint256 totalValue = ds.totalAssets + ds.totalStakedValue;
        return (assets * ds.totalShares) / totalValue;
    }
    
    function safeInitiateWithdrawal(address user) external {
        this.initiateWithdrawal(user);
    }
    
    function safeProcessCompletedWithdrawal(address user) external {
        this.processCompletedWithdrawals(user, 0);
    }
    
    function emergencyWithdraw() external nonReentrant {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Can only be called during emergency shutdown
        require(ds.emergencyShutdown, "Not in emergency");
        
        // Calculate user's total balance
        uint256 userShares = ds.balances[msg.sender];
        if (userShares == 0) revert InsufficientBalance();
        
        // Calculate assets based on liquid portion only
        uint256 totalAssets = ds.totalAssets;
        uint256 assetsToWithdraw = (totalAssets * userShares) / ds.totalShares;
        
        // Update state
        ds.balances[msg.sender] = 0;
        ds.totalShares -= userShares;
        ds.totalAssets -= assetsToWithdraw;
        
        // Transfer assets to user
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(msg.sender, assetsToWithdraw);
        
        emit Withdraw(msg.sender, msg.sender, assetsToWithdraw, userShares);
    }
    
    function getWithdrawalStatus(
        address user
    ) external view returns (bool isInProgress, uint256 requestId, bool isFinalized) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        isInProgress = ds.withdrawalInProgress[user];
        requestId = ds.withdrawalRequestIds[user];
        isFinalized = requestId > 0
            ? ILidoWithdrawal(ds.lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
            : false;
    }
}