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
        uint amountOutMin,
        address to,
        uint deadline
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

    mapping(bytes32 => uint256) public batchStakes;
    mapping(bytes32 => uint256) public batchResults;

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
        if (msg.sender == swapContract && autoStake && msg.value > 0) {
            // Stake only the received amount
            uint256 ethToStake = msg.value;
            // Similar to batchStakeWithLido but with the received amount only
            // ...
            emit ReceivedETHAndStaked(msg.sender, ethToStake);
        } else {
            emit ReceivedETH(msg.sender, msg.value, false);
        }
    }

    function batchStakeWithLido(
        bytes32 batchId
    ) external payable returns (uint256) {
        require(msg.sender == vaultContract, "Only vault can call");
        require(msg.value > 0, "No ETH sent");
        require(lidoContract != address(0), "Lido contract not set");
        require(wstETHContract != address(0), "wstETH contract not set");

        // Record the batch ID
        batchStakes[batchId] = msg.value;

        // Track balances before
        uint256 preStETHBalance = ILido(lidoContract).balanceOf(address(this));

        // Submit ETH to Lido
        uint256 stETHReceived = ILido(lidoContract).submit{value: msg.value}(
            address(0)
        );

        // Verify stETH receipt
        uint256 postStETHBalance = ILido(lidoContract).balanceOf(address(this));
        require(
            postStETHBalance >= preStETHBalance + stETHReceived,
            "stETH not received"
        );

        // Approve wstETH contract to spend stETH
        require(
            ILido(lidoContract).approve(wstETHContract, stETHReceived),
            "stETH approval failed"
        );

        // Wrap stETH to wstETH
        uint256 wstETHReceived = IWstETH(wstETHContract).wrap(stETHReceived);
        require(wstETHReceived > 0, "No wstETH received");

        // Record batch result
        batchResults[batchId] = wstETHReceived;

        emit ETHStakedWithLido(msg.value, stETHReceived);
        emit WstETHReceived(stETHReceived, wstETHReceived);
        emit BatchProcessed(batchId, msg.value, wstETHReceived);

        return wstETHReceived;
    }

    // Add to Receiver.sol
    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external onlyVault returns (uint256 usdcReceived) {
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
        uint256 ethReceived = postBalance - preBalance;

        // Calculate deadline
        uint256 deadline = block.timestamp + 300;

        // Call new swap function to convert ETH to USDC and send directly to Vault
        usdcReceived = ISwapContract(swapContract).swapExactETHForUSDC{
            value: ethReceived
        }(
            minUSDCExpected,
            vaultContract, // Send USDC directly to vault
            deadline
        );

        emit WithdrawalClaimed(user, requestId, ethReceived, usdcReceived);

        return usdcReceived;
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
}
