// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILido {
    function submit(address _referral) external payable returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function getStETHByWstETH(
        uint256 _wstETHAmount
    ) external view returns (uint256);

    function getWstETHByStETH(
        uint256 _stETHAmount
    ) external view returns (uint256);

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);
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

interface ISwapContract {
    function swapExactETHForUSDC(
        uint amountIn,
        address to
    ) external payable returns (uint amountOut);
}

contract Receiver {
    address public owner;
    address public swapContract;
    address public lidoContract;
    address public wstETHContract;
    address public vaultContract; // ADD THIS: Reference to the vault contract
    address public lidoWithdrawalAddress;
    bool public autoStake = true; // Auto-stake enabled by default

    string public constant VERSION = "1.0.0";

    mapping(bytes32 => uint256) public batchStakes;
    mapping(bytes32 => uint256) public batchResults;
    mapping(address => uint256) public pendingEth;

    event ReceivedETH(address indexed sender, uint256 amount, bool autoStaked);
    event ETHSentToSwap(uint256 amount);
    event ETHStakedWithLido(uint256 ethAmount, uint256 stEthReceived);
    event WstETHReceived(uint256 stETHAmount, uint256 wstETHReceived);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    event WithdrawalClaimed(
        address indexed user,
        uint256 requestId,
        uint256 ethReceived,
        uint256 usdcReceived
    );
    event ReceivedETHAndStaked(address indexed sender, uint256 amount);
    event BatchProcessed(
        bytes32 indexed batchId,
        uint256 ethAmount,
        uint256 wstETHReceived
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || msg.sender == swapContract,
            "Unauthorized"
        );
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vaultContract, "Only vault can call");
        _;
    }

    constructor(address _lido, address _wstETH, address _swap) {
        require(_lido != address(0), "Invalid Lido address");
        require(_wstETH != address(0), "Invalid wstETH address");
        require(_swap != address(0), "Invalid swap address");

        lidoContract = _lido;
        wstETHContract = _wstETH;
        swapContract = _swap;
        owner = msg.sender;
    }

    function setVaultContract(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid vault address");
        vaultContract = _vault;
    }

    function setLidoWithdrawalAddress(
        address _lidoWithdrawal
    ) external onlyOwner {
        require(
            _lidoWithdrawal != address(0),
            "Invalid Lido withdrawal address"
        );
        lidoWithdrawalAddress = _lidoWithdrawal;
    }

    receive() external payable {
        if (msg.sender == swapContract) {
            // Store ETH for later staking
            pendingEth[vaultContract] += msg.value;
            emit ReceivedETH(msg.sender, msg.value, false);
        } else {
            emit ReceivedETH(msg.sender, msg.value, false);
        }
    }

    // In Receiver.sol
    function batchStakeWithLido(
        bytes32 batchId,
        uint256 amountToStake
    ) external payable returns (uint256) {
        require(lidoContract != address(0), "Lido contract not set");
        require(wstETHContract != address(0), "wstETH contract not set");
        require(amountToStake > 0, "Amount must be greater than 0");
        require(amountToStake <= address(this).balance, "Insufficient balance");

        // Submit ONLY the specified amount to Lido
        (bool success, ) = payable(lidoContract).call{value: amountToStake}("");
        require(success, "ETH transfer to Lido failed");
        // Check received stETH balance
        uint256 stETHReceived = ILido(lidoContract).balanceOf(address(this));
        emit ETHStakedWithLido(amountToStake, stETHReceived);

        // Wrap stETH to wstETH
        ILido(lidoContract).approve(wstETHContract, stETHReceived);
        uint256 wstETHReceived = IWstETH(wstETHContract).wrap(stETHReceived);

        emit WstETHReceived(stETHReceived, wstETHReceived);

        // Update batch tracking
        batchStakes[batchId] = amountToStake;
        batchResults[batchId] = wstETHReceived;

        emit BatchProcessed(batchId, amountToStake, wstETHReceived);

        // Transfer wstETH to vault
        IWstETH(wstETHContract).transfer(msg.sender, wstETHReceived);

        return wstETHReceived;
    }

    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external onlyVault returns (uint256 ethReceived, uint256 usdcReceived) {
        require(
            lidoWithdrawalAddress != address(0),
            "Lido withdrawal contract not set"
        );

        // Store initial ETH balance
        uint256 preBalance = address(this).balance;

        // Create requestIds array for Lido claim
        uint256[] memory requestIds = new uint256[](1);
        requestIds[0] = requestId;

        // Claim ETH from Lido - ETH will be sent to this contract
        ILidoWithdrawal(lidoWithdrawalAddress).claimWithdrawals(requestIds);

        // Verify ETH receipt
        uint256 postBalance = address(this).balance;
        require(postBalance > preBalance, "No ETH received");
        ethReceived = postBalance - preBalance;

        // First transfer ETH to the swap contract
        (bool success, ) = payable(swapContract).call{value: ethReceived}("");
        require(success, "ETH transfer to swap contract failed");

        // Now call the swap function with the amount we sent
        // The swap contract will check its balance and convert that amount
        usdcReceived = ISwapContract(swapContract).swapExactETHForUSDC(
            ethReceived, // Amount of ETH to swap
            vaultContract // Send USDC directly to vault
        );

        require(
            usdcReceived >= minUSDCExpected,
            "Minimum USDC amount not received"
        );

        emit WithdrawalClaimed(user, requestId, ethReceived, usdcReceived);

        return (ethReceived, usdcReceived);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setSwapContract(address _swap) external onlyOwner {
        require(_swap != address(0), "Invalid swap contract address");
        swapContract = _swap;
    }

    function setLidoContract(address _lido) external onlyOwner {
        require(_lido != address(0), "Invalid Lido contract address");
        lidoContract = _lido;
    }

    function setWstETHContract(address _wstETH) external onlyOwner {
        require(_wstETH != address(0), "Invalid wstETH contract address");
        wstETHContract = _wstETH;
    }

    function toggleAutoStake() external onlyOwner {
        autoStake = !autoStake;
    }

    function sendETHToSwap() external {
        require(swapContract != address(0), "Swap contract not set");
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to send");

        (bool success, ) = payable(swapContract).call{value: balance}("");
        require(success, "ETH transfer failed");

        emit ETHSentToSwap(balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Emergency function to recover ETH if needed
    function recoverETH(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Cannot send to zero address");
        require(amount <= address(this).balance, "Insufficient balance");

        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH recovery failed");
    }

    function checkContractHealth() external view returns (bool) {
        return
            vaultContract != address(0) &&
            lidoContract != address(0) &&
            wstETHContract != address(0) &&
            swapContract != address(0);
    }

    function verifyWithdrawalQueueInterface() external view returns (bool) {
        try
            ILidoWithdrawal(lidoWithdrawalAddress).isWithdrawalFinalized(0)
        returns (bool) {
            // Function exists, interface is correctly implemented
            return true;
        } catch {
            // Function doesn't exist or reverted for other reasons
            return false;
        }
    }
}
