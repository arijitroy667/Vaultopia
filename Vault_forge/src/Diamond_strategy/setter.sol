//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";

contract setter is Modifiers {
    // Set the swap contract address
    function setSwapContract(address _swapContract) external onlyOwner {
        require(_swapContract != address(0), "Invalid address");
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.swapContract = _swapContract;
    }

    // Set the receiver contract address
    function setReceiverContract(address _receiverContract) external onlyOwner {
        require(_receiverContract != address(0), "Invalid address");
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.receiverContract = _receiverContract;
    }
}
