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
    function _stakeWithLido() external payable returns (uint256);
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
    uint256 public constant PERFORMANCE_FEE = 200; // 2%
    uint256 public constant MIN_DEPOSIT_AMOUNT = 100 * 1e6; // 100 USDC minimum
    uint256 public constant DEPOSIT_TIMELOCK = 1 hours;
    uint256 public totalStakedValue;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MINIMUM_FEE = 1e6; // 1 USDC minimum fee
    uint256 public accumulatedFees;
    uint256 public constant AUTO_WITHDRAWAL_SLIPPAGE = 950; // 95% of original stake as minimum

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
    event DailyUpdatePerformed(uint256 timestamp);
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

    constructor(address _lidoWithdrawal, address _wstETH, address _receiver) {
        require(
            _lidoWithdrawal != address(0),
            "Invalid Lido withdrawal address"
        );
        require(_wstETH != address(0), "Invalid wstETH address");
        require(_receiver != address(0), "Invalid receiver address");

        lidoWithdrawalAddress = _lidoWithdrawal;
        wstETHAddress = _wstETH;
        receiverContract = _receiver;

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

        // Cache frequently used values
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

    function performDailyUpdate() external nonReentrant onlyContract {
        require(
            block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL,
            "Too soon to update"
        );

        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];

            // Check if lock period has expired and user has staked assets
            if (
                block.timestamp >= depositTimestamps[user] + LOCK_PERIOD &&
                userWstETHBalance[user] > 0 &&
                !withdrawalInProgress[user]
            ) {
                // Initiate automatic withdrawal
                initiateAutomaticWithdrawal(user);
            }

            // Check if there's a pending withdrawal that's ready
            if (withdrawalInProgress[user]) {
                uint256 requestId = withdrawalRequestIds[user];
                bool isWithdrawalReady = ILidoWithdrawal(lidoWithdrawalAddress)
                    .isWithdrawalFinalized(requestId);

                if (isWithdrawalReady) {
                    // Process the completed withdrawal
                    uint256 originalStake = stakedPortions[user];
                    uint256 minExpectedUSDC = stakedPortions[user]; // 1:1 minimum ratio
                    processCompletedWithdrawals(user, minExpectedUSDC);
                }
            }
        }

        // Cleanup any expired locked assets
        _recalculateLockedAssets();
        lastDailyUpdate = block.timestamp;

        emit DailyUpdatePerformed(block.timestamp);
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
        if (block.timestamp < depositTimestamps[_owner] + LOCK_PERIOD) {
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
        require(assets > 0, "Assets must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(!emergencyShutdown, "Withdrawals suspended");
        require(msg.sender == _owner, "Not authorized");

        uint256 depositTime = depositTimestamps[_owner];
        bool isLocked = block.timestamp < depositTime + LOCK_PERIOD;

        // Calculate withdrawable amount
        uint256 totalBalance = convertToAssets(balances[_owner]);
        uint256 withdrawableAmount = isLocked
            ? (totalBalance * LIQUID_PORTION) / 100
            : totalBalance;

        require(
            assets <= withdrawableAmount,
            "Amount exceeds withdrawable balance"
        );

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

    function initiateAutomaticWithdrawal(address user) internal {
        require(
            block.timestamp >= depositTimestamps[user] + LOCK_PERIOD,
            "Lock period not ended"
        );
        require(userWstETHBalance[user] > 0, "No wstETH to withdraw");
        require(!withdrawalInProgress[user], "Withdrawal already in progress");

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
            .requestWithdrawals(amounts, address(this));

        withdrawalRequestIds[user] = requestIds[0];
        emit WithdrawalFromLidoInitiated(user, wstETHAmount);
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

    function setSwapContract(address _swapContract) external {
        require(msg.sender == owner, "Not authorized");
        require(_swapContract != address(0), "Invalid address");
        swapContract = _swapContract;
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
        userWstETHBalance[user] = amount;
        emit WstETHBalanceUpdated(user, amount, userWstETHBalance[user]);
    }

    function getUnlockTime(address user) public view returns (uint256) {
        uint256 depositTime = depositTimestamps[user];
        if (depositTime == 0) return 0;
        return depositTime + LOCK_PERIOD;
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        uint256 totalBalance = convertToAssets(balances[user]);
        bool isLocked = block.timestamp < depositTimestamps[user] + LOCK_PERIOD;

        if (!isLocked) {
            return totalBalance; // After lock period, everything is withdrawable
        }

        return (totalBalance * LIQUID_PORTION) / 100; // During lock, only 60%
    }

    function getLockedAmount(address user) public view returns (uint256) {
        if (block.timestamp >= depositTimestamps[user] + LOCK_PERIOD) {
            return 0;
        }
        return stakedPortions[user]; // Return staked portion
    }

    function getTotalLockedAssets() internal view returns (uint256) {
        uint256 totalStaked = 0;
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];
            if (block.timestamp < depositTimestamps[user] + LOCK_PERIOD) {
                totalStaked += stakedPortions[user];
            }
        }
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
            if (block.timestamp >= depositTimestamps[user] + LOCK_PERIOD) {
                stakedPortions[user] = 0;
                lockedAssets[user] = 0;
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
