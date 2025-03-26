// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILido {
    function submit(address _referral) external payable returns (uint256);
}

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function unwrap(uint256 _wstETHAmount) external returns (uint256);
}

contract Receiver {
    address public owner;
    address public swapContract;
    address public lidoContract;
    address public wstETHContract;
    bool public autoStake = true; // Auto-stake enabled by default

    event ReceivedETH(address indexed sender, uint256 amount, bool autoStaked);
    event ETHSentToSwap(uint256 amount);
    event ETHStakedWithLido(uint256 ethAmount, uint256 stEthReceived);
    event WstETHReceived(uint256 stETHAmount, uint256 wstETHReceived);
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

    function _stakeWithLido() internal {
        require(lidoContract != address(0), "Lido contract not set");
        uint256 ethAmount = address(this).balance;
        require(ethAmount > 0, "No ETH to stake");

        // Stake ETH with Lido and get stETH
        uint256 stETHReceived = ILido(lidoContract).submit{value: ethAmount}(
            address(0)
        );
        emit ETHStakedWithLido(ethAmount, stETHReceived);

        // Wrap stETH to wstETH
        uint256 wstETHReceived = IWstETH(wstETHContract).wrap(stETHReceived);
        emit WstETHReceived(stETHReceived, wstETHReceived);
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

    function stakeWithLido() external onlyAuthorized {
        _stakeWithLido();
    }

    function stakeETHWithLido() external payable returns (uint256) {
        uint256 ethAmount = msg.value;
        require(ethAmount > 0, "No ETH sent");

        // Stake ETH and get stETH
        uint256 stETHReceived = ILido(lidoContract).submit{value: ethAmount}(
            address(0)
        );

        // Wrap stETH to wstETH
        uint256 wstETHReceived = IWstETH(wstETHContract).wrap(stETHReceived);

        emit ETHStakedWithLido(ethAmount, stETHReceived);
        emit WstETHReceived(stETHReceived, wstETHReceived);

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
