// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// Add USDC interface
interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);
}

// Call the function that both takes the USDC and performs the swap
interface ISwapContract {
    function takeAndSwapUSDC(
        uint256 amount,
        uint256 amountOutMin
    ) external returns (uint256);
}

contract Yield_Bull is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // Define USDC as immutable
    IUSDC public immutable USDC;

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

    bool public emergencyShutdown;
    bool public depositsPaused;

    address public owner;
    address[] private userAddresses;
    address public immutable ASSET_TOKEN_ADDRESS =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address public swapContract;
    address public feeCollector;

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
    event EmergencyShutdownToggled(bool enabled);
    // mapping variables

    mapping(bytes32 => uint256) public pendingOperations;
    mapping(address => uint256) public stakedPortions; // Track 40% staked amount per user
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public depositTimestamps;
    mapping(address => uint256) public lockedAssets;
    mapping(address => bool) private isExistingUser;
    mapping(address => uint256) public userWstETHBalance;

    constructor() {
        asset = IERC20(ASSET_TOKEN_ADDRESS);
        USDC = IUSDC(ASSET_TOKEN_ADDRESS);
        _decimals = USDC.decimals();
        owner = msg.sender;
    }

    function exchangeRate() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e6; // Initial exchange rate: 1 share = 1 asset
        }
        return (totalAssets * 1e6) / totalShares;
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
        return (assets * totalShares) / totalAssets;
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

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares minted");

        if (!isExistingUser[receiver]) {
            userAddresses.push(receiver);
            isExistingUser[receiver] = true;
        }

        // Calculate portions
        uint256 amountToStake = (assets * STAKED_PORTION) / 100;
        uint256 liquidAmount = assets - amountToStake;

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
            safeTransferAndSwap(0, receiver); // Will handle the 40% staking
        }

        emit Deposit(msg.sender, receiver, assets, shares);
        emit StakeInitiated(
            receiver,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        );

        return shares;
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

        uint256 stakedAmount = stakedPortions[_owner];
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
        require(shares <= balances[_owner], "Insufficient shares");

        // Verify authorization
        if (msg.sender != _owner) {
            // Implement authorization check (e.g., allowance mechanism)
            revert("Not authorized");
        }

        assets = previewRedeem(shares);
        require(assets > 0, "Assets must be greater than zero");

        // Update state before transfer to prevent reentrancy attacks
        balances[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        // Transfer assets from vault to receiver
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
        require(msg.sender == owner, "Not authorized"); // Add this line
        require(_swapContract != address(0), "Invalid address"); // Add this line
        swapContract = _swapContract;
    }

    // In your Vault contract
    function safeTransferAndSwap(
        uint256 amountOutMin,
        address beneficiary
    ) public returns (uint256) {
        require(swapContract != address(0), "Swap contract not set");
        require(
            msg.sender == owner || msg.sender == address(this),
            "Unauthorized"
        );

        uint256 beneficiaryAssets = convertToAssets(balances[beneficiary]);
        uint256 amountToStake = (beneficiaryAssets * STAKED_PORTION) / 100;
        require(amountToStake > 0, "Amount too small");

        // Execute swap for staking
        USDC.approve(swapContract, amountToStake);
        uint256 ethReceived = ISwapContract(swapContract).takeAndSwapUSDC(
            amountToStake,
            amountOutMin
        );

        // Stake ETH and get wstETH
        uint256 wstETHReceived = IReceiver(receiverContract).stakeETHWithLido{
            value: ethReceived
        }();

        // Update balances
        userWstETHBalance[beneficiary] += wstETHReceived;
        stakedPortions[beneficiary] += amountToStake;

        emit SwapInitiated(amountToStake, amountOutMin); // Record the swap
        emit WstETHBalanceUpdated(beneficiary, amountToStake, wstETHReceived); // Record wstETH received
        emit StakeInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        ); // Record lock period start

        // Reset approval as security measure
        USDC.approve(swapContract, 0);

        return wstETHReceived;
    }

    function updateWstETHBalance(address user, uint256 amount) external {
        require(
            msg.sender == swapContract || msg.sender == owner,
            "Not authorized"
        );
        userWstETHBalance[user] = amount;
        emit WstETHBalanceUpdated(user, amount);
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
}
