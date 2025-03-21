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

    function _stakeWithLido() internal {
        require(lidoContract != address(0), "Lido contract not set");
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to stake");

        // Use Lido's submit function to stake ETH and receive stETH
        uint256 stEthReceived = ILido(lidoContract).submit{value: balance}(
            address(0)
        );

        emit ETHStakedWithLido(balance, stEthReceived);
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
