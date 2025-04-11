// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Custom errors
error NotAuthorized();
error InvalidAddress();
error ZeroAmount();
error ZeroFees();
error TooSoonToUpdate();
error OperationNotReady();

contract AdminFacet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants
    uint256 private constant TIMELOCK_DURATION = 2 days;
    uint256 private constant UPDATE_INTERVAL = 1 days;

    // Events
    event LidoWithdrawalAddressUpdated(address indexed newAddress);
    event WstETHAddressUpdated(address indexed newAddress);
    event ReceiverContractUpdated(address indexed newAddress);
    event SwapContractUpdated(address indexed newAddress);
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event FeesCollected(uint256 amount);
    event EmergencyShutdownToggled(bool enabled);
    event DepositsPausedToggled(bool paused);
    event DailyUpdateTriggered(uint256 timestamp);
    event OperationQueued(bytes32 indexed operationId, uint256 unlockTime);
    event OperationExecuted(bytes32 indexed operationId);

    // Modifier for owner-only functions
    modifier onlyOwner() {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (msg.sender != ds.owner) revert NotAuthorized();
        _;
    }

    // Address setters
    function setLidoWithdrawalAddress(
        address _lidoWithdrawal
    ) external onlyOwner {
        if (_lidoWithdrawal == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.lidoWithdrawalAddress = _lidoWithdrawal;

        emit LidoWithdrawalAddressUpdated(_lidoWithdrawal);
    }

    function setWstETHAddress(address _wstETH) external onlyOwner {
        if (_wstETH == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.wstETHAddress = _wstETH;

        emit WstETHAddressUpdated(_wstETH);
    }

    function setReceiverContract(address _receiver) external onlyOwner {
        if (_receiver == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.receiverContract = _receiver;

        emit ReceiverContractUpdated(_receiver);
    }

    function setSwapContract(address _swapContract) external onlyOwner {
        if (_swapContract == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.swapContract = _swapContract;

        emit SwapContractUpdated(_swapContract);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.feeCollector = _feeCollector;

        emit FeeCollectorUpdated(_feeCollector);
    }

    // State management
    function toggleEmergencyShutdown() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.emergencyShutdown = !ds.emergencyShutdown;

        emit EmergencyShutdownToggled(ds.emergencyShutdown);
    }

    function toggleDeposits() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.depositsPaused = !ds.depositsPaused;

        emit DepositsPausedToggled(ds.depositsPaused);
    }

    // Fee collection
    function collectAccumulatedFees() external nonReentrant {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (msg.sender != ds.feeCollector) revert NotAuthorized();
        if (ds.accumulatedFees == 0) revert ZeroFees();

        uint256 feesToCollect = ds.accumulatedFees;
        ds.accumulatedFees = 0;

        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(
            ds.feeCollector,
            feesToCollect
        );

        emit FeesCollected(feesToCollect);
    }

    // Update triggers
    function triggerDailyUpdate() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (block.timestamp < ds.lastDailyUpdate + UPDATE_INTERVAL)
            revert TooSoonToUpdate();

        // This would typically call the performDailyUpdate function which
        // needs to be implemented in another facet (e.g., UpdateFacet)
        // This is a placeholder that simply updates the timestamp
        ds.lastDailyUpdate = block.timestamp;

        emit DailyUpdateTriggered(block.timestamp);
    }

    // Protocol admin functions with timelock
    function queueOperation(bytes32 operationId) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 unlockTime = block.timestamp + TIMELOCK_DURATION;

        ds.pendingOperations[operationId] = unlockTime;

        emit OperationQueued(operationId, unlockTime);
    }

    function executeOperation(bytes32 operationId) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 unlockTime = ds.pendingOperations[operationId];

        if (unlockTime == 0 || block.timestamp < unlockTime)
            revert OperationNotReady();

        // Clear the pending operation
        delete ds.pendingOperations[operationId];

        emit OperationExecuted(operationId);

        // Additional logic based on operation type would go here
    }

    // Ownership transfer
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Queue the ownership transfer
        bytes32 operationId = keccak256(
            abi.encodePacked("transferOwnership", newOwner)
        );
        uint256 unlockTime = block.timestamp + TIMELOCK_DURATION;
        ds.pendingOperations[operationId] = unlockTime;

        emit OperationQueued(operationId, unlockTime);
    }

    function completeOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Check if the operation is ready
        bytes32 operationId = keccak256(
            abi.encodePacked("transferOwnership", newOwner)
        );
        uint256 unlockTime = ds.pendingOperations[operationId];

        if (unlockTime == 0 || block.timestamp < unlockTime)
            revert OperationNotReady();

        // Execute the ownership transfer
        ds.owner = newOwner;
        delete ds.pendingOperations[operationId];

        emit OperationExecuted(operationId);
    }
}
