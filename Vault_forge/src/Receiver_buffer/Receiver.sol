// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILido {
    function submit(address _referral) external payable returns (uint256);
}

contract Receiver {
    address public owner;
    address public swapContract;
    address public lidoContract;
    bool public autoStake = true; // Auto-stake enabled by default

    event ReceivedETH(address indexed sender, uint256 amount, bool autoStaked);
    event ETHSentToSwap(uint256 amount);
    event ETHStakedWithLido(uint256 ethAmount, uint256 stEthReceived);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
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

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {
        bool staked = false;

        // If auto-stake is enabled and we have a valid Lido contract, stake immediately
        if (autoStake && lidoContract != address(0) && msg.value > 0) {
            _stakeWithLido();
            staked = true;
        }

        emit ReceivedETH(msg.sender, msg.value, staked);
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

    function stakeWithLido() external onlyAuthorized {
        _stakeWithLido();
    }

    function stakeETHWithLido() external payable returns (uint256) {
        uint256 ethAmount = msg.value;

        // Stake ETH and get stETH
        uint256 stETHReceived = ILido(lidoContract).submit{value: ethAmount}(
            address(0)
        );

        // Wrap stETH to wstETH using Lido SDK
        uint256 wstETHReceived = ILidoWrapper(lidoWrapperContract).wrap(
            stETHReceived
        );

        return wstETHReceived;
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
