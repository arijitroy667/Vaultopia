// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Receiver {
    address public swapContract;
    address public lidoContract;

    event ReceivedETH(address sender, uint256 amount);

    receive() external payable {
        emit ReceivedETH(msg.sender, msg.value);
    }

    function setSwapContract(address _swap) external {
        swapContract = _swap;
    }

    function setLidoContract(address _lido) external {
        lidoContract = _lido;
    }

    function sendETHToSwap() external {
        require(swapContract != address(0), "Swap contract not set");
        payable(swapContract).transfer(address(this).balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function sendETHToLido() external {
        require(lidoContract != address(0), "Lido contract not set");
        payable(lidoContract).transfer(address(this).balance);
    }
}
