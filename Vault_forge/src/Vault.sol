// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// Add USDC interface
interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);
}

interface ILidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address recipient
    ) external returns (uint256[] memory requestIds);

    function claimWithdrawals(uint256[] calldata requestIds) external;

    function isWithdrawalFinalized(
        uint256 requestId
    ) external view returns (bool);
}

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IReceiver {
    function batchStakeWithLido(
        bytes32 batchId
    ) external payable returns (uint256);

    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external returns (uint256);
}

// Call the function that both takes the USDC and performs the swap
interface ISwapContract {
    function takeAndSwapUSDC(
        uint256 amount,
        uint256 amountOutMin
    ) external returns (uint256);

    function depositETH() external payable;

    function swapAllETHForUSDC(
        uint256 minUSDCAmount
    ) external returns (uint256);

    function getExpectedEthForUsdc(
        uint256 usdcAmount
    ) external view returns (uint256);
}

contract Yield_Bull is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using SafeMath for uint256;

    modifier onlyContract() {
        require(msg.sender == address(this), "Only contract can call");
        _;
    }
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }
    modifier onlyAuthorizedOperator() {
        require(
            msg.sender == owner || msg.sender == address(this),
            "Not authorized"
        );
        _;
    }

    struct StakedDeposit {
        uint256 amount;
        uint256 timestamp;
        uint256 wstETHAmount;
        bool withdrawn;
    }

    // Define USDC as immutable
    IUSDC public immutable USDC;
    using SafeMath for uint256;
    uint256 public constant MAX_DEPOSIT_PER_USER = 4999 * 1e6;
    uint256 public constant TIMELOCK_DURATION = 2 days;
    uint256 public totalAssets; // Total assets in the vault
    uint256 public totalShares; // Total shares issued by the vault
    uint256 public constant LOCK_PERIOD = 30 days;
    uint256 public constant STAKED_PORTION = 40; // 40%
    uint256 public constant LIQUID_PORTION = 60; // 60%
    uint256 public constant INSTANT_WITHDRAWAL_LIMIT = 60;
    IERC20 public immutable asset;
    uint8 private immutable _decimals;
    uint256 public lastUpdateTime;
    uint256 public constant UPDATE_INTERVAL = 1 days;
    uint256 public lastDailyUpdate;
    uint256 public constant PERFORMANCE_FEE = 300; // 3%
    uint256 public constant MIN_DEPOSIT_AMOUNT = 100 * 1e6; // 100 USDC minimum
    uint256 public constant DEPOSIT_TIMELOCK = 1 hours;
    uint256 public totalStakedValue;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MINIMUM_FEE = 1e6; // 1 USDC minimum fee
    uint256 public accumulatedFees;
    uint256 public constant AUTO_WITHDRAWAL_SLIPPAGE = 950; // 95% of original stake as minimum
    uint256 public lastProcessedUserIndex;
    uint256 public constant MAX_USERS_PER_UPDATE = 20; // Process 20 users at a time

    bool public emergencyShutdown;
    bool public depositsPaused;

    address public owner;
    address[] private userAddresses;
    address public immutable ASSET_TOKEN_ADDRESS =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address public swapContract;
    address public feeCollector;
    address public lidoWithdrawalAddress;
    address public wstETHAddress;
    address public receiverContract;

    // Events
    event Deposit(
        address indexed sender,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event LockedAssetsUpdated(address indexed user, uint256 amount);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event StakedPortionLocked(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event SwapInitiated(
        address indexed user,
        uint256 stakedAmount,
        uint256 unlockTime
    );
    event WstETHBalanceUpdated(
        address indexed user,
        uint256 stakedUSDC,
        uint256 wstETHReceived
    );
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event PerformanceFeeCollected(address indexed user, uint256 fee);
    event EmergencyShutdownToggled(bool enabled);
    event WithdrawalFromLidoInitiated(
        address indexed user,
        uint256 wstETHAmount
    );
    event LidoWithdrawalCompleted(address indexed user, uint256 ethReceived);
    event FeesCollected(uint256 amount);
    event StakedAssetsReturned(address indexed user, uint256 usdcReceived);
    event StakeInitiated(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event WithdrawalProcessed(
        address indexed user,
        uint256 ethReceived,
        uint256 usdcReceived,
        uint256 fee,
        uint256 sharesMinted
    );
    event WithdrawalInitiationFailed(address indexed user);
    event WithdrawalProcessingFailed(address indexed user, uint256 requestId);
    event DailyUpdatePartial(
        uint256 startIndex,
        uint256 endIndex,
        uint256 totalUsers
    );
    event DailyUpdatePerformed(uint256 timestamp);

    error NoWithdrawalInProgress();
    error WithdrawalNotReady();
    error SlippageTooHigh(uint256 received, uint256 expected);
    error NoSharesToMint();
    error InvalidAmount();

    // mapping variables

    mapping(bytes32 => uint256) public pendingOperations;
    mapping(address => uint256) public stakedPortions; // Track 40% staked amount per user
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public depositTimestamps;
    mapping(address => uint256) public lockedAssets;
    mapping(address => bool) private isExistingUser;
    mapping(address => uint256) public userWstETHBalance;
    mapping(address => bool) public withdrawalInProgress;
    mapping(address => uint256) public withdrawalRequestIds;
    mapping(address => uint256) public largeDepositUnlockTime;
    mapping(address => uint256) public pendingEthStakes;
    mapping(bytes32 => address[]) public stakeBatches;
    mapping(bytes32 => bool) public processedBatches;
    mapping(address => StakedDeposit[]) public userStakedDeposits;

    constructor(
        address _lidoWithdrawal,
        address _wstETH,
        address _receiver,
        address _swapContract
    ) {
        require(
            _lidoWithdrawal != address(0),
            "Invalid Lido withdrawal address"
        );
        require(_wstETH != address(0), "Invalid wstETH address");
        require(_receiver != address(0), "Invalid receiver address");
        require(_swapContract != address(0), "Invalid swap contract address");

        lidoWithdrawalAddress = _lidoWithdrawal;
        wstETHAddress = _wstETH;
        receiverContract = _receiver;
        swapContract = _swapContract;
        feeCollector = msg.sender;
        asset = IERC20(ASSET_TOKEN_ADDRESS);
        USDC = IUSDC(ASSET_TOKEN_ADDRESS);
        _decimals = USDC.decimals();
        owner = msg.sender;
        lastDailyUpdate = block.timestamp;
    }

    function setLidoWithdrawalAddress(
        address _lidoWithdrawal
    ) external onlyOwner {
        require(_lidoWithdrawal != address(0), "Invalid address");
        lidoWithdrawalAddress = _lidoWithdrawal;
    }

    function setWstETHAddress(address _wstETH) external onlyOwner {
        require(_wstETH != address(0), "Invalid address");
        wstETHAddress = _wstETH;
    }

    function setReceiverContract(address _receiver) external onlyOwner {
        require(_receiver != address(0), "Invalid address");
        receiverContract = _receiver;
    }

    function setSwapContract(address _swapContract) external onlyOwner {
        require(msg.sender == owner, "Not authorized");
        require(_swapContract != address(0), "Invalid address");
        swapContract = _swapContract;
    }

    function calculateFee(uint256 yield) internal pure returns (uint256) {
        if (yield == 0) return 0;

        uint256 fee = yield.mul(PERFORMANCE_FEE).div(FEE_DENOMINATOR);

        // Don't charge minimum fee if yield is too small
        if (yield <= MINIMUM_FEE) {
            return yield;
        }

        return Math.min(fee, yield);
    }

    function processCompletedWithdrawals(
        address user,
        uint256 minUSDCExpected
    )
        public
        nonReentrant
        onlyAuthorizedOperator
        returns (uint256 sharesMinted, uint256 usdcReceived)
    {
        // Input validation
        if (!withdrawalInProgress[user]) revert NoWithdrawalInProgress();
        if (user == address(0)) revert InvalidAmount();
        if (minUSDCExpected == 0) revert InvalidAmount();

        uint256 requestId = withdrawalRequestIds[user];
        uint256 withdrawnAmount = 0;
        uint256 withdrawnWstETH = 0;
        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (userStakedDeposits[user][i].withdrawn) {
                withdrawnWstETH += userStakedDeposits[user][i].wstETHAmount;
                withdrawnAmount += userStakedDeposits[user][i].amount; // Track USDC amount
            }
        }

        // Only reduce by the amount being withdrawn, not zeroing everything
        stakedPortions[user] -= withdrawnAmount;
        userWstETHBalance[user] -= withdrawnWstETH;
        // Check withdrawal status
        if (
            !ILidoWithdrawal(lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
        ) {
            revert WithdrawalNotReady();
        }

        // Clear withdrawal state first
        withdrawalInProgress[user] = false;
        delete withdrawalRequestIds[user];

        // *** NEW CODE: Have Receiver claim and process the withdrawal ***
        // Get USDC through Receiver → Swap path instead of direct handling
        usdcReceived = IReceiver(receiverContract).claimWithdrawalFromLido(
            requestId,
            user,
            minUSDCExpected
        );

        if (usdcReceived < minUSDCExpected)
            revert SlippageTooHigh(usdcReceived, minUSDCExpected);

        // The rest of the function remains the same...
        // Calculate and handle fees
        uint256 yield = usdcReceived > withdrawnAmount
            ? usdcReceived - withdrawnAmount
            : 0;
        uint256 fee = calculateFee(yield);
        uint256 userAmount = usdcReceived - fee;

        // Update fee accounting if applicable
        if (fee > 0) {
            accumulatedFees = accumulatedFees.add(fee);
            emit PerformanceFeeCollected(user, fee);
        }

        // Calculate and mint shares
        sharesMinted = convertToShares(userAmount);
        if (sharesMinted == 0) revert NoSharesToMint();

        // Update global state
        totalStakedValue = totalStakedValue.sub(withdrawnAmount);
        totalAssets = totalAssets.add(userAmount);
        totalShares = totalShares.add(sharesMinted);
        balances[user] = balances[user].add(sharesMinted);

        // Emit events
        emit WithdrawalProcessed(
            user,
            0, // We don't track ethReceived in Vault anymore
            usdcReceived,
            fee,
            sharesMinted
        );
        emit StakedAssetsReturned(user, userAmount);
        emit LidoWithdrawalCompleted(user, 0); // ETH was received by Receiver

        return (sharesMinted, userAmount);
    }

    function safeProcessCompletedWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        // Calculate withdrawn amount
        uint256 withdrawnAmount = 0;
        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (userStakedDeposits[user][i].withdrawn) {
                withdrawnAmount += userStakedDeposits[user][i].amount;
            }
        }

        // Calculate minimum expected USDC with slippage protection
        uint256 minExpectedUSDC = (withdrawnAmount * AUTO_WITHDRAWAL_SLIPPAGE) /
            1000;

        // Process the withdrawal by calling your existing function
        processCompletedWithdrawals(user, minExpectedUSDC);
        return true;
    }

    function performDailyUpdate() external nonReentrant onlyContract {
        require(
            block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL,
            "Too soon to update"
        );

        uint256 startIndex = lastProcessedUserIndex;
        uint256 endIndex = Math.min(
            startIndex + MAX_USERS_PER_UPDATE,
            userAddresses.length
        );
        bool updateComplete = endIndex >= userAddresses.length;

        // Process a limited batch of users
        for (uint256 i = startIndex; i < endIndex; i++) {
            address user = userAddresses[i];

            // Check if user has staked assets that may need processing
            if (userWstETHBalance[user] > 0) {
                // Don't use global depositTimestamps - rely on individual deposit timestamps
                if (!withdrawalInProgress[user]) {
                    // Try to initiate withdrawals for eligible deposits
                    try this.safeInitiateWithdrawal(user) {
                        // Success: withdrawal initiated
                    } catch {
                        // Failed but continue with other users
                        emit WithdrawalInitiationFailed(user);
                    }
                }

                // Check for pending withdrawals that are ready
                if (withdrawalInProgress[user]) {
                    uint256 requestId = withdrawalRequestIds[user];
                    bool isWithdrawalReady = ILidoWithdrawal(
                        lidoWithdrawalAddress
                    ).isWithdrawalFinalized(requestId);

                    if (isWithdrawalReady) {
                        try this.safeProcessCompletedWithdrawal(user) {
                            // Success: withdrawal processed
                        } catch {
                            // Failed but continue with other users
                            emit WithdrawalProcessingFailed(user, requestId);
                        }
                    }
                }
            }
        }

        // Update the index for the next batch
        lastProcessedUserIndex = updateComplete ? 0 : endIndex;

        // Only update timestamp when we've processed all users
        if (updateComplete) {
            // Cleanup any expired locked assets
            _recalculateLockedAssets();
            lastDailyUpdate = block.timestamp;
            emit DailyUpdatePerformed(block.timestamp);
        } else {
            emit DailyUpdatePartial(startIndex, endIndex, userAddresses.length);
        }
    }

    function safeInitiateWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        // Individual deposits are checked within initiateAutomaticWithdrawal
        initiateAutomaticWithdrawal(user);
        return true;
    }

    function initiateAutomaticWithdrawal(address user) internal {
        require(userWstETHBalance[user] > 0, "No wstETH to withdraw");

        uint256 totalWstETHToWithdraw = 0;
        uint256 totalAmountWithdrawn = 0;

        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (
                !userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                userStakedDeposits[user][i].timestamp + LOCK_PERIOD
            ) {
                totalWstETHToWithdraw += userStakedDeposits[user][i]
                    .wstETHAmount;
                totalAmountWithdrawn += userStakedDeposits[user][i].amount;
                userStakedDeposits[user][i].withdrawn = true;
            }
        }

        // Only proceed if there's something to withdraw
        require(totalWstETHToWithdraw > 0, "No eligible deposits to withdraw");

        uint256 wstETHAmount = totalWstETHToWithdraw;
        withdrawalInProgress[user] = true;

        // First unwrap wstETH to stETH
        IWstETH(wstETHAddress).approve(
            lidoWithdrawalAddress,
            totalWstETHToWithdraw
        );
        uint256 stETHAmount = IWstETH(wstETHAddress).unwrap(
            totalWstETHToWithdraw
        );

        // Request withdrawal from Lido
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = stETHAmount;
        uint256[] memory requestIds = ILidoWithdrawal(lidoWithdrawalAddress)
            .requestWithdrawals(amounts, receiverContract);

        withdrawalRequestIds[user] = requestIds[0];
        emit WithdrawalFromLidoInitiated(user, wstETHAmount);
    }

    function isUpdateNeeded() public view returns (bool) {
        return block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL;
    }

    function triggerDailyUpdate() external {
        require(msg.sender == owner, "Only owner can trigger");
        require(
            block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL,
            "Too soon to update"
        );

        // Call performDailyUpdate through the contract itself
        this.performDailyUpdate();
    }

    function exchangeRate() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e6;
        }
        // Include both liquid and staked assets
        uint256 totalValue = totalAssets + totalStakedValue;
        return (totalValue * 1e6) / totalShares;
    }

    function queueOperation(bytes32 operationId) internal {
        pendingOperations[operationId] = block.timestamp + TIMELOCK_DURATION;
    }

    function convertToShares(
        uint256 assets
    ) public view returns (uint256 shares) {
        if (totalAssets == 0 || totalShares == 0) {
            return assets; // Initial conversion: 1:1
        }

        // Calculate based on current exchange rate
        uint256 currentRate = exchangeRate();
        shares = (assets * 1e6) / currentRate;

        // Round down to prevent share inflation
        return shares;
    }

    function convertToAssets(
        uint256 shares
    ) public view returns (uint256 assets) {
        if (totalShares == 0) {
            return shares; // Initial conversion: 1:1
        }
        return (shares * totalAssets) / totalShares;
    }

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

    function deposit(
        uint256 assets,
        address receiver
    ) public nonReentrant returns (uint256 shares) {
        require(assets > 0, "Deposit amount must be greater than zero");
        require(!depositsPaused, "Deposits are paused");
        require(assets >= MIN_DEPOSIT_AMOUNT, "Deposit amount too small");
        require(!emergencyShutdown, "Deposits suspended");

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares minted");

        if (assets > totalAssets / 10) {
            // If deposit is > 10% of total assets
            require(
                largeDepositUnlockTime[msg.sender] != 0 &&
                    block.timestamp >= largeDepositUnlockTime[msg.sender],
                "Large deposit must be queued"
            );
            delete largeDepositUnlockTime[msg.sender];
        }

        if (!isExistingUser[receiver]) {
            userAddresses.push(receiver);
            isExistingUser[receiver] = true;
        }

        // Calculate portions
        uint256 amountToStake = (assets * STAKED_PORTION) / 100;

        // Get expected ETH output with 1% slippage tolerance
        uint256 expectedEth = ISwapContract(swapContract).getExpectedEthForUsdc(
            amountToStake
        );
        uint256 minExpectedEth = (expectedEth * 99) / 100;

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;
        totalAssets += assets;
        totalShares += shares;
        depositTimestamps[receiver] = block.timestamp;

        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        // Automatically initiate staking for 40%
        if (amountToStake > 0) {
            safeTransferAndSwap(minExpectedEth, receiver, amountToStake); // Will handle the 40% staking
        }

        emit Deposit(msg.sender, receiver, assets, shares);
        emit StakeInitiated(
            receiver,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        );

        return shares;
    }

    function queueLargeDeposit() external {
        require(
            largeDepositUnlockTime[msg.sender] == 0,
            "Deposit already queued"
        );
        largeDepositUnlockTime[msg.sender] = block.timestamp + DEPOSIT_TIMELOCK;
    }

    function toggleDeposits() external {
        require(msg.sender == owner, "Not authorized");
        depositsPaused = !depositsPaused;
    }

    function maxMint(address receiver) public view returns (uint256 maxShares) {
        uint256 maxAssets = maxDeposit(receiver);
        return convertToShares(maxAssets);
    }

    function previewMint(uint256 shares) public view returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        return convertToAssets(shares);
    }

    function mint(
        uint256 shares,
        address receiver
    ) public nonReentrant returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        require(shares <= maxMint(receiver), "Shares exceed limit");

        assets = previewMint(shares);
        require(assets > 0, "Zero assets required");

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;
        totalAssets += assets;
        totalShares += shares;

        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        emit Deposit(msg.sender, receiver, assets, shares);
        return assets;
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

    function getWithdrawalStatus(
        address user
    )
        external
        view
        returns (bool isInProgress, uint256 requestId, bool isFinalized)
    {
        isInProgress = withdrawalInProgress[user];
        requestId = withdrawalRequestIds[user];
        isFinalized = requestId > 0
            ? ILidoWithdrawal(lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
            : false;
    }

    function maxRedeem(address _owner) public view returns (uint256 maxShares) {
        return balances[_owner];
    }

    function previewRedeem(
        uint256 shares
    ) public view returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        assets = convertToAssets(shares);
        return assets > 0 ? assets : 1; // Ensure at least 1 asset is returned
    }

    function redeem(
        uint256 shares,
        address receiver,
        address _owner
    ) public nonReentrant returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(!emergencyShutdown, "Withdrawals suspended");
        require(msg.sender == _owner, "Not authorized");
        require(shares <= balances[_owner], "Insufficient shares");

        // Calculate assets to redeem
        assets = previewRedeem(shares);
        require(assets > 0, "Assets must be greater than zero");

        // Check lock period and calculate redeemable amount
        uint256 depositTime = depositTimestamps[_owner];
        bool isLocked = block.timestamp < depositTime + LOCK_PERIOD;
        uint256 totalUserAssets = convertToAssets(balances[_owner]);
        uint256 redeemableAmount;

        if (isLocked) {
            // During lock period, only allow redemption up to 60%
            redeemableAmount = (totalUserAssets * LIQUID_PORTION) / 100;
            require(
                assets <= redeemableAmount,
                "Cannot redeem staked portion during lock period"
            );
        } else {
            // After lock period, allow full redemption
            redeemableAmount = totalUserAssets;
            // Reset staked portion if fully redeeming
            if (assets == totalUserAssets) {
                stakedPortions[_owner] = 0;
                userWstETHBalance[_owner] = 0;
            }
        }

        require(
            assets <= redeemableAmount,
            "Amount exceeds redeemable balance"
        );

        // Update state before transfer
        balances[_owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        // Transfer assets to receiver
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
        return assets;
    }

    function totalSupply() public view returns (uint256) {
        return totalShares;
    }

    function balanceOf(address _owner) public view returns (uint256) {
        return balances[_owner];
    }

    // In your Vault contract
    function safeTransferAndSwap(
        uint256 amountOutMin,
        address beneficiary,
        uint256 amountToStake
    ) public nonReentrant returns (uint256) {
        require(swapContract != address(0), "Swap contract not set");
        require(
            msg.sender == owner || msg.sender == address(this),
            "Unauthorized"
        );

        require(amountToStake > 0, "Amount too small");

        bytes32 batchId = keccak256(
            abi.encodePacked(block.timestamp, beneficiary, amountToStake)
        );

        totalStakedValue += amountToStake;
        stakedPortions[beneficiary] += amountToStake;

        // Execute swap for staking
        bool success = USDC.approve(swapContract, amountToStake);
        require(success, "USDC approval failed");
        uint256 ethReceived = ISwapContract(swapContract).takeAndSwapUSDC(
            amountToStake,
            amountOutMin
        );
        require(ethReceived > 0, "No ETH received from swap");

        // Store the amount of ETH being sent for this user
        pendingEthStakes[beneficiary] = ethReceived;

        // Add user to current batch
        stakeBatches[batchId].push(beneficiary);

        // Call receiver with batch ID
        uint256 wstETHReceived = IReceiver(receiverContract).batchStakeWithLido{
            value: ethReceived
        }(batchId);

        require(!processedBatches[batchId], "Batch already processed");
        processedBatches[batchId] = true;

        // Calculate user's share based on their contribution to the batch
        uint256 userShare = wstETHReceived;
        userWstETHBalance[beneficiary] += userShare;

        userStakedDeposits[beneficiary].push(
            StakedDeposit({
                amount: amountToStake,
                timestamp: block.timestamp,
                wstETHAmount: userShare,
                withdrawn: false
            })
        );

        // Clear pending stake
        pendingEthStakes[beneficiary] = 0;

        emit SwapInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        ); // Record the swap
        emit WstETHBalanceUpdated(beneficiary, amountToStake, wstETHReceived); // Record wstETH received
        emit StakeInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        ); // Record lock period start

        // Reset approval as security measure
        USDC.approve(swapContract, 0);

        return userShare;
    }

    function updateWstETHBalance(address user, uint256 amount) external {
        require(
            msg.sender == swapContract || msg.sender == owner,
            "Not authorized"
        );
        userWstETHBalance[user] += amount;
        emit WstETHBalanceUpdated(user, amount, userWstETHBalance[user]);
    }

    function getUnlockTime(
        address user
    ) public view returns (uint256[] memory) {
        // Get the user's deposits
        StakedDeposit[] storage deposits = userStakedDeposits[user];

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

    function getNearestUnlockTime(address user) public view returns (uint256) {
        uint256[] memory times = getUnlockTime(user);
        if (times.length == 0) return 0;
        return times[0]; // Return earliest maturity date
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        uint256 totalUserBalance = convertToAssets(balances[user]);

        // If user has no balance, nothing to withdraw
        if (totalUserBalance == 0) return 0;

        // Get all user's staked deposits
        StakedDeposit[] storage deposits = userStakedDeposits[user];

        // For users with no staked deposits, check global timestamp
        if (deposits.length == 0) {
            bool isLocked = block.timestamp <
                depositTimestamps[user] + LOCK_PERIOD;
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
        uint256 totalUserBalance = convertToAssets(balances[user]);

        // Prevent underflow if withdrawable exceeds balance for any reason
        return
            withdrawable >= totalUserBalance
                ? 0
                : totalUserBalance - withdrawable;
    }

    function getTotalStakedAssets() public view returns (uint256) {
        uint256 totalStaked = 0;

        // Iterate through all users
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];

            // Get all of this user's staked deposits
            StakedDeposit[] storage deposits = userStakedDeposits[user];

            // Sum up all non-withdrawn deposits
            for (uint256 j = 0; j < deposits.length; j++) {
                if (!deposits[j].withdrawn) {
                    totalStaked += deposits[j].amount;
                }
            }
        }

        // Verify consistency with totalStakedValue state variable
        require(
            totalStaked == totalStakedValue ||
                (totalStaked == 0 && totalStakedValue == 0),
            "Staked accounting mismatch"
        );

        return totalStaked;
    }

    function updateLockedAssets() internal {
        uint256 currentTime = block.timestamp;
        if (currentTime >= lastUpdateTime + 1 days) {
            // Update locked assets daily
            _recalculateLockedAssets();
            lastUpdateTime = currentTime;
        }
    }

    function _recalculateLockedAssets() internal {
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];

            // Get all user's deposits
            StakedDeposit[] storage deposits = userStakedDeposits[user];

            // Reset the user's staked portions and recalculate
            uint256 stillLockedAmount = 0;

            // Check each deposit individually
            for (uint256 j = 0; j < deposits.length; j++) {
                // Only consider deposits that haven't been withdrawn yet
                if (!deposits[j].withdrawn) {
                    // If deposit is still locked, count it towards locked amount
                    if (block.timestamp < deposits[j].timestamp + LOCK_PERIOD) {
                        stillLockedAmount += deposits[j].amount;
                    }
                }
            }

            // Update user's locked assets with what's still locked
            lockedAssets[user] = stillLockedAmount;

            // If we're using stakedPortions for accounting elsewhere, update it
            // but only for locked assets (not matured but unwithdrawn assets)
            stakedPortions[user] = stillLockedAmount;

            // Emit event for significant changes
            if (stillLockedAmount != lockedAssets[user]) {
                emit LockedAssetsUpdated(user, stillLockedAmount);
            }
        }
    }

    function toggleEmergencyShutdown() external {
        require(msg.sender == owner, "Not authorized");
        emergencyShutdown = !emergencyShutdown;
        emit EmergencyShutdownToggled(emergencyShutdown);
    }

    function setFeeCollector(address _feeCollector) external {
        require(msg.sender == owner, "Not authorized");
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function collectAccumulatedFees() external {
        require(msg.sender == feeCollector, "Only fee collector");
        require(accumulatedFees > 0, "No fees to collect");

        uint256 feesToCollect = accumulatedFees;
        accumulatedFees = 0;

        asset.safeTransfer(feeCollector, feesToCollect);
        emit FeesCollected(feesToCollect);
    }
}
